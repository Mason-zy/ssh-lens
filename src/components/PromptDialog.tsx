import { useEffect, useRef, useState } from 'react';

type PromptDialogProps = {
  title: string;
  hint?: string;
  defaultValue?: string;
  confirmText?: string;
  onSubmit: (value: string) => Promise<string | null> | string | null;
  onCancel: () => void;
};

/**
 * Small inline dialog instead of window.prompt: the native one is unstyled,
 * blocks the renderer, and cannot show a server error.
 */
export default function PromptDialog({
  title,
  hint,
  defaultValue = '',
  confirmText = '确定',
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);

    const failure = await onSubmit(trimmed);
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fade-in w-full max-w-sm border border-[var(--rule-strong)] bg-[var(--ink-900)] p-5"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter') void submit();
        }}
      >
        <p className="text-[11px] tracking-[0.2em] text-paper-faint">{title}</p>
        {hint && <p className="mt-2 font-mono text-[10.5px] text-paper-faint/70">{hint}</p>}

        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          className="mt-3 w-full border border-[var(--rule-strong)] bg-[var(--ink-950)] px-2.5 py-2 font-mono text-[12.5px] text-paper focus:border-amber focus:outline-none"
        />

        {error && <p className="mt-2 text-[11px] text-[#d97757]">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="border border-[var(--rule)] px-3 py-1.5 text-[11.5px] text-paper-dim hover:border-[var(--rule-strong)] hover:text-paper"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || value.trim().length === 0}
            className="border border-[var(--rule-strong)] bg-[var(--ink-800)] px-3 py-1.5 text-[11.5px] text-paper hover:border-amber hover:text-white disabled:opacity-40"
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
