import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../lib/api';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await api.login(password);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '无法连接服务');
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)',
        }}
      />

      <form onSubmit={handleSubmit} className="relative w-full max-w-[19rem]">
        <p className="rise text-[11px] tracking-[0.3em] text-paper-faint" style={{ animationDelay: '0ms' }}>
          私有阅览器
        </p>

        <h1
          className="rise mt-4 font-serif text-[3rem] leading-none tracking-tight text-paper"
          style={{ animationDelay: '60ms' }}
        >
          文件阅览器
        </h1>

        <p className="rise mt-4 text-[13px] leading-relaxed text-paper-dim" style={{ animationDelay: '120ms' }}>
          浏览服务器上的文件，或直接打开终端。
        </p>

        <div className="rise mt-9" style={{ animationDelay: '180ms' }}>
          <label htmlFor="password" className="text-[10px] tracking-[0.22em] text-paper-faint">
            访问密码
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full border-0 border-b border-[var(--rule-strong)] bg-transparent px-0 py-2.5 font-mono text-[15px] tracking-[0.2em] text-paper placeholder:text-[var(--ink-700)] focus:border-amber focus:outline-none focus:ring-0"
            placeholder="••••••"
          />
        </div>

        {error && (
          <p role="alert" className="fade-in mt-3 font-mono text-[11px] text-[#d97757]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="rise mt-7 w-full border border-[var(--rule-strong)] bg-[var(--ink-850)] px-4 py-2.5 text-[13px] font-medium tracking-wide text-paper transition-colors hover:border-amber hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          style={{ animationDelay: '240ms' }}
        >
          {busy ? '验证中…' : '进入'}
        </button>
      </form>

      <p className="pointer-events-none absolute bottom-6 left-6 text-[10px] tracking-[0.24em] text-paper-faint/60">
        仅限内网
      </p>
    </div>
  );
}
