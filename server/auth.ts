import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { resolvePassword } from './config.js';

const COOKIE = 'lens_session';
const TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * `??` would let an empty env var through, which makes the HMAC key publicly
 * known — anyone could mint a valid session. Require a real key or fall back.
 */
function resolveSigningKey(): string {
  const provided = process.env.LENS_SESSION_KEY;

  if (provided && provided.length >= 32) return provided;
  if (provided) {
    console.warn('[auth] LENS_SESSION_KEY 短于 32 字符，已忽略并改用随机密钥');
  }

  return randomBytes(32).toString('hex');
}

const KEY = resolveSigningKey();
const PASSWORD = resolvePassword();

/** Constant-time comparison that does not leak the password length. */
function passwordMatches(candidate: unknown): boolean {
  if (typeof candidate !== 'string') return false;

  const a = createHmac('sha256', KEY).update(candidate).digest();
  const b = createHmac('sha256', KEY).update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

const MAX_FAILURES = 5;
const WINDOW_MS = 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function sign(payload: string): string {
  return createHmac('sha256', KEY).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function issueToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_SECONDS * 1000 })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  if (!safeEqual(sign(payload), token.slice(separator + 1))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Reads a cookie without pulling in a parser dependency. A malformed escape
 * sequence must never throw: this runs inside the WebSocket upgrade handler,
 * where an exception becomes an uncaughtException and kills the process.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;

    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw; // undecodable value cannot match a signed token anyway
    }
  }

  return undefined;
}

export function checkLogin(ip: string, candidate: unknown): { ok: boolean; message?: string; retry?: number } {
  const now = Date.now();
  const entry = failures.get(ip);

  if (entry && now < entry.resetAt && entry.count >= MAX_FAILURES) {
    return { ok: false, message: '尝试过于频繁，请稍后再试', retry: Math.ceil((entry.resetAt - now) / 1000) };
  }

  if (!passwordMatches(candidate)) {
    const next = entry && now < entry.resetAt ? entry : { count: 0, resetAt: now + WINDOW_MS };
    next.count += 1;
    failures.set(ip, next);
    return { ok: false, message: '密码错误' };
  }

  failures.delete(ip);
  return { ok: true };
}

export function sendSessionCookie(response: Response): void {
  response.setHeader(
    'Set-Cookie',
    `${COOKIE}=${issueToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_SECONDS}`,
  );
}

export function clearSessionCookie(response: Response): void {
  response.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export function isAuthenticated(request: Request): boolean {
  return verifyToken(readCookie(request.headers.cookie, COOKIE));
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (isAuthenticated(request)) {
    next();
    return;
  }
  response.status(401).json({ error: '未登录' });
}

export function clientIp(request: Request): string {
  return request.socket.remoteAddress ?? '';
}
