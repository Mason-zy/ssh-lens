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

  /**
   * Multipart upload. Uses XHR rather than fetch because only XHR exposes
   * upload progress; Content-Type stays unset so the browser adds the boundary.
   */
  upload: (
    path: string,
    files: File[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<{ ok: true; saved: string[] }> =>
    new Promise((resolve, reject) => {
      const body = new FormData();
      for (const file of files) body.append('files', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?path=${encodeURIComponent(path)}`);
      xhr.withCredentials = true;

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      });

      xhr.addEventListener('load', () => {
        let payload: { error?: string; saved?: string[] } = {};
        try {
          payload = JSON.parse(xhr.responseText) as { error?: string; saved?: string[] };
        } catch {
          /* empty or non-JSON body */
        }

        if (xhr.status === 401) {
          reject(new ApiError('登录已过期', 401));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError(payload.error ?? `上传失败（${xhr.status}）`, xhr.status));
          return;
        }

        resolve({ ok: true, saved: payload.saved ?? [] });
      });

      xhr.addEventListener('error', () => reject(new ApiError('网络错误，上传中断', 0)));
      xhr.addEventListener('abort', () => reject(new ApiError('上传已取消', 0)));

      xhr.send(body);
    }),
};
