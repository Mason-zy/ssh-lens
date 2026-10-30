import { existsSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';

import {
  checkLogin,
  clearSessionCookie,
  clientIp,
  isAuthenticated,
  readCookie,
  requireAuth,
  sendSessionCookie,
  verifyToken,
} from './auth.js';
import { HOST, MAX_RAW_BYTES, PORT, ROOT, resolveSafePathAsync, toDisplayPath } from './config.js';
import {
  createEntry,
  deleteEntry,
  listDirectory,
  mimeFor,
  readFileForPreview,
  renameEntry,
  streamRaw,
  writeFileContent,
} from './files.js';
import { handleShell } from './shell.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../dist');

const app = express();
app.use(express.json({ limit: '8mb' }));

app.post('/api/login', (request: Request, response: Response) => {
  const result = checkLogin(clientIp(request), (request.body as { password?: unknown })?.password);

  if (!result.ok) {
    if (result.retry) response.setHeader('Retry-After', String(result.retry));
    response.status(result.retry ? 429 : 401).json({ error: result.message });
    return;
  }

  sendSessionCookie(response);
  response.json({ ok: true });
});

app.post('/api/logout', (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get('/api/session', (request, response) => {
  response.json({ authenticated: isAuthenticated(request) });
});

app.get('/api/root', requireAuth, (_request, response) => {
  response.json({ root: ROOT });
});

app.get('/api/tree', requireAuth, async (request, response) => {
  try {
    const absolute = await resolveSafePathAsync(request.query.path ?? '/');
    const entries = await listDirectory(absolute);
    response.json({ path: toDisplayPath(absolute), entries });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.get('/api/file', requireAuth, async (request, response) => {
  try {
    const absolute = await resolveSafePathAsync(request.query.path);
    response.json(await readFileForPreview(absolute));
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.get('/api/raw', requireAuth, async (request, response) => {
  try {
    const absolute = await resolveSafePathAsync(request.query.path);
    const { stat } = await import('node:fs/promises');
    const info = await stat(absolute);

    if (!info.isFile()) {
      response.status(400).json({ error: '不是一个文件' });
      return;
    }
    if (info.size > MAX_RAW_BYTES) {
      response.status(413).json({ error: '文件过大' });
      return;
    }

    const mime = mimeFor(absolute);
    response.setHeader('Content-Type', mime);
    response.setHeader('Content-Length', String(info.size));
    response.setHeader('X-Content-Type-Options', 'nosniff');

    // Opening a stored .html/.svg/.js directly from /api/raw would run it in
    // this app's origin, where it could call the API and open a shell. A
    // sandbox CSP neutralises that without breaking <img src> rendering.
    if (/^(text\/html|application\/xhtml\+xml|text\/javascript|application\/javascript|image\/svg\+xml)/i.test(mime)) {
      response.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
    }

    streamRaw(absolute).pipe(response);
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 20 },
});

/** Recursively matches file names under `path`. Skips dependency and VCS trees. */
app.get('/api/search', requireAuth, async (request, response) => {
  try {
    const root = await resolveSafePathAsync(request.query.path ?? '/');
    const query = String(request.query.q ?? '').trim().toLowerCase();

    if (query.length === 0) {
      response.json({ results: [] });
      return;
    }

    const MAX_RESULTS = 200;
    const MAX_DEPTH = 8;
    const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', '__pycache__']);
    const results: Array<{ name: string; path: string; type: 'file' | 'directory' }> = [];

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;

      const items = await readdir(directory, { withFileTypes: true }).catch(() => []);

      for (const item of items) {
        if (results.length >= MAX_RESULTS) return;
        if (SKIP.has(item.name)) continue;

        const full = path.join(directory, item.name);

        if (item.name.toLowerCase().includes(query)) {
          results.push({
            name: item.name,
            path: toDisplayPath(full),
            type: item.isDirectory() ? 'directory' : 'file',
          });
        }

        // Dirent.isDirectory() is false for symlinks, so this cannot loop.
        if (item.isDirectory()) await walk(full, depth + 1);
      }
    };

    await walk(root, 0);
    response.json({ results });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.post('/api/upload', requireAuth, upload.array('files', 20), async (request, response) => {
  try {
    const targetDirectory = await resolveSafePathAsync(request.query.path ?? '/');
    const info = await stat(targetDirectory);

    if (!info.isDirectory()) throw new Error('上传目标不是目录');

    const files = (request.files ?? []) as Express.Multer.File[];
    if (files.length === 0) throw new Error('没有收到文件');

    const saved: string[] = [];

    for (const file of files) {
      // Strip any directory component the client sent; never trust originalname.
      const name = decodeUploadName(path.basename(file.originalname)).replace(/[/\\\0]/g, '_').trim();
      if (!name || name === '.' || name === '..') continue;

      // Uploads are stored verbatim, archives included. Unpacking on the server
      // was surprising and lossy (the original .zip disappeared), so extraction
      // is left to the user via the terminal.
      await writeFile(path.join(targetDirectory, name), file.buffer);
      saved.push(name);
    }

    response.json({ ok: true, saved });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

/**
 * multipart filenames arrive as raw header bytes that busboy decodes as latin1,
 * which turns every non-ASCII name into mojibake. Re-decode as UTF-8; if that
 * produces replacement characters the value was not UTF-8 after all, so keep it.
 */
function decodeUploadName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

app.post('/api/write', requireAuth, async (request, response) => {
  try {
    const absolute = await resolveSafePathAsync((request.body as { path?: unknown })?.path);
    const content = (request.body as { content?: unknown })?.content;

    if (typeof content !== 'string') throw new Error('缺少文件内容');
    await writeFileContent(absolute, content);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.post('/api/create', requireAuth, async (request, response) => {
  try {
    const body = request.body as { path?: unknown; type?: unknown };
    const absolute = await resolveSafePathAsync(body?.path);

    if (body?.type !== 'file' && body?.type !== 'directory') throw new Error('类型必须是 file 或 directory');
    await createEntry(absolute, body.type);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.post('/api/rename', requireAuth, async (request, response) => {
  try {
    const body = request.body as { from?: unknown; to?: unknown };
    await renameEntry(await resolveSafePathAsync(body?.from), await resolveSafePathAsync(body?.to));
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

app.post('/api/delete', requireAuth, async (request, response) => {
  try {
    const absolute = await resolveSafePathAsync((request.body as { path?: unknown })?.path);
    await deleteEntry(absolute, ROOT);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: describe(error) });
  }
});

function describe(error: unknown): string {
  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '文件或目录不存在';
    if ((error as NodeJS.ErrnoException).code === 'EACCES') return '没有访问权限';
    return error.message;
  }
  return '未知错误';
}

if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next();
      return;
    }
    response.sendFile(path.join(clientDir, 'index.html'));
  });
} else {
  app.get('/', (_request, response) => {
    response.type('text/plain').send('前端尚未构建：先运行 npm run build');
  });
}

app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  response.status(500).json({ error: '服务内部错误' });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

/**
 * Cookies have no port scope, so any page on this host can open a WebSocket to
 * us with the session cookie attached (cross-site WebSocket hijacking). Browsers
 * always send Origin on a WebSocket handshake, so require it to match our host.
 * Non-browser clients (curl, tests) send none and are allowed through.
 */
function originAllowed(request: { headers: Record<string, string | string[] | undefined> }): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return true;

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

server.on('upgrade', (request, socket, head) => {
  // An exception here is an uncaughtException, not a 500: the whole process
  // would die from a single malformed request.
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname !== '/shell') {
      socket.destroy();
      return;
    }

    if (!originAllowed(request)) {
      console.warn('[upgrade] rejected cross-origin handshake:', request.headers.origin);
      socket.destroy();
      return;
    }

    if (!verifyToken(readCookie(request.headers.cookie, 'lens_session'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  } catch (error) {
    console.error('[upgrade] rejected malformed request:', error instanceof Error ? error.message : error);
    socket.destroy();
  }
});

wss.on('connection', (client) => {
  handleShell(client);
});

server.listen(PORT, HOST, () => {
  const lines = [
    '',
    '  文件阅览器 已启动',
    `  访问地址  http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`,
    `  可浏览    ${ROOT}`,
    HOST === '0.0.0.0' ? '  已对内网开放' : '  仅本机可访问（设 LENS_HOST=0.0.0.0 开放内网）',
    '',
  ];
  console.log(lines.join('\n'));
});
