/** Production-safe Supabase request helpers: backoff, deduplication, and logging. */

const BACKOFF_MS = 5 * 60 * 1000;
const isDev = import.meta.env.DEV;

type BackoffEntry = { until: number; lastLoggedAt: number };

const backoffByEndpoint = new Map<string, BackoffEntry>();
const inFlightByKey = new Map<string, Promise<unknown>>();
const cacheByKey = new Map<string, { result: unknown; expiresAt: number }>();

export class SupabaseBackoffError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(`Supabase request skipped (backoff): ${endpoint}`);
    this.name = 'SupabaseBackoffError';
    this.endpoint = endpoint;
  }
}

function devLog(message: string, detail?: unknown): void {
  if (!isDev) return;
  if (detail !== undefined) {
    console.debug(`[supabase] ${message}`, detail);
  } else {
    console.debug(`[supabase] ${message}`);
  }
}

/** Derive a stable endpoint label from a Supabase REST/RPC URL for logging and backoff. */
export function endpointFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/+/, '');
    if (path.startsWith('rpc/')) return path.slice(4);
    const table = path.split('?')[0]?.split('/')[0] ?? path;
    return table || url;
  } catch {
    return url;
  }
}

export function isTransientSupabaseFailure(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof TypeError) {
    const msg = String(error.message ?? '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('cors');
  }
  if (typeof error === 'object') {
    const e = error as { status?: number; code?: string; message?: string };
    if (e.status === 522 || e.status === 503 || e.status === 504) return true;
    const msg = String(e.message ?? '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network error') || msg.includes('fetch failed')) {
      return true;
    }
  }
  return false;
}

export function isEndpointBackedOff(endpoint: string): boolean {
  const entry = backoffByEndpoint.get(endpoint);
  return entry != null && entry.until > Date.now();
}

export function recordEndpointFailure(endpoint: string, error?: unknown): void {
  if (error != null && !isTransientSupabaseFailure(error)) return;
  const now = Date.now();
  const prev = backoffByEndpoint.get(endpoint);
  backoffByEndpoint.set(endpoint, {
    until: now + BACKOFF_MS,
    lastLoggedAt: prev?.lastLoggedAt ?? 0,
  });
  logSupabaseWarning(endpoint, error);
}

export function logSupabaseWarning(endpoint: string, error?: unknown): void {
  const now = Date.now();
  const entry = backoffByEndpoint.get(endpoint);
  if (entry && now - entry.lastLoggedAt < BACKOFF_MS) return;
  if (entry) entry.lastLoggedAt = now;
  else backoffByEndpoint.set(endpoint, { until: 0, lastLoggedAt: now });

  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error != null && 'message' in error
        ? String((error as { message: unknown }).message)
        : error != null
          ? String(error)
          : 'unavailable';
  console.warn(`[supabase] ${endpoint}: ${detail}`);
}

/** Guarded fetch for Supabase client — records backoff and skips network during cooldown. */
export async function guardedSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const endpoint = endpointFromUrl(url);

  if (isEndpointBackedOff(endpoint)) {
    devLog(`backoff skip: ${endpoint}`);
    return new Response(JSON.stringify({ message: 'Service temporarily unavailable', code: 'backoff' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await fetch(input, init);
    if (res.status === 522 || res.status === 503 || res.status === 504) {
      recordEndpointFailure(endpoint, { status: res.status, message: `HTTP ${res.status}` });
    }
    return res;
  } catch (err) {
    recordEndpointFailure(endpoint, err);
    throw err;
  }
}

export function assertNotBackedOff(endpoint: string): void {
  if (isEndpointBackedOff(endpoint)) {
    throw new SupabaseBackoffError(endpoint);
  }
}

export function recordSupabaseError(endpoint: string, error: unknown): void {
  if (isTransientSupabaseFailure(error)) {
    recordEndpointFailure(endpoint, error);
  } else if (error != null) {
    logSupabaseWarning(endpoint, error);
  }
}

/**
 * Deduplicate identical read/RPC requests: reuse in-flight promise or cached result.
 * @param cacheKey Unique key including table/RPC name, filters, and user id when relevant.
 * @param ttlMs Cache TTL for successful results (0 = in-flight dedupe only).
 */
export async function dedupeSupabaseRead<T>(
  cacheKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options?: { skipCache?: boolean }
): Promise<T> {
  assertNotBackedOff(cacheKey.split(':')[0] ?? cacheKey);

  const now = Date.now();
  if (!options?.skipCache && ttlMs > 0) {
    const cached = cacheByKey.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      devLog(`cache hit ${cacheKey}`);
      return cached.result as T;
    }
  }

  const inFlight = inFlightByKey.get(cacheKey);
  if (inFlight) {
    devLog(`in-flight dedupe ${cacheKey}`);
    return inFlight as Promise<T>;
  }

  const promise = fn()
    .then((result) => {
      if (ttlMs > 0) {
        cacheByKey.set(cacheKey, { result, expiresAt: Date.now() + ttlMs });
      }
      inFlightByKey.delete(cacheKey);
      return result;
    })
    .catch((err) => {
      inFlightByKey.delete(cacheKey);
      throw err;
    });

  inFlightByKey.set(cacheKey, promise);
  return promise;
}

/** Clear cached reads (e.g. after a manual refresh). */
export function invalidateSupabaseReadCache(prefix?: string): void {
  if (!prefix) {
    cacheByKey.clear();
    return;
  }
  for (const key of cacheByKey.keys()) {
    if (key.startsWith(prefix)) cacheByKey.delete(key);
  }
}
