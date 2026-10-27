import { existsSync } from 'node:fs';

import pty from 'node-pty';
import type { WebSocket } from 'ws';

import { ROOT } from './config.js';

type ClientMessage =
  | { type: 'init'; cols?: number; rows?: number }
  | { type: 'input'; data?: string }
  | { type: 'resize'; cols?: number; rows?: number };

function shellBinary(): string {
  const configured = process.env.LENS_SHELL;
  if (configured && existsSync(configured)) return configured;

  for (const candidate of ['/bin/bash', '/usr/bin/bash', '/bin/sh']) {
    if (existsSync(candidate)) return candidate;
  }

  return 'sh';
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * One PTY per socket, killed on disconnect. No session resumption: this is a
 * single-purpose reader, and a lingering PTY is a resource leak with no payoff.
 */
export function handleShell(socket: WebSocket): void {
  let terminal: pty.IPty | null = null;
  let closed = false;

  const dispose = () => {
    closed = true;
    if (terminal) {
      try {
        terminal.kill();
      } catch {
        /* already gone */
      }
      terminal = null;
    }
  };

  socket.on('message', (raw) => {
    if (closed) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (message.type === 'init') {
      if (terminal) return;

      const cols = clamp(message.cols, 80, 20, 500);
      const rows = clamp(message.rows, 24, 5, 200);

      // npm_config_* leaks in from the launching shell and makes nvm print a
      // compatibility warning on every new terminal. Credentials are withheld by
      // default so a terminal session cannot exfiltrate the operator's API keys;
      // set LENS_SHELL_PASS_ENV=1 to hand over the full environment instead.
      const passEverything = process.env.LENS_SHELL_PASS_ENV === '1';
      const sensitive = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i;

      const environment: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue;
        if (/^npm_config_/i.test(key)) continue;
        if (!passEverything && sensitive.test(key)) continue;
        environment[key] = value;
      }

      environment.TERM = 'xterm-256color';
      environment.COLORTERM = 'truecolor';
      environment.FORCE_COLOR = '3';

      try {
        terminal = pty.spawn(shellBinary(), [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: ROOT,
          env: environment,
        });
      } catch (error) {
        send(socket, {
          type: 'error',
          message: error instanceof Error ? error.message : '无法启动终端',
        });
        return;
      }

      terminal.onData((data) => send(socket, { type: 'output', data }));

      terminal.onExit(({ exitCode }) => {
        send(socket, { type: 'exit', code: exitCode });
        terminal = null;
      });

      return;
    }

    if (message.type === 'input' && terminal && typeof message.data === 'string') {
      terminal.write(message.data);
      return;
    }

    if (message.type === 'resize' && terminal) {
      try {
        terminal.resize(clamp(message.cols, 80, 20, 500), clamp(message.rows, 24, 5, 200));
      } catch {
        /* resize races with process exit */
      }
    }
  });

  socket.on('close', dispose);
  socket.on('error', dispose);
}
