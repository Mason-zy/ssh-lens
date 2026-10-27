import { useEffect, useMemo, useState } from 'react';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { api, type FilePayload, type PreviewKind } from '../lib/api';
import { highlight, languageOf } from '../lib/highlight';
import Editor from './Editor';
import Mermaid from './Mermaid';

export type ViewMode = 'render' | 'source';

type PreviewProps = {
  file: FilePayload | null;
  loading: boolean;
  error: string | null;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onRetry: () => void;
  onSave: (path: string, content: string) => Promise<void>;
  onClose: () => void;
};

const KIND_LABEL: Record<PreviewKind, string> = {
  markdown: '文档',
  html: '网页',
  image: '图片',
  pdf: 'PDF',
  code: '代码',
  binary: '二进制',
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const EDITABLE: PreviewKind[] = ['markdown', 'html', 'code'];

export default function Preview({
  file,
  loading,
  error,
  mode,
  onModeChange,
  onRetry,
  onSave,
  onClose,
}: PreviewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // A different file resets every per-file control.
  useEffect(() => {
    setEditing(false);
    setDraft(file?.content ?? '');
    setSaveError(null);
    setZoom(1);
  }, [file?.path, file?.content]);

  const editable = file !== null && EDITABLE.includes(file.kind) && typeof file.content === 'string';
  const dirty = editing && draft !== (file?.content ?? '');

  async function save() {
    if (!file || saving) return;

    setSaving(true);
    setSaveError(null);

    try {
      await onSave(file.path, draft);
      setEditing(false);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar
        file={file}
        mode={mode}
        zoom={zoom}
        canToggle={file?.kind === 'markdown' || file?.kind === 'html'}
        editable={editable}
        editing={editing}
        dirty={dirty}
        saving={saving}
        onModeChange={onModeChange}
        onZoomChange={setZoom}
        onEdit={() => {
          setDraft(file?.content ?? '');
          setEditing(true);
        }}
        onCancel={() => {
          setEditing(false);
          setDraft(file?.content ?? '');
          setSaveError(null);
        }}
        onSave={() => void save()}
        onClose={onClose}
      />

      {saveError && (
        <p className="border-b border-[#d97757]/30 bg-[#d97757]/10 px-4 py-1.5 text-[11px] text-[#e89a80]">
          {saveError}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {editing && file ? (
          <Editor value={draft} path={file.path} onChange={setDraft} />
        ) : (
          <Body file={file} loading={loading} error={error} mode={mode} zoom={zoom} onRetry={onRetry} />
        )}
      </div>
    </div>
  );
}

function Toolbar({
  file,
  mode,
  zoom,
  canToggle,
  editable,
  editing,
  dirty,
  saving,
  onModeChange,
  onZoomChange,
  onEdit,
  onCancel,
  onSave,
  onClose,
}: {
  file: FilePayload | null;
  mode: ViewMode;
  zoom: number;
  canToggle: boolean;
  editable: boolean;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  onModeChange: (mode: ViewMode) => void;
  onZoomChange: (zoom: number) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  if (!file) {
    return (
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--rule)] px-4">
        <span className="text-[10.5px] tracking-[0.18em] text-paper-faint/60">选择文件</span>
      </div>
    );
  }

  const segments = file.path.split('/').filter(Boolean);
  const fileName = segments.at(-1) ?? file.path;
  const zoomIndex = ZOOM_STEPS.indexOf(zoom);

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--rule)] px-4">
      <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-paper-faint" title={file.path}>
        <span className="text-paper-dim/60">/</span>
        {segments.slice(0, -1).map((segment, index) => (
          <span key={`${segment}-${index}`}>
            <span className="text-paper-dim/70">{segment}</span>
            <span className="text-paper-faint/50">/</span>
          </span>
        ))}
        <span className="text-paper">{fileName}</span>
        {dirty && <span className="ml-2 text-amber">●</span>}
      </p>

      <span className="shrink-0 font-mono text-[10px] text-paper-faint/70">{formatSize(file.size)}</span>
      <span className="shrink-0 border border-[var(--rule)] px-1.5 py-0.5 text-[10px] text-paper-faint/80">
        {KIND_LABEL[file.kind]}
      </span>

      {file.kind === 'html' && (
        <div className="flex shrink-0 items-center overflow-hidden border border-[var(--rule)]">
          <button
            onClick={() => onZoomChange(ZOOM_STEPS[Math.max(zoomIndex - 1, 0)])}
            disabled={zoomIndex <= 0}
            aria-label="缩小"
            className="px-1.5 py-0.5 text-[11px] text-paper-faint hover:text-paper disabled:opacity-30"
          >
            −
          </button>
          <span className="w-10 text-center font-mono text-[10px] text-paper-dim">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(ZOOM_STEPS[Math.min(zoomIndex + 1, ZOOM_STEPS.length - 1)])}
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            aria-label="放大"
            className="px-1.5 py-0.5 text-[11px] text-paper-faint hover:text-paper disabled:opacity-30"
          >
            ＋
          </button>
        </div>
      )}

      {canToggle && !editing && (
        <div role="group" aria-label="显示方式" className="flex shrink-0 overflow-hidden border border-[var(--rule)]">
          {(['render', 'source'] as const).map((value) => (
            <button
              key={value}
              onClick={() => onModeChange(value)}
              aria-pressed={mode === value}
              className={`px-2 py-0.5 text-[10.5px] transition-colors ${
                mode === value ? 'bg-[var(--ink-700)] text-white' : 'text-paper-faint hover:text-paper'
              }`}
            >
              {value === 'render' ? '渲染' : '源码'}
            </button>
          ))}
        </div>
      )}

      {editable &&
        (editing ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              className="border border-amber/50 bg-amber/10 px-2.5 py-0.5 text-[10.5px] text-amber hover:border-amber disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={onCancel}
              className="border border-[var(--rule)] px-2.5 py-0.5 text-[10.5px] text-paper-faint hover:text-paper"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="shrink-0 border border-[var(--rule)] px-2.5 py-0.5 text-[10.5px] text-paper-dim hover:border-amber hover:text-paper"
          >
            编辑
          </button>
        ))}

      <button
        onClick={onClose}
        aria-label="关闭文件"
        className="shrink-0 text-[11px] text-paper-faint hover:text-paper"
      >
        ✕
      </button>
    </div>
  );
}

function Body({
  file,
  loading,
  error,
  mode,
  zoom,
  onRetry,
}: {
  file: FilePayload | null;
  loading: boolean;
  error: string | null;
  mode: ViewMode;
  zoom: number;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="grid h-full place-items-center px-8">
        <div className="max-w-md border-l-2 border-[#d97757] pl-5">
          <p className="text-[10px] tracking-[0.18em] text-[#d97757]">读取失败</p>
          <p className="mt-3 text-[13px] leading-relaxed text-paper-dim">{error}</p>
          <button
            onClick={onRetry}
            className="mt-4 border border-[var(--rule-strong)] px-3 py-1.5 text-[11px] hover:border-amber"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <p className="font-mono text-[11px] tracking-[0.2em] text-paper-faint">读取中…</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <p className="font-serif text-[1.6rem] text-paper-dim">未选择文件</p>
          <p className="mt-2 text-[10.5px] tracking-[0.18em] text-paper-faint">从左侧目录中打开一个文件</p>
        </div>
      </div>
    );
  }

  const key = `${file.path}:${file.kind}:${mode}`;

  if (mode === 'source' && (file.kind === 'markdown' || file.kind === 'html')) {
    return (
      <div key={key} className="fade-in h-full">
        <CodeView content={file.content ?? ''} path={file.path} />
      </div>
    );
  }

  return (
    <div key={key} className="fade-in h-full">
      {renderView(file, zoom)}
    </div>
  );
}

function renderView(file: FilePayload, zoom: number) {
  const name = file.path.split('/').pop() ?? file.path;

  switch (file.kind) {
    case 'markdown':
      return <MarkdownView content={file.content ?? ''} />;
    case 'html':
      return (
        <div className="h-full overflow-auto">
          <iframe
            title={name}
            srcDoc={file.content ?? ''}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
            style={{ zoom }}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      );
    case 'code':
      return <CodeView content={file.content ?? ''} path={file.path} />;
    case 'image':
      return (
        <div className="grid h-full place-items-center overflow-auto bg-[#0f1216] p-8">
          <figure className="max-w-full">
            <img
              src={api.rawUrl(file.path)}
              alt={name}
              className="max-h-[calc(100vh-8rem)] max-w-full rounded border border-[var(--rule)] object-contain"
            />
            <figcaption className="mt-3 text-center font-mono text-[10px] text-paper-faint">{file.path}</figcaption>
          </figure>
        </div>
      );
    case 'pdf':
      return (
        <iframe
          title={name}
          src={api.rawUrl(file.path)}
          className="h-full w-full border-0 bg-[#0f1216]"
          referrerPolicy="no-referrer"
        />
      );
    default:
      return (
        <Fallback path={file.path} size={file.size} rawUrl={api.rawUrl(file.path)} tooLarge={file.tooLarge} />
      );
  }
}

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <article className="reading">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              const { className, children } = props as { className?: string; children?: React.ReactNode };
              const match = /language-([\w-]+)/.exec(className ?? '');
              const text = String(children ?? '').replace(/\n$/, '');

              if (match?.[1] === 'mermaid') return <Mermaid code={text} />;
              if (match) {
                return (
                  <code className={className} dangerouslySetInnerHTML={{ __html: highlight(text, match[1]) }} />
                );
              }

              return <code className={className}>{children}</code>;
            },
            a(props) {
              const { href, children } = props as { href?: string; children?: React.ReactNode };
              return (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function CodeView({ content, path }: { content: string; path: string }) {
  const html = useMemo(() => highlight(content, languageOf(path)), [content, path]);
  const lines = useMemo(() => content.split('\n').length, [content]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <pre className="min-h-full bg-[#101317] px-5 py-4 font-mono text-[12.5px] leading-[1.65] text-paper-dim">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
      <div className="shrink-0 border-t border-[var(--rule)] px-5 py-1.5 font-mono text-[9.5px] tracking-[0.18em] text-paper-faint/70">
        {lines} 行
      </div>
    </div>
  );
}

function Fallback({
  path,
  size,
  rawUrl,
  tooLarge,
}: {
  path: string;
  size: number;
  rawUrl: string;
  tooLarge?: boolean;
}) {
  return (
    <div className="grid h-full place-items-center px-8">
      <div className="max-w-sm border-l-2 border-[var(--rule-strong)] pl-5">
        <p className="text-[10px] tracking-[0.18em] text-paper-faint">{tooLarge ? '文件过大' : '二进制文件'}</p>
        <p className="mt-3 text-[13px] leading-relaxed text-paper-dim">
          {tooLarge ? `文件 ${formatSize(size)}，超过在线预览上限，未加载内容。` : '无法作为文本渲染。'}
        </p>
        <p className="mt-2 break-all font-mono text-[10.5px] text-paper-faint">{path}</p>
        <a
          href={rawUrl}
          download
          className="mt-5 inline-block border border-[var(--rule-strong)] px-3.5 py-1.5 font-mono text-[11px] text-paper transition-colors hover:border-amber hover:text-white"
        >
          下载文件
        </a>
      </div>
    </div>
  );
}
