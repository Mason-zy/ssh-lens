import { useEffect, useId, useState } from 'react';

type Theme = 'dark' | 'light';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

const THEME_VARIABLES = {
  dark: {
    background: '#14171c',
    primaryColor: '#1e232b',
    primaryTextColor: '#e9e6df',
    primaryBorderColor: '#2a3039',
    lineColor: '#6d6a63',
    secondaryColor: '#20252e',
    tertiaryColor: '#191d24',
    textColor: '#e9e6df',
  },
  light: {
    background: '#faf8f3',
    primaryColor: '#eae6de',
    primaryTextColor: '#23272e',
    primaryBorderColor: '#cfc9bd',
    lineColor: '#868c95',
    secondaryColor: '#e0dbd2',
    tertiaryColor: '#f3f0e9',
    textColor: '#23272e',
  },
} as const;

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  return mermaidPromise;
}

export default function Mermaid({ code, theme }: { code: string; theme: Theme }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const mermaid = await loadMermaid();

        // initialize() is safe to call repeatedly; doing it per render lets the
        // diagram follow the page theme instead of staying dark on light.
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
          themeVariables: THEME_VARIABLES[theme],
        });

        const rendered = await mermaid.render(`m-${id}`, code.trim());
        if (alive) {
          setSvg(rendered.svg);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [code, id, theme]);

  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded border border-[var(--rule)] bg-[var(--code-bg)] p-4 font-mono text-[11px] text-paper-dim">
        {code}
      </pre>
    );
  }

  if (!svg) return <p className="my-4 font-mono text-[11px] text-paper-faint">渲染图表…</p>;

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto rounded border border-[var(--rule)] bg-[var(--code-bg)] p-5 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
