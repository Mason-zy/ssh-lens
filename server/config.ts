import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.LENS_PORT ?? 7788);
export const HOST = process.env.LENS_HOST ?? '127.0.0.1';

/** Everything the browser can reach is confined to this directory. */
export const ROOT = realpathSync(path.resolve(process.env.LENS_ROOT ?? homedir()));

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_HTML_BYTES = 12 * 1024 * 1024;
export const MAX_INLINE_BYTES = 4 * 1024 * 1024;
export const MAX_RAW_BYTES = 64 * 1024 * 1024;

const SECRET_PATH = path.join(homedir(), '.ssh-lens-secret');

export function resolvePassword(): string {
  const fromEnv = process.env.LENS_PASSWORD;
  if (fromEnv) return fromEnv;

  if (existsSync(SECRET_PATH)) {
    const stored = readFileSync(SECRET_PATH, 'utf8').trim();
    if (stored) return stored;
  }

  const generated = randomBytes(15).toString('base64url');
  writeFileSync(SECRET_PATH, `${generated}\n`, { mode: 0o600 });
  return generated;
}

/** Resolves a browser-supplied path and refuses anything escaping ROOT. */
export function resolveSafePath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) throw new Error('缺少路径参数');
  if (input.includes('\0')) throw new Error('路径包含非法字符');
  if (input.split('/').includes('..')) throw new Error('路径不得包含 ..');

  const absolute = path.resolve(ROOT, `.${path.posix.normalize(input.startsWith('/') ? input : `/${input}`)}`);

  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error('路径超出可访问范围');
  }

  return absolute;
}

function assertInsideRoot(candidate: string): void {
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error('路径超出可访问范围');
  }
}

/**
 * Lexical validation is not enough: a symlink inside ROOT can point anywhere,
 * and every fs call follows it. Resolve the real path and re-check the boundary.
 * When the target does not exist yet (create / rename destination), validate the
 * nearest existing ancestor instead.
 */
export async function resolveSafePathAsync(input: unknown): Promise<string> {
  const lexical = resolveSafePath(input);

  const resolved = await realpath(lexical).catch(() => null);
  if (resolved) {
    assertInsideRoot(resolved);
    return resolved;
  }

  const parent = path.dirname(lexical);
  const resolvedParent = await realpath(parent).catch(() => null);
  if (!resolvedParent) throw new Error('父目录不存在');

  assertInsideRoot(resolvedParent);
  return path.join(resolvedParent, path.basename(lexical));
}

/** Path shown to the browser, always posix-style and relative to ROOT. */
export function toDisplayPath(absolute: string): string {
  const relative = path.relative(ROOT, absolute);
  return relative ? `/${relative.split(path.sep).join('/')}` : '/';
}
