import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['bash', bash],
  ['c', c],
  ['cpp', cpp],
  ['css', css],
  ['diff', diff],
  ['dockerfile', dockerfile],
  ['go', go],
  ['ini', ini],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['makefile', makefile],
  ['markdown', markdown],
  ['python', python],
  ['ruby', ruby],
  ['rust', rust],
  ['sql', sql],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
];

for (const [name, definition] of LANGUAGES) hljs.registerLanguage(name, definition);

const ALIASES: Record<string, string> = {
  sh: 'bash',
  zsh: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  yml: 'yaml',
  toml: 'ini',
  conf: 'ini',
  rs: 'rust',
  md: 'markdown',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code: string, language: string): string {
  const resolved = ALIASES[language] ?? language;

  if (resolved && hljs.getLanguage(resolved)) {
    try {
      return hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
    } catch {
      /* fall through */
    }
  }

  return escapeHtml(code);
}

/** Files whose name (not extension) implies a language. */
const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  '.bashrc': 'bash',
  '.bash_profile': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.bash_aliases': 'bash',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
};

export function languageOf(filePath: string): string {
  const name = filePath.split('/').pop() ?? '';
  const lower = name.toLowerCase();

  const byName = FILENAME_LANGUAGES[lower];
  if (byName) return byName;

  const dot = name.lastIndexOf('.');
  if (dot <= 0) return ''; // no extension, or a dotfile we don't recognise

  return name.slice(dot + 1).toLowerCase();
}
