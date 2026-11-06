import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import FileTree from './components/FileTree';
import Login from './components/Login';
import Preview, { type ViewMode } from './components/Preview';
import TerminalPane from './components/TerminalPane';
import { api, ApiError, type Entry, type FilePayload } from './lib/api';

type Phase = 'checking' | 'login' | 'ready';
type Tab = 'files' | 'terminal';

const SIDEBAR_KEY = 'ssh-lens:sidebar-open';
const SIDEBAR_WIDTH_KEY = 'ssh-lens:sidebar-width';
const THEME_KEY = 'ssh-lens:theme';

const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 720;

type Theme = 'dark' | 'light';

function clampSidebarWidth(width: number): number {
  const viewportCap = Math.round(window.innerWidth * 0.6);
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), Math.min(SIDEBAR_MAX_WIDTH, viewportCap));
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [tab, setTab] = useState<Tab>('files');
  const [root, setRoot] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) !== '0',
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return clampSidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : SIDEBAR_DEFAULT_WIDTH);
  });
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const [file, setFile] = useState<FilePayload | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('render');

  const loadRoot = useCallback(async () => {
    try {
      const { root: directory } = await api.root();
      setRoot(directory);
      setPhase('ready');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setPhase('login');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const { authenticated } = await api.session().catch(() => ({ authenticated: false }));
      if (!authenticated) {
        setPhase('login');
        return;
      }
      await loadRoot();
    })();
  }, [loadRoot]);

  const openFile = useCallback(async (entry: Entry) => {
    setSelectedPath(entry.path);
    setLoading(true);
    setError(null);
    setMode('render');

    try {
      setFile(await api.file(entry.path));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setPhase('login');
        return;
      }
      setError(caught instanceof Error ? caught.message : '读取文件失败');
      setFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    if (!selectedPath) return;
    void openFile({
      name: selectedPath.split('/').pop() ?? selectedPath,
      path: selectedPath,
      type: 'file',
      size: 0,
      modified: 0,
    });
  }, [openFile, selectedPath]);

  const saveFile = useCallback(async (path: string, content: string) => {
    await api.write(path, content);
    setFile((previous) =>
      previous && previous.path === path
        ? { ...previous, content, size: new TextEncoder().encode(content).length }
        : previous,
    );
  }, []);

  /**
   * Quiet re-read after a tree refresh: no loading screen, because the reader
   * is already looking at content. Preview keeps any unsaved draft.
   */
  const refreshOpenFile = useCallback(async () => {
    if (!selectedPath) return;

    try {
      setFile(await api.file(selectedPath));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setPhase('login');
      // The tree refresh already reflects a delete/rename; keep the content.
    }
  }, [selectedPath]);

  /**
   * Manual re-read of the open file: picks up edits made outside the browser
   * (terminal, editor, AI agent) without a page reload. A failed re-read keeps
   * the current content on screen and reports the problem in the notice bar.
   */
  const reloadFile = useCallback(async () => {
    if (!selectedPath || reloading) return;

    setReloading(true);
    setError(null);

    try {
      setFile(await api.file(selectedPath));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setPhase('login');
        return;
      }
      setError(caught instanceof Error ? caught.message : '读取文件失败');
    } finally {
      setReloading(false);
    }
  }, [selectedPath, reloading]);

  const closeFile = useCallback(() => {
    setFile(null);
    setSelectedPath(null);
    setError(null);
  }, []);

  const handleDeleted = useCallback((path: string) => {
    setSelectedPath((previous) => {
      if (previous === path || previous?.startsWith(`${path}/`)) {
        setFile(null);
        return null;
      }
      return previous;
    });
  }, []);

  const handleRenamed = useCallback((from: string, to: string) => {
    setSelectedPath((previous) => {
      if (!previous) return previous;

      const updated =
        previous === from
          ? to
          : previous.startsWith(`${from}/`)
            ? `${to}${previous.slice(from.length)}`
            : previous;

      if (updated !== previous) {
        setFile((current) => (current ? { ...current, path: updated } : current));
      }

      return updated;
    });
  }, []);

  // Persist only settled widths, so dragging does not hammer localStorage.
  useEffect(() => {
    if (!resizing) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [resizing, sidebarWidth]);

  useEffect(() => {
    const keepInViewport = () => setSidebarWidth((current) => clampSidebarWidth(current));
    window.addEventListener('resize', keepInViewport);
    return () => window.removeEventListener('resize', keepInViewport);
  }, []);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setResizing(true);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setSidebarWidth(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX));
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setFile(null);
    setSelectedPath(null);
    setPhase('login');
  }

  if (phase === 'checking') {
    return (
      <div className="grid h-full place-items-center">
        <p className="font-mono text-[11px] tracking-[0.24em] text-paper-faint">连接中…</p>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <Login
        onSuccess={() => {
          void loadRoot();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--rule)] px-4">
        <button
          onClick={() => {
            setSidebarOpen((previous) => {
              localStorage.setItem(SIDEBAR_KEY, previous ? '0' : '1');
              return !previous;
            });
          }}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? '收起文件树，放大阅读区' : '展开文件树'}
          className="-ml-1 shrink-0 border border-transparent px-1.5 py-0.5 font-mono text-[13px] text-paper-faint transition-colors hover:border-[var(--rule)] hover:text-paper"
        >
          {sidebarOpen ? '◧' : '▢'}
        </button>

        <span className="font-serif text-[15px] tracking-tight text-paper">文件阅览器</span>
        <span className="hidden max-w-[28rem] truncate font-mono text-[10.5px] text-paper-faint/70 md:inline">
          {root}
        </span>

        <div className="ml-auto flex items-center gap-4">
          <div role="tablist" aria-label="视图" className="flex overflow-hidden border border-[var(--rule)]">
            {(['files', 'terminal'] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`px-3 py-1 text-[11.5px] transition-colors ${
                  tab === value ? 'bg-[var(--ink-700)] text-[var(--paper)]' : 'text-paper-faint hover:text-paper'
                }`}
              >
                {value === 'files' ? '文件' : '终端'}
              </button>
            ))}
          </div>

          <button
            onClick={() => void reloadFile()}
            disabled={!selectedPath || reloading}
            aria-label="刷新当前文件"
            title={selectedPath ? '重新读取文件，查看外部修改' : '没有打开的文件'}
            className="shrink-0 px-1 font-mono text-[13px] leading-none text-paper-faint transition-colors hover:text-paper disabled:opacity-25"
          >
            <span className={`inline-block ${reloading ? 'animate-spin' : ''}`}>↻</span>
          </button>

          <button
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            className="px-1 font-mono text-[13px] text-paper-faint transition-colors hover:text-paper"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <button
            onClick={() => void logout()}
            className="text-[10.5px] tracking-[0.16em] text-paper-faint transition-colors hover:text-paper"
          >
            登出
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className={`h-full ${tab === 'files' ? 'flex' : 'hidden'}`}>
          {/* Collapsing keeps the tree mounted so its cache and expansion state survive. */}
          <div
            className={`relative h-full shrink-0 ${
              resizing ? '' : 'transition-[width] duration-200 ease-out'
            }`}
            style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          >
            <aside
              className={`h-full w-full overflow-hidden bg-[var(--ink-900)] ${
                sidebarOpen ? 'border-r border-[var(--rule)]' : ''
              }`}
            >
              <FileTree
                selectedPath={selectedPath}
                onOpenFile={(entry) => void openFile(entry)}
                onDeleted={handleDeleted}
                onRenamed={handleRenamed}
                onRefresh={() => void refreshOpenFile()}
              />
            </aside>

            {sidebarOpen && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整文件树宽度"
                title="拖动调整宽度，双击恢复默认"
                onPointerDown={startResize}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
                className={`absolute inset-y-0 -right-[3px] z-20 w-[6px] cursor-col-resize transition-colors ${
                  resizing ? 'bg-amber/70' : 'hover:bg-amber/50'
                }`}
              />
            )}
          </div>
          <main className="min-w-0 flex-1">
            <Preview
              file={file}
              loading={loading}
              error={error}
              mode={mode}
              theme={theme}
              onModeChange={setMode}
              onRetry={retry}
              onSave={saveFile}
              onClose={closeFile}
            />
          </main>
        </div>

        <div className={`h-full bg-ink-950 ${tab === 'terminal' ? 'block' : 'hidden'}`}>
          <TerminalPane active={tab === 'terminal'} theme={theme} />
        </div>

        {/* While dragging, this layer keeps iframes and panes from swallowing pointer events. */}
        {resizing && (
          <div
            className="fixed inset-0 z-30 cursor-col-resize"
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        )}
      </div>
    </div>
  );
}
