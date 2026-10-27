import { useEffect, useId, useState } from 'react';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((module) => {
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
      themeVariables: {
        background: '#14171c',
        primaryColor: '#1e232b',
        primaryTextColor: '#e9e6df',
        primaryBorderColor: '#2a3039',
        lineColor: '#6d6a63',
        secondaryColor: '#20252e',
        tertiaryColor: '#191d24',
        textColor: '#e9e6df',
      },
    });
    return mermaid;
  });

  return mermaidPromise;
}

export default function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const rendered = await mermaid.render(`m-${id}`, code.trim());
        if (alive) setSvg(rendered.svg);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [code, id]);

  if (failed) {
    return (
      <pre className="my-4 overflow-x-auto rounded border border-[var(--rule)] bg-[#101317] p-4 font-mono text-[11px] text-paper-dim">
        {code}
      </pre>
    );
  }

  if (!svg) return <p className="my-4 font-mono text-[11px] text-paper-faint">渲染图表…</p>;

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto rounded border border-[var(--rule)] bg-[#101317] p-5 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
