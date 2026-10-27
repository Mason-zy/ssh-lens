import { useMemo } from 'react';

import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';

import { languageOf } from '../lib/highlight';

type EditorProps = {
  value: string;
  path: string;
  onChange: (value: string) => void;
};

function languageFor(filePath: string) {
  const extension = languageOf(filePath);

  switch (extension) {
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'js':
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'json':
      return [json()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
      return [css()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

export default function Editor({ value, path, onChange }: EditorProps) {
  const extensions = useMemo(() => languageFor(path), [path]);

  return (
    <div className="h-full overflow-auto bg-[#101317]">
      <CodeMirror
        value={value}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          autocompletion: false,
        }}
        style={{ fontSize: 13 }}
      />
    </div>
  );
}
