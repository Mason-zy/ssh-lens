import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MAX_HTML_BYTES, MAX_INLINE_BYTES, MAX_TEXT_BYTES, ROOT, toDisplayPath } from './config.js';

export type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | 'code' | 'binary';

export type Entry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  modified: number;
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

function extensionOf(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function mimeFor(filePath: string): string {
  return MIME[extensionOf(filePath)] ?? 'application/octet-stream';
}

export function kindFor(filePath: string, buffer: Buffer): PreviewKind {
  const ext = extensionOf(filePath);

  // Extension decides first for formats we render natively: a PNG or PDF is
  // binary by nature, so a NUL sniff would misclassify every one of them.
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';

  if (buffer.subarray(0, 8192).includes(0)) return 'binary';

  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html';

  return 'code';
}

function declaredCharset(head: Buffer): string | null {
  const text = head.toString('latin1');
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(text);
  return meta?.[1]?.toLowerCase() ?? null;
}

/** Honours BOM and declared charset, then falls back UTF-8 → GBK (Chinese servers serve GBK often). */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }

  const declared = declaredCharset(buffer.subarray(0, 4096));
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      return new TextDecoder(declared).decode(buffer);
    } catch {
      /* fall through */
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

export async function listDirectory(absolute: string): Promise<Entry[]> {
  const items = await readdir(absolute, { withFileTypes: true });

  const entries = await Promise.all(
    items.map(async (item): Promise<Entry | null> => {
      const full = path.join(absolute, item.name);

      try {
        const info = await stat(full);
        return {
          name: item.name,
          path: toDisplayPath(full),
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.size,
          modified: info.mtimeMs,
        };
      } catch {
        return null; // broken symlink or a file removed mid-listing
      }
    }),
  );

  return entries
    .filter((entry): entry is Entry => entry !== null)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

const ABSOLUTE_URL = /^(https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i;

const BASE64_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

/**
 * Only assets a page legitimately references are inlined. Without this an HTML
 * file could pull any sibling file (`.env`, keys) into its own DOM via
 * `<link rel="stylesheet" href=".env">` and read it from script.
 */
const INLINEABLE_EXTENSIONS = new Set([
  'css',
  'js',
  'mjs',
  'cjs',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'avif',
  'woff',
  'woff2',
  'ttf',
]);

/**
 * Inlines sibling stylesheets, scripts and images so a page renders inside a
 * sandboxed iframe. Such a frame has no base URL and no session cookie, so any
 * relative reference or authenticated sub-resource would otherwise fail.
 */
export async function inlineAssets(html: string, directory: string): Promise<string> {
  let result = html;
  let budget = MAX_INLINE_BYTES;

  const readSibling = async (reference: string): Promise<Buffer | null> => {
    const cleaned = reference.split('?')[0].split('#')[0];
    if (!cleaned || ABSOLUTE_URL.test(cleaned)) return null;

    const name = path.basename(cleaned);
    if (name.startsWith('.')) return null; // never inline dotfiles

    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    if (!INLINEABLE_EXTENSIONS.has(extension)) return null;

    const absolute = path.resolve(directory, `.${path.posix.normalize(`/${cleaned}`)}`);
    if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) return null;

    // Resolve the link before trusting it: a symlink inside the page directory
    // could otherwise pull in a file from anywhere.
    const resolved = await realpath(absolute).catch(() => null);
    if (!resolved) return null;
    if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) return null;
    if (resolved !== directory && !resolved.startsWith(`${directory}${path.sep}`)) return null;

    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile() || info.size > budget) return null;

    const data = await readFile(resolved).catch(() => null);
    if (!data) return null;

    budget -= data.length;
    return data;
  };

  for (const match of [...result.matchAll(/<link\b[^>]*>/gi)]) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;

    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;

    const css = await readSibling(href);
    if (!css) continue;

    result = result.replace(tag, `<style>\n${css.toString('utf8')}\n</style>`);
  }

  for (const match of [...result.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi)]) {
    const script = await readSibling(match[2]);
    if (!script) continue;

    const attributes = `${match[1]} ${match[3]}`.replace(/\s+/g, ' ').trim();
    const keepType = /type\s*=\s*["']?module/i.test(attributes) ? ' type="module"' : '';

    result = result.replace(match[0], `<script${keepType}>\n${script.toString('utf8')}\n</script>`);
  }

  for (const match of [...result.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]) {
    const image = await readSibling(match[1]);
    if (!image) continue;

    const mime = BASE64_MIME[extensionOf(match[1])] ?? 'application/octet-stream';
    result = result.replace(match[0], match[0].replace(match[1], `data:${mime};base64,${image.toString('base64')}`));
  }

  return result;
}

export type FilePayload = {
  path: string;
  kind: PreviewKind;
  size: number;
  content?: string;
  tooLarge?: boolean;
};

export async function readFileForPreview(absolute: string): Promise<FilePayload> {
  const displayPath = toDisplayPath(absolute);
  const info = await stat(absolute);

  if (info.isDirectory()) throw new Error('这是一个目录');

  const extension = extensionOf(displayPath);
  const limit = extension === 'html' || extension === 'htm' ? MAX_HTML_BYTES : MAX_TEXT_BYTES;

  if (info.size > limit) {
    return { path: displayPath, kind: 'binary', size: info.size, tooLarge: true };
  }

  const buffer = await readFile(absolute);
  const kind = kindFor(displayPath, buffer);

  if (kind === 'binary' || kind === 'image' || kind === 'pdf') {
    return { path: displayPath, kind, size: info.size };
  }

  let content = decodeText(buffer);
  if (kind === 'html') {
    content = await inlineAssets(content, path.dirname(absolute));
  }

  return { path: displayPath, kind, size: info.size, content };
}

export function streamRaw(absolute: string) {
  return createReadStream(absolute);
}

/* ---------- mutations ---------- */

export async function writeFileContent(absolute: string, content: string): Promise<void> {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.length > MAX_TEXT_BYTES) throw new Error('内容超过写入上限');

  const info = await stat(absolute).catch(() => null);
  if (info?.isDirectory()) throw new Error('不能把目录当文件写入');

  await writeFile(absolute, buffer);
}

export async function createEntry(absolute: string, type: 'file' | 'directory'): Promise<void> {
  const existing = await stat(absolute).catch(() => null);
  if (existing) throw new Error(type === 'directory' ? '同名目录已存在' : '同名文件已存在');

  if (type === 'directory') {
    await mkdir(absolute, { recursive: true });
    return;
  }

  await writeFile(absolute, '', { flag: 'wx' });
}

export async function renameEntry(from: string, to: string): Promise<void> {
  if (from === to) return;

  // Moving a directory into its own subtree would either fail mid-way or
  // detach the tree; refuse before touching the filesystem.
  if (to.startsWith(`${from}${path.sep}`)) {
    throw new Error('不能把目录移动到它自己的子目录里');
  }

  const target = await stat(to).catch(() => null);
  if (target) throw new Error('目标名称已存在');

  await rename(from, to);
}

export async function deleteEntry(absolute: string, root: string): Promise<void> {
  if (absolute === root) throw new Error('不能删除根目录');

  const info = await stat(absolute).catch(() => null);
  if (!info) throw new Error('文件或目录不存在');

  // rm with recursive covers both files and non-empty directories.
  await rm(absolute, { recursive: true, force: false });
}
