import { useCallback, useEffect, useState } from 'react';

import FileTree from './components/FileTree';
import Login from './components/Login';
import Preview, { type ViewMode } from './components/Preview';
import TerminalPane from './components/TerminalPane';
import { api, ApiError, type Entry, type FilePayload } from './lib/api';

type Phase = 'checking' | 'login' | 'ready';
type Tab = 'files' | 'terminal';

export default function App() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [tab, setTab] = useState<Tab>('files');
  const [root, setRoot] = useState('');

  const [file, setFile] = useState<FilePayload | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
                  tab === value ? 'bg-[var(--ink-700)] text-white' : 'text-paper-faint hover:text-paper'
                }`}
              >
                {value === 'files' ? '文件' : '终端'}
              </button>
            ))}
          </div>

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
          <aside className="w-[280px] shrink-0 border-r border-[var(--rule)] bg-[var(--ink-900)]">
            <FileTree
              selectedPath={selectedPath}
              onOpenFile={(entry) => void openFile(entry)}
              onDeleted={handleDeleted}
              onRenamed={handleRenamed}
            />
          </aside>
          <main className="min-w-0 flex-1">
            <Preview
              file={file}
              loading={loading}
              error={error}
              mode={mode}
              onModeChange={setMode}
              onRetry={retry}
              onSave={saveFile}
              onClose={closeFile}
            />
          </main>
        </div>

        <div className={`h-full bg-ink-950 ${tab === 'terminal' ? 'block' : 'hidden'}`}>
          <TerminalPane active={tab === 'terminal'} />
        </div>
      </div>
    </div>
  );
}
