import { auth } from './firebase';

export async function apiFetch<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxRetries = options.retries ?? (method === 'GET' ? 2 : 0);

  let attempt = 0;
  while (true) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      } catch {
        // Ignore token retrieval error; server will enforce auth if required
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new Error('Request cancelled');
      }
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/csv')) {
        if (!res.ok) {
          throw new Error('Failed to export CSV');
        }
        return (await res.text()) as unknown as T;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      const isTransientNetwork = isAbort || err instanceof TypeError;
      if (isTransientNetwork && attempt < maxRetries) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      if (isAbort) {
        throw new Error('Network request timed out. Please check your connection and try again.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
