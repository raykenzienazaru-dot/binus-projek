/**
 * Flora AI Dashboard — BMKG Transport Layer
 * Handles network requests, timeout enforcement, AbortSignal lifecycles,
 * bilingual RSS feeds (id/en), CAP detail XML fetches, and resilient fallbacks.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const RAILWAY_BMKG_FALLBACK = 'https://be-binus-production.up.railway.app/api/bmkg';
const OFFICIAL_NOWCAST_BASE = 'https://www.bmkg.go.id/alerts/nowcast';

export function getBmkgBaseUrl(): string {
  // Allows override via environment variable if deployed behind custom gateway
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BMKG_BASE_URL) {
    return import.meta.env.VITE_BMKG_BASE_URL;
  }
  return '/api/bmkg';
}

export function buildForecastEndpointUrl(adm4: string): string {
  const base = getBmkgBaseUrl();
  return `${base}/forecast?adm4=${encodeURIComponent(adm4.trim())}`;
}

export function buildWarningEndpointUrl(lang: 'id' | 'en' = 'id'): string {
  const base = getBmkgBaseUrl();
  return `${base}/nowcast/${lang}`;
}

export function buildCapDetailEndpointUrl(capCode: string, lang: 'id' | 'en' = 'id'): string {
  const base = getBmkgBaseUrl();
  const cleanCode = capCode.trim().replace(/_alert\.xml$/i, '');
  return `${base}/nowcast/${lang}/${encodeURIComponent(cleanCode)}_alert.xml`;
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  lang?: 'id' | 'en';
  mockFixture?: unknown;
  mockFixtureXml?: string;
}

async function fetchJsonWithSignal(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Unexpected HTML response instead of BMKG JSON');
  }

  return response.json();
}

async function fetchXmlWithSignal(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  if (!text.trim().startsWith('<') || text.toLowerCase().includes('<!doctype html')) {
    throw new Error('Unexpected non-XML response from BMKG endpoint');
  }

  return text;
}

/**
 * Fetch raw forecast payload from BMKG endpoint or mock fixture.
 */
export async function fetchRawForecast(adm4: string, options: FetchOptions = {}): Promise<unknown> {
  if (options.mockFixture !== undefined) {
    return options.mockFixture;
  }

  const cleanAdm4 = adm4.trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  const candidates = [
    buildForecastEndpointUrl(cleanAdm4),
    `${RAILWAY_BMKG_FALLBACK}/forecast?adm4=${encodeURIComponent(cleanAdm4)}`,
  ];

  let lastError: unknown = null;

  try {
    for (const url of candidates) {
      try {
        return await fetchJsonWithSignal(url, signal);
      } catch (err: unknown) {
        if (options.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to fetch BMKG forecast');
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms or was cancelled`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch raw warning feed XML string from BMKG RSS endpoint (/alerts/nowcast/{id|en}) or mock fixture.
 */
export async function fetchRawWarnings(options: FetchOptions = {}): Promise<string> {
  if (options.mockFixtureXml !== undefined) {
    return options.mockFixtureXml;
  }

  const lang: 'id' | 'en' = options.lang === 'en' ? 'en' : 'id';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  const candidates = [
    buildWarningEndpointUrl(lang),
    `${OFFICIAL_NOWCAST_BASE}/${lang}`,
    `${RAILWAY_BMKG_FALLBACK}/nowcast/${lang}`,
  ];

  let lastError: unknown = null;

  try {
    for (const url of candidates) {
      try {
        return await fetchXmlWithSignal(url, signal);
      } catch (err: unknown) {
        if (options.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to fetch BMKG nowcast RSS');
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms or was cancelled`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch detailed CAP v1.2 XML for a specific alert code:
 * /alerts/nowcast/{id|en}/{kode_detail_cap}_alert.xml
 */
export async function fetchRawCapDetail(
  capCode: string,
  options: FetchOptions = {}
): Promise<string> {
  if (options.mockFixtureXml !== undefined) {
    return options.mockFixtureXml;
  }

  const cleanCode = capCode.trim().replace(/_alert\.xml$/i, '');
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(cleanCode)) {
    throw new Error(`Invalid BMKG CAP code: ${capCode}`);
  }

  const lang: 'id' | 'en' = options.lang === 'en' ? 'en' : 'id';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  const candidates = [
    buildCapDetailEndpointUrl(cleanCode, lang),
    `${OFFICIAL_NOWCAST_BASE}/${lang}/${encodeURIComponent(cleanCode)}_alert.xml`,
    `${RAILWAY_BMKG_FALLBACK}/nowcast/${lang}/${encodeURIComponent(cleanCode)}_alert.xml`,
  ];

  let lastError: unknown = null;

  try {
    for (const url of candidates) {
      try {
        return await fetchXmlWithSignal(url, signal);
      } catch (err: unknown) {
        if (options.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch CAP detail ${cleanCode}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms or was cancelled`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper to combine multiple AbortSignals for Node / Browser compatibility.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
