import { useEffect, useRef } from 'react';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

import '@xterm/xterm/css/xterm.css';

type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const DARK_THEME = {
  background: '#14171c',
  foreground: '#e9e6df',
  cursor: '#c98a3c',
  cursorAccent: '#14171c',
  selectionBackground: 'rgba(201, 138, 60, 0.28)',
  black: '#14171c',
  red: '#c47f7f',
  green: '#a3b58a',
  yellow: '#d8c79f',
  blue: '#8fa7c4',
  magenta: '#b394c4',
  cyan: '#8fbfc4',
  white: '#e9e6df',
  brightBlack: '#6d6a63',
  brightRed: '#d68f8f',
  brightGreen: '#b5c79a',
  brightYellow: '#e8d7af',
  brightBlue: '#a3bcd8',
  brightMagenta: '#c9a8d8',
  brightCyan: '#a3d2d8',
  brightWhite: '#ffffff',
};

/*
 * Every ANSI colour here clears 4.5:1 against the cream background — including
 * `white` and `brightWhite`, which would be invisible if mapped literally. On a
 * light background the "bright" variants therefore run darker than the base
 * ones: there is no brighter direction left to go.
 */
const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#23272e',
  cursor: '#a8541c',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(168, 84, 28, 0.22)',
  black: '#23272e',
  red: '#b3352b',
  green: '#3d7a1f',
  yellow: '#8a6100',
  blue: '#2f5fc4',
  magenta: '#8f1f8f',
  cyan: '#0a6e6e',
  white: '#5b6068',
  brightBlack: '#6b7178',
  brightRed: '#a82f26',
  brightGreen: '#356b1a',
  brightYellow: '#7a5600',
  brightBlue: '#2854b0',
  brightMagenta: '#7d1b7d',
  brightCyan: '#086060',
  brightWhite: '#23272e',
};

export default function TerminalPane({
  active,
  theme,
}: {
  active: boolean;
  theme: 'dark' | 'light';
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let cleanup = () => {};

    const start = () => {
      const terminal = new Terminal({
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 1.45,
        letterSpacing: 0.2,
        cursorBlink: true,
        scrollback: 5000,
        theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      });

      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(host);

      // A hidden pane measures zero; fitting there would collapse the grid.
      const fitIfVisible = () => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return false;
        fit.fit();
        return true;
      };

      fitIfVisible();
      termRef.current = terminal;
      fitRef.current = fit;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/shell`);
      socketRef.current = socket;

      const sendResize = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        }
      };

      const onOpen = () => {
        fitIfVisible();
        socket.send(JSON.stringify({ type: 'init', cols: terminal.cols, rows: terminal.rows }));
      };

      const onMessage = (event: MessageEvent) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.type === 'output') terminal.write(message.data);
        else if (message.type === 'exit') {
          terminal.write(`\r\n\x1b[90m[进程已退出，代码 ${message.code}]\x1b[0m\r\n`);
        } else if (message.type === 'error') {
          terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
        }
      };

      const onClose = () => {
        terminal.write('\r\n\x1b[90m[连接已断开]\x1b[0m\r\n');
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);

      const dataSubscription = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      const observer = new ResizeObserver(() => {
        if (fitIfVisible()) sendResize();
      });
      observer.observe(host);

      const focus = () => terminal.focus();
      host.addEventListener('mousedown', focus);

      cleanup = () => {
        observer.disconnect();
        host.removeEventListener('mousedown', focus);
        dataSubscription.dispose();
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        socket.close();
        terminal.dispose();
        termRef.current = null;
        fitRef.current = null;
        socketRef.current = null;
      };
    };

    // xterm measures cell width at construction; without the real monospace face
    // it falls back to a proportional font and the prompt renders misaligned.
    void document.fonts
      .load(`13px ${FONT}`)
      .catch(() => undefined)
      .then(() => {
        if (disposed) return;
        start();
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  // Switching skin repaints the existing terminal rather than remounting it,
  // so the running shell and its scrollback survive the change.
  useEffect(() => {
    const terminal = termRef.current;
    if (terminal) terminal.options.theme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
  }, [theme]);

  // The pane stays mounted while the Files tab is showing so the shell survives
  // tab switches, but a hidden element measures zero — re-fit on reveal.
  useEffect(() => {
    if (!active) return;

    const timer = window.setTimeout(() => {
      const terminal = termRef.current;
      const fit = fitRef.current;
      if (!terminal || !fit) return;

      fit.fit();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
      terminal.focus();
    }, 60);

    return () => window.clearTimeout(timer);
  }, [active]);

  return <div ref={hostRef} className="terminal-host h-full w-full" />;
}
