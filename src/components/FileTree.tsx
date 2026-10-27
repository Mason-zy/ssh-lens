import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, type Entry } from '../lib/api';
import ConfirmDialog from './ConfirmDialog';
import PromptDialog from './PromptDialog';

type FileTreeProps = {
  selectedPath: string | null;
  onOpenFile: (entry: Entry) => void;
  onDeleted: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
};

type Dialog =
  | { mode: 'create'; parent: string; type: 'file' | 'directory' }
  | { mode: 'rename'; entry: Entry }
  | { mode: 'delete'; entry: Entry };

const TINT: Record<string, string> = {
  md: 'text-amber',
  markdown: 'text-amber',
  html: 'text-[#c9855a]',
  htm: 'text-[#c9855a]',
  json: 'text-[#9aad85]',
  yml: 'text-[#9aad85]',
  yaml: 'text-[#9aad85]',
  png: 'text-[#8fa7c4]',
  jpg: 'text-[#8fa7c4]',
  jpeg: 'text-[#8fa7c4]',
  gif: 'text-[#8fa7c4]',
  svg: 'text-[#8fa7c4]',
  webp: 'text-[#8fa7c4]',
  pdf: 'text-[#c47f7f]',
};

function tintFor(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return TINT[extension] ?? 'text-paper-dim/70';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

export default function FileTree({ selectedPath, onOpenFile, onDeleted, onRenamed }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Map<string, Entry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showHidden, setShowHidden] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef('/');
  const generation = useRef(0);

  const load = useCallback(async (path: string) => {
    const current = generation.current;
    setLoading((previous) => new Set(previous).add(path));

    try {
      const { entries } = await api.tree(path);
      if (generation.current !== current) return;
      setCache((map) => new Map(map).set(path, entries));
      setError(null);
    } catch (caught) {
      if (generation.current !== current) return;
      setError(caught instanceof Error ? caught.message : '读取目录失败');
    } finally {
      if (generation.current === current) {
        setLoading((previous) => {
          const next = new Set(previous);
          next.delete(path);
          return next;
        });
      }
    }
  }, []);

  /** Re-reads every directory currently on screen after a mutation. */
  const reload = useCallback(async () => {
    const paths = ['/', ...expanded].filter((value, index, all) => all.indexOf(value) === index);
    const results = await Promise.all(paths.map((path) => api.tree(path).catch(() => null)));

    const next = new Map<string, Entry[]>();
    results.forEach((result, index) => {
      if (result) next.set(paths[index], result.entries);
    });

    setCache(next);
  }, [expanded]);

  useEffect(() => {
    generation.current += 1;
    void load('/');
  }, [load]);

  function toggle(entry: Entry) {
    const isOpen = expanded.has(entry.path);
    const next = new Set(expanded);

    if (isOpen) next.delete(entry.path);
    else {
      next.add(entry.path);
      if (!cache.has(entry.path)) void load(entry.path);
    }

    setExpanded(next);
  }

  const visible = useCallback(
    (entries: Entry[]) => (showHidden ? entries : entries.filter((entry) => !entry.name.startsWith('.'))),
    [showHidden],
  );

  // Searching goes to the server so it covers the whole tree, not just the
  // directories the reader happened to expand.
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(() => {
      void api
        .search('/', term)
        .then((found) => {
          if (!cancelled) setResults(found.results);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const rootEntries = visible(cache.get('/') ?? []);

  async function handleUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      await api.upload(uploadTarget.current, Array.from(files));
      if (uploadTarget.current !== '/') {
        const next = new Set(expanded).add(uploadTarget.current);
        setExpanded(next);
      }
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '上传失败');
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = '';
    }
  }

  const actions = {
    create: (parent: string, type: 'file' | 'directory') => setDialog({ mode: 'create', parent, type }),
    rename: (entry: Entry) => setDialog({ mode: 'rename', entry }),
    remove: (entry: Entry) => setDialog({ mode: 'delete', entry }),
    upload: (parent: string) => {
      uploadTarget.current = parent;
      uploadInput.current?.click();
    },
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--rule)] px-3 py-2.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="筛选已加载的文件"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-paper placeholder:text-paper-faint focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="shrink-0 text-[10px] text-paper-faint hover:text-paper">
            清除
          </button>
        )}
        <button
          onClick={() => setShowHidden((previous) => !previous)}
          aria-pressed={showHidden}
          title={showHidden ? '不显示以点开头的文件' : '显示以点开头的文件'}
          className="shrink-0 whitespace-nowrap text-[10px] text-paper-dim transition-colors hover:text-paper"
        >
          <span className={showHidden ? 'text-amber' : 'text-paper-faint/50'}>◉</span> 隐藏项
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--rule)] px-3 py-1.5">
        <button
          onClick={() => actions.create('/', 'file')}
          className="border border-[var(--rule)] px-2 py-0.5 text-[10.5px] text-paper-dim hover:border-amber hover:text-paper"
        >
          ＋ 文件
        </button>
        <button
          onClick={() => actions.create('/', 'directory')}
          className="border border-[var(--rule)] px-2 py-0.5 text-[10.5px] text-paper-dim hover:border-amber hover:text-paper"
        >
          ＋ 目录
        </button>
        <button
          onClick={() => {
            uploadTarget.current = '/';
            uploadInput.current?.click();
          }}
          disabled={uploading}
          className="border border-[var(--rule)] px-2 py-0.5 text-[10.5px] text-paper-dim hover:border-amber hover:text-paper disabled:opacity-40"
        >
          {uploading ? '上传中…' : '⇧ 上传'}
        </button>
        <input
          ref={uploadInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handleUpload(event.target.files)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {error && (
          <p className="mx-3 my-2 border-l-2 border-[#d97757] pl-2 text-[11px] leading-relaxed text-[#d97757]">
            {error}
          </p>
        )}

        {results ? (
          results.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-paper-faint">
              {searching ? '搜索中…' : '没有匹配项'}
            </p>
          ) : (
            results.map((entry) => (
              <button
                key={entry.path}
                onClick={() => (entry.type === 'directory' ? setQuery('') : onOpenFile(entry))}
                className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12.5px] hover:bg-[var(--ink-850)]"
              >
                <span className={entry.type === 'directory' ? 'text-paper-faint' : tintFor(entry.name)}>
                  {entry.type === 'directory' ? '▸' : '·'}
                </span>
                <span className="truncate">{entry.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-paper-faint/70">
                  {entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'}
                </span>
              </button>
            ))
          )
        ) : loading.has('/') && rootEntries.length === 0 ? (
          <p className="px-3 py-4 font-mono text-[11px] text-paper-faint">读取中…</p>
        ) : rootEntries.length === 0 && !error ? (
          <p className="px-3 py-4 text-[12px] text-paper-faint">空目录</p>
        ) : (
          rootEntries.map((entry) => (
            <TreeRow
              key={entry.path}
              entry={entry}
              level={0}
              expanded={expanded}
              cache={cache}
              loading={loading}
              selectedPath={selectedPath}
              visible={visible}
              onToggle={toggle}
              onOpenFile={onOpenFile}
              actions={actions}
            />
          ))
        )}
      </div>

      {dialog?.mode === 'create' && (
        <PromptDialog
          title={dialog.type === 'directory' ? '新建目录' : '新建文件'}
          hint={`位置：${dialog.parent}`}
          confirmText="创建"
          onSubmit={async (name) => {
            try {
              await api.create(joinPath(dialog.parent, name), dialog.type);
              await reload();
              setDialog(null);
              return null;
            } catch (caught) {
              return caught instanceof Error ? caught.message : '创建失败';
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.mode === 'rename' && (
        <PromptDialog
          title="重命名"
          hint={dialog.entry.path}
          defaultValue={dialog.entry.name}
          confirmText="重命名"
          onSubmit={async (name) => {
            const parent = dialog.entry.path.slice(0, dialog.entry.path.lastIndexOf('/')) || '/';
            const target = joinPath(parent, name);

            try {
              await api.rename(dialog.entry.path, target);
              onRenamed(dialog.entry.path, target);
              await reload();
              setDialog(null);
              return null;
            } catch (caught) {
              return caught instanceof Error ? caught.message : '重命名失败';
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.mode === 'delete' && (
        <ConfirmDialog
          title={dialog.entry.type === 'directory' ? '删除目录' : '删除文件'}
          detail={
            dialog.entry.type === 'directory'
              ? `${dialog.entry.path}\n目录内的所有内容会一并删除，无法撤销。`
              : dialog.entry.path
          }
          onConfirm={async () => {
            try {
              await api.remove(dialog.entry.path);
              onDeleted(dialog.entry.path);
              await reload();
              setDialog(null);
              return null;
            } catch (caught) {
              return caught instanceof Error ? caught.message : '删除失败';
            }
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

type TreeRowProps = {
  entry: Entry;
  level: number;
  expanded: Set<string>;
  cache: Map<string, Entry[]>;
  loading: Set<string>;
  selectedPath: string | null;
  visible: (entries: Entry[]) => Entry[];
  onToggle: (entry: Entry) => void;
  onOpenFile: (entry: Entry) => void;
  actions: {
    create: (parent: string, type: 'file' | 'directory') => void;
    rename: (entry: Entry) => void;
    remove: (entry: Entry) => void;
    upload: (parent: string) => void;
  };
};

function TreeRow({
  entry,
  level,
  expanded,
  cache,
  loading,
  selectedPath,
  visible,
  onToggle,
  onOpenFile,
  actions,
}: TreeRowProps) {
  const isDirectory = entry.type === 'directory';
  const isOpen = isDirectory && expanded.has(entry.path);
  const cached = cache.get(entry.path);
  const children = cached && visible(cached);
  const isSelected = selectedPath === entry.path;

  // Children are siblings, not nested: nesting them inside this row's
  // `group/row` would make a hover on any descendant light up this row too.
  return (
    <>
      <div className="group/row relative">
        <button
        onClick={() => (isDirectory ? onToggle(entry) : onOpenFile(entry))}
        title={entry.path}
        className={`flex w-full items-baseline gap-1.5 py-[3px] pr-14 text-left text-[12.5px] transition-colors hover:bg-[var(--ink-850)] ${
          isSelected ? 'bg-[var(--ink-850)] text-white' : 'text-paper-dim'
        }`}
        style={{ paddingLeft: `${level * 13 + 12}px` }}
      >
        {isSelected && <span className="absolute inset-y-0 left-0 w-[2px] bg-amber" />}
        <span className={`shrink-0 text-[10px] ${isDirectory ? 'text-paper-faint' : tintFor(entry.name)}`}>
          {isDirectory ? (isOpen ? '▾' : '▸') : '·'}
        </span>
        <span className={`truncate ${isDirectory ? '' : 'font-mono text-[11.5px]'}`}>{entry.name}</span>
        {!isDirectory && (
          <span className="ml-auto shrink-0 pl-2 font-mono text-[9px] text-paper-faint/0 transition-colors group-hover/row:text-paper-faint/70">
            {formatSize(entry.size)}
          </span>
        )}
        {isDirectory && isOpen && loading.has(entry.path) && !children && (
          <span className="ml-1 font-mono text-[9px] text-paper-faint">…</span>
        )}
      </button>

      <div
        className={`absolute inset-y-0 right-1.5 flex items-center gap-0.5 transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
        }`}
      >
        {isDirectory && (
          <>
            <RowAction label={`在 ${entry.name} 中新建文件`} onClick={() => actions.create(entry.path, 'file')}>
              ＋
            </RowAction>
            <RowAction label={`上传到 ${entry.name}`} onClick={() => actions.upload(entry.path)}>
              ⇧
            </RowAction>
          </>
        )}
        <RowAction label={`重命名 ${entry.name}`} onClick={() => actions.rename(entry)}>
          ✎
        </RowAction>
        <RowAction label={`删除 ${entry.name}`} onClick={() => actions.remove(entry)} danger>
          ✕
        </RowAction>
      </div>

      </div>

      {isOpen &&
        children?.map((child) => (
          <TreeRow
            key={child.path}
            entry={child}
            level={level + 1}
            expanded={expanded}
            cache={cache}
            loading={loading}
            selectedPath={selectedPath}
            visible={visible}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
            actions={actions}
          />
        ))}
    </>
  );
}

function RowAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`px-1 text-[11px] leading-none text-paper-faint hover:text-paper ${
        danger ? 'hover:!text-[#d97757]' : ''
      }`}
    >
      {children}
    </button>
  );
}
