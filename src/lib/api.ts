export type Entry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  modified: number;
};

export type PreviewKind = 'markdown' | 'html' | 'image' | 'pdf' | 'code' | 'binary';

export type FilePayload = {
  path: string;
  kind: PreviewKind;
  size: number;
  content?: string;
  tooLarge?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string };

  if (response.status === 401) throw new ApiError(body.error ?? '登录已过期', 401);
  if (!response.ok) throw new ApiError(body.error ?? `请求失败（${response.status}）`, response.status);

  return body as T;
}

export const api = {
  session: () => request<{ authenticated: boolean }>('/api/session'),

  login: (password: string) =>
    request<{ ok: true }>('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST' }),

  root: () => request<{ root: string }>('/api/root'),

  tree: (path: string) =>
    request<{ path: string; entries: Entry[] }>(`/api/tree?path=${encodeURIComponent(path)}`),

  file: (path: string) => request<FilePayload>(`/api/file?path=${encodeURIComponent(path)}`),

  rawUrl: (path: string) => `/api/raw?path=${encodeURIComponent(path)}`,

  write: (path: string, content: string) =>
    request<{ ok: true }>('/api/write', { method: 'POST', body: JSON.stringify({ path, content }) }),

  create: (path: string, type: 'file' | 'directory') =>
    request<{ ok: true }>('/api/create', { method: 'POST', body: JSON.stringify({ path, type }) }),

  rename: (from: string, to: string) =>
    request<{ ok: true }>('/api/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),

  remove: (path: string) =>
    request<{ ok: true }>('/api/delete', { method: 'POST', body: JSON.stringify({ path }) }),

  search: (path: string, query: string) =>
    request<{ results: Entry[] }>(
      `/api/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`,
    ),

  /** Multipart upload: Content-Type must stay unset so the browser adds the boundary. */
  upload: async (path: string, files: File[]): Promise<{ ok: true; saved: string[] }> => {
    const body = new FormData();
    for (const file of files) body.append('files', file);

    const response = await fetch(`/api/upload?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) throw new ApiError('登录已过期', 401);
    if (!response.ok) throw new ApiError(payload.error ?? `上传失败（${response.status}）`, response.status);

    return payload as { ok: true; saved: string[] };
  },
};
