/**
 * Flora AI Dashboard — BMKG Service & Cache Manager
 * Enforces Flora project cache freshness policies, state transitions, bilingual nowcast (id/en),
 * CAP v1.2 detail XML enrichment, and request lifecycles.
 */

import type {
  BmkgCacheFreshness,
  BmkgNormalizedAlert,
  BmkgNormalizedForecast,
  BmkgRegionRecord,
  BmkgServiceState,
} from '../types/bmkg.ts';
import { parseBmkgForecast } from './bmkgForecastParser.ts';
import { fetchRawCapDetail, fetchRawForecast, fetchRawWarnings } from './bmkgTransport.ts';
import { mergeCapDetailAlert, parseBmkgWarnings } from './bmkgWarningParser.ts';

// Flora Project Cache Policy Boundaries (in milliseconds)
export const FRESH_THRESHOLD_MS = 15 * 60 * 1000;      // 0 - 15 minutes
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;      // 15 - 60 minutes
export const DISCARD_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedForecastEntry {
  adm4: string;
  forecast: BmkgNormalizedForecast;
  fetchedAt: number;
}

interface CachedWarningFeedEntry {
  xmlText: string;
  fetchedAt: number;
}

// In-Memory cache records
const forecastMemoryCache = new Map<string, CachedForecastEntry>();
const warningFeedMemoryCache = new Map<'id' | 'en', CachedWarningFeedEntry>();
const capDetailCache = new Map<string, string>();

// Track latest request to prevent delayed asynchronous responses from overwriting the active region
let latestRequestedAdm4 = '';
let latestRequestId = 0;

// Track in-flight request controllers to cancel stale queries on region switch
let activeForecastAbortController: AbortController | null = null;
let activeWarningAbortController: AbortController | null = null;

/**
 * Evaluates cache freshness state deterministically.
 */
export function evaluateCacheFreshness(fetchedAt: number, now: number = Date.now()): BmkgCacheFreshness {
  const age = Math.max(0, now - fetchedAt);
  if (age <= FRESH_THRESHOLD_MS) return 'FRESH';
  if (age <= STALE_THRESHOLD_MS) return 'STALE_USABLE';
  if (age <= DISCARD_THRESHOLD_MS) return 'EXPIRED_UNUSABLE';
  return 'DISCARDED';
}

/**
 * Format relative minutes/hours for human-readable freshness badges.
 */
export function formatDataAge(fetchedAt: number, now: number = Date.now()): string {
  const diffMinutes = Math.floor(Math.max(0, now - fetchedAt) / 60000);
  if (diffMinutes < 1) return 'baru saja';
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours} jam yang lalu`;
}

function getCachedForecast(adm4: string, now: number = Date.now()): CachedForecastEntry | null {
  const entry = forecastMemoryCache.get(adm4);
  if (entry) {
    const freshness = evaluateCacheFreshness(entry.fetchedAt, now);
    if (freshness === 'DISCARDED') {
      forecastMemoryCache.delete(adm4);
      return null;
    }
    return entry;
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`flora_bmkg_fc_${adm4}`);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedForecastEntry;
        const freshness = evaluateCacheFreshness(parsed.fetchedAt, now);
        if (freshness === 'DISCARDED') {
          sessionStorage.removeItem(`flora_bmkg_fc_${adm4}`);
          return null;
        }
        forecastMemoryCache.set(adm4, parsed);
        return parsed;
      }
    } catch {
      // Ignore storage read errors
    }
  }

  return null;
}

function setCachedForecast(adm4: string, forecast: BmkgNormalizedForecast, fetchedAt: number): void {
  const entry: CachedForecastEntry = { adm4, forecast, fetchedAt };
  forecastMemoryCache.set(adm4, entry);

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`flora_bmkg_fc_${adm4}`, JSON.stringify(entry));
    } catch {
      // Storage quota full or unavailable
    }
  }
}

export interface ServiceExecutionOptions {
  forceRefresh?: boolean;
  lang?: 'id' | 'en';
  mockFixtureForecast?: unknown;
  mockFixtureWarningXml?: string;
  now?: number;
}

/**
 * Main service orchestrator to fetch and resolve BMKG weather forecast and nowcast warnings.
 */
export async function getBmkgRegionalData(
  region: BmkgRegionRecord,
  options: ServiceExecutionOptions = {}
): Promise<BmkgServiceState> {
  const now = options.now ?? Date.now();
  const adm4 = region.adm4.trim();
  const lang: 'id' | 'en' = options.lang === 'en' ? 'en' : 'id';

  const currentRequestId = ++latestRequestId;
  latestRequestedAdm4 = adm4;

  if (activeForecastAbortController) {
    activeForecastAbortController.abort();
  }
  activeForecastAbortController = new AbortController();
  const forecastSignal = activeForecastAbortController.signal;

  const isSuperseded = () => latestRequestId !== currentRequestId || latestRequestedAdm4 !== adm4;

  const cached = getCachedForecast(adm4, now);
  let cachedForecast: BmkgNormalizedForecast | null = null;
  let freshness: BmkgCacheFreshness = 'DISCARDED';

  if (cached) {
    freshness = evaluateCacheFreshness(cached.fetchedAt, now);
    if (freshness === 'FRESH' && !options.forceRefresh && options.mockFixtureForecast === undefined) {
      const alerts = await getBmkgWarnings(region, {
        signal: forecastSignal,
        mockXml: options.mockFixtureWarningXml,
        lang,
        forceRefresh: options.forceRefresh,
        now,
      });

      if (isSuperseded()) {
        return {
          status: 'LOADING',
          forecast: null,
          alerts: [],
          selectedRegion: region,
          lang,
          retrievalTimestamp: null,
          sourceAnalysisDate: null,
          errorMessage: null,
          staleReason: null,
        };
      }

      return {
        status: 'SUCCESS_FRESH',
        forecast: cached.forecast,
        alerts,
        selectedRegion: region,
        lang,
        retrievalTimestamp: cached.fetchedAt,
        sourceAnalysisDate: cached.forecast.analysisDate,
        errorMessage: null,
        staleReason: null,
      };
    }
    cachedForecast = cached.forecast;
  }

  try {
    const rawForecast = await fetchRawForecast(adm4, {
      signal: forecastSignal,
      mockFixture: options.mockFixtureForecast,
    });

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        lang,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    const parseResult = parseBmkgForecast(rawForecast, now);

    if (!parseResult.success || !parseResult.data) {
      throw new Error(parseResult.error || 'Failed to parse BMKG forecast payload');
    }

    const liveForecast = parseResult.data;
    setCachedForecast(adm4, liveForecast, now);

    const alerts = await getBmkgWarnings(region, {
      signal: forecastSignal,
      mockXml: options.mockFixtureWarningXml,
      lang,
      forceRefresh: options.forceRefresh,
      now,
    });

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        lang,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    return {
      status: 'SUCCESS_FRESH',
      forecast: liveForecast,
      alerts,
      selectedRegion: region,
      lang,
      retrievalTimestamp: now,
      sourceAnalysisDate: liveForecast.analysisDate,
      errorMessage: null,
      staleReason: null,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown network failure';

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        lang,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    if (isSuperseded()) {
      return {
        status: 'LOADING',
        forecast: null,
        alerts: [],
        selectedRegion: region,
        lang,
        retrievalTimestamp: null,
        sourceAnalysisDate: null,
        errorMessage: null,
        staleReason: null,
      };
    }

    if (cached && cachedForecast) {
      const currentFreshness = evaluateCacheFreshness(cached.fetchedAt, now);
      if (currentFreshness === 'STALE_USABLE') {
        const alerts = await getBmkgWarnings(region, {
          signal: forecastSignal,
          mockXml: options.mockFixtureWarningXml,
          lang,
          now,
        });
        return {
          status: 'SUCCESS_STALE',
          forecast: cachedForecast,
          alerts,
          selectedRegion: region,
          lang,
          retrievalTimestamp: cached.fetchedAt,
          sourceAnalysisDate: cachedForecast.analysisDate,
          errorMessage: errorMsg,
          staleReason: `BMKG belum dapat dihubungi (${errorMsg}). Menampilkan data tersimpan (${formatDataAge(cached.fetchedAt, now)}).`,
        };
      }
      if (currentFreshness === 'EXPIRED_UNUSABLE') {
        return {
          status: 'EXPIRED',
          forecast: null,
          alerts: [],
          selectedRegion: region,
          lang,
          retrievalTimestamp: cached.fetchedAt,
          sourceAnalysisDate: cachedForecast.analysisDate,
          errorMessage: `Prakiraan cuaca telah kedaluwarsa (${formatDataAge(cached.fetchedAt, now)}). Harap perbarui koneksi BMKG.`,
          staleReason: 'Kedaluwarsa',
        };
      }
    }

    return {
      status: 'ERROR',
      forecast: null,
      alerts: [],
      selectedRegion: region,
      lang,
      retrievalTimestamp: null,
      sourceAnalysisDate: null,
      errorMessage: errorMsg,
      staleReason: null,
    };
  }
}

/**
 * Fetches and caches a specific CAP detail XML (`{kode_detail_cap}_alert.xml`),
 * merging polygons, expiry, severity, and infographic URL into the alert record.
 */
export async function getBmkgCapDetail(
  alert: BmkgNormalizedAlert,
  region: BmkgRegionRecord,
  options: { signal?: AbortSignal; lang?: 'id' | 'en'; mockXml?: string } = {}
): Promise<BmkgNormalizedAlert> {
  if (!alert.capCode) return alert;

  const lang: 'id' | 'en' = options.lang === 'en' ? 'en' : 'id';
  const cacheKey = `${lang}:${alert.capCode}`;

  if (options.mockXml !== undefined) {
    capDetailCache.set(cacheKey, options.mockXml);
    return mergeCapDetailAlert(alert, options.mockXml, region);
  }

  const cachedXml = capDetailCache.get(cacheKey);
  if (cachedXml) {
    return mergeCapDetailAlert(alert, cachedXml, region);
  }

  try {
    const capXml = await fetchRawCapDetail(alert.capCode, {
      signal: options.signal,
      lang,
    });
    capDetailCache.set(cacheKey, capXml);
    return mergeCapDetailAlert(alert, capXml, region);
  } catch {
    return alert;
  }
}

async function enrichAlertsWithCachedOrLiveCap(
  alerts: BmkgNormalizedAlert[],
  region: BmkgRegionRecord,
  lang: 'id' | 'en',
  signal?: AbortSignal
): Promise<BmkgNormalizedAlert[]> {
  // Prioritize alerts mentioning Jakarta/Jabodetabek/Sawah Besar, plus top active alert so CAP detail works cleanly
  const targets = alerts.filter((a) => a.capCode && !a.capDetailLoaded);
  const jakartaTargets = targets.filter((a) => a.isJakartaRelevant);
  const prioritized = (jakartaTargets.length > 0 ? jakartaTargets : targets).slice(0, 2);

  if (prioritized.length === 0) return alerts;

  const enrichedMap = new Map<string, BmkgNormalizedAlert>();
  await Promise.allSettled(
    prioritized.map(async (alert) => {
      const updated = await getBmkgCapDetail(alert, region, { signal, lang });
      enrichedMap.set(alert.id, updated);
    })
  );

  return alerts.map((a) => enrichedMap.get(a.id) ?? a);
}

/**
 * Fetch and parse active warnings for the given region.
 * Stores raw XML in memory cache and evaluates applicability specifically per region.
 */
export async function getBmkgWarnings(
  region: BmkgRegionRecord,
  options: { signal?: AbortSignal; mockXml?: string; lang?: 'id' | 'en'; forceRefresh?: boolean; now?: number } = {}
): Promise<BmkgNormalizedAlert[]> {
  const now = options.now ?? Date.now();
  const lang: 'id' | 'en' = options.lang === 'en' ? 'en' : 'id';

  if (options.mockXml !== undefined) {
    warningFeedMemoryCache.set(lang, {
      xmlText: options.mockXml,
      fetchedAt: now,
    });
    const parseResult = parseBmkgWarnings(options.mockXml, region);
    return parseResult.success ? parseResult.alerts : [];
  }

  const cachedFeed = warningFeedMemoryCache.get(lang);
  if (cachedFeed && !options.forceRefresh) {
    const age = now - cachedFeed.fetchedAt;
    if (age <= FRESH_THRESHOLD_MS) {
      const parseResult = parseBmkgWarnings(cachedFeed.xmlText, region);
      if (!parseResult.success) return [];
      return enrichAlertsWithCachedOrLiveCap(parseResult.alerts, region, lang, options.signal);
    }
  }

  if (activeWarningAbortController) {
    activeWarningAbortController.abort();
  }
  activeWarningAbortController = new AbortController();

  try {
    const effectiveSignal = options.signal || activeWarningAbortController.signal;
    const xmlText = await fetchRawWarnings({
      signal: effectiveSignal,
      lang,
      mockFixtureXml: options.mockXml,
    });

    warningFeedMemoryCache.set(lang, {
      xmlText,
      fetchedAt: now,
    });

    const result = parseBmkgWarnings(xmlText, region);
    if (!result.success) return [];
    return enrichAlertsWithCachedOrLiveCap(result.alerts, region, lang, effectiveSignal);
  } catch {
    const fallbackFeed = warningFeedMemoryCache.get(lang);
    if (fallbackFeed) {
      const freshness = evaluateCacheFreshness(fallbackFeed.fetchedAt, now);
      if (freshness === 'FRESH' || freshness === 'STALE_USABLE') {
        const result = parseBmkgWarnings(fallbackFeed.xmlText, region);
        return result.success ? result.alerts : [];
      }
    }
    return [];
  }
}

/**
 * Clears in-memory and stored caches (useful for testing and reset).
 */
export function clearBmkgCache(): void {
  forecastMemoryCache.clear();
  warningFeedMemoryCache.clear();
  capDetailCache.clear();
  latestRequestedAdm4 = '';
  latestRequestId = 0;
  if (typeof sessionStorage !== 'undefined') {
    try {
      const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('flora_bmkg_'));
      for (const k of keys) {
        sessionStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }
  }
}
