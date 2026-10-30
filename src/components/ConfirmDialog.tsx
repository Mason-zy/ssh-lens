import { useState } from 'react';

type ConfirmDialogProps = {
  title: string;
  detail: string;
  confirmText?: string;
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  detail,
  confirmText = '删除',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const failure = await onConfirm();
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
        }}
      >
        <p className="text-[11px] tracking-[0.2em] text-[var(--danger)]">{title}</p>
        <p className="mt-3 break-all font-mono text-[12px] leading-relaxed text-paper-dim">{detail}</p>

        {error && <p className="mt-2 text-[11px] text-[var(--danger)]">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="border border-[var(--rule)] px-3 py-1.5 text-[11.5px] text-paper-dim hover:border-[var(--rule-strong)] hover:text-paper"
          >
            取消
          </button>
          <button
            onClick={() => void run()}
            disabled={busy}
            className="border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-1.5 text-[11.5px] text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-40"
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
