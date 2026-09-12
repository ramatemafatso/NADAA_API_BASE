export function apiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  // Local development can use the FastAPI gateway on port 8000.
  const { protocol, hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    if (protocol === 'http:' || protocol === 'https:') return origin.replace(/\/$/, '').replace(/:\d+$/, ':8000');
  }

  // GitHub Pages is static. Keep same-origin behavior when no gateway URL was configured,
  // so the UI still loads; production API features should set VITE_API_BASE in GitHub Actions.
  if (protocol === 'http:' || protocol === 'https:') return origin;
  return 'http://localhost:8000';
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}
