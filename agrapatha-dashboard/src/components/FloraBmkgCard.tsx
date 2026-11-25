/**
 * Flora AI Dashboard — BMKG Regional Weather & CAP Alert Card (Sawah Besar, Jakarta Pusat)
 * Integrates official BMKG Forecast (adm4) & Nowcast RSS/CAP XML (id/en + {kode_detail_cap}_alert.xml)
 * and correlates macro weather with onboard ESP32 sensors (DHT22, Soil v1.2, Flame 5-Ch, Vision AI).
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import type {
  BmkgForecastStepNormalized,
  BmkgNormalizedAlert,
  BmkgRegionRecord,
  BmkgServiceState,
} from '../types/bmkg.ts';
import {
  formatDataAge,
  getBmkgCapDetail,
  getBmkgRegionalData,
} from '../lib/bmkgService.ts';
import { getTimezoneLabel } from '../lib/bmkgForecastParser.ts';
import { evaluateBmkgSensorCorrelation } from '../lib/aiModels.ts';
import VERIFIED_PRESETS from '../data/indonesiaAdm4Presets.json';
import { CloudRain, Compass, Droplets, ExternalLink, RefreshCw, ShieldAlert, Thermometer, Wind } from 'lucide-react';

interface FloraBmkgCardProps {
  /** Optional custom initial region */
  initialRegion?: BmkgRegionRecord;
  /** Optional mock forecast for testing / offline demo */
  mockFixtureForecast?: unknown;
  /** Optional mock warning XML for testing / offline demo */
  mockFixtureWarningXml?: string;
  /** Optional live onboard telemetry for sensor-BMKG correlation */
  localTemp?: number | null;
  localRh?: number | null;
  localSoil?: number | null;
  flameDetected?: number | null;
  visionPrediction?: string | null;
  isLiveTelemetry?: boolean;
  isTelemetryStale?: boolean;
  /** Emits synced BMKG state upward so sensor cards, hero, and solver can adapt */
  onBmkgStateChange?: (state: BmkgServiceState) => void;
  /** Class name overrides */
  className?: string;
}

export const FloraBmkgCard: React.FC<FloraBmkgCardProps> = ({
  initialRegion,
  mockFixtureForecast,
  mockFixtureWarningXml,
  localTemp = null,
  localRh = null,
  localSoil = null,
  flameDetected = null,
  visionPrediction = null,
  isLiveTelemetry = false,
  isTelemetryStale = false,
  onBmkgStateChange,
  className = '',
}) => {
  const regionSelectId = useId();
  const presets: BmkgRegionRecord[] = useMemo(() => VERIFIED_PRESETS as BmkgRegionRecord[], []);
  const [selectedAdm4, setSelectedAdm4] = useState<string>(
    initialRegion?.adm4 || presets[0]?.adm4 || '31.71.02.1001'
  );
  const [lang, setLang] = useState<'id' | 'en'>('id');
  const [loadingCapId, setLoadingCapId] = useState<string | null>(null);
  const [expandedCapId, setExpandedCapId] = useState<string | null>(null);
  const [showAllNationalAlerts, setShowAllNationalAlerts] = useState<boolean>(false);

  const activeRegion = useMemo(() => {
    return presets.find((p) => p.adm4 === selectedAdm4) || presets[0];
  }, [presets, selectedAdm4]);

  const [state, setState] = useState<BmkgServiceState>({
    status: 'LOADING',
    forecast: null,
    alerts: [],
    selectedRegion: activeRegion,
    lang: 'id',
    retrievalTimestamp: null,
    sourceAnalysisDate: null,
    errorMessage: null,
    staleReason: null,
  });

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const loadData = React.useCallback(
    async (force = false) => {
      setIsRefreshing(true);
      setState((prev) => ({ ...prev, status: 'LOADING' }));
      try {
        const result = await getBmkgRegionalData(activeRegion, {
          forceRefresh: force,
          lang,
          mockFixtureForecast,
          mockFixtureWarningXml,
        });
        setState(result);
        onBmkgStateChange?.(result);
      } catch (err) {
        const errorState: BmkgServiceState = {
          ...state,
          status: 'ERROR',
          errorMessage: err instanceof Error ? err.message : 'Gagal memuat data BMKG',
        };
        setState((prev) => ({
          ...prev,
          status: 'ERROR',
          errorMessage: errorState.errorMessage,
        }));
        onBmkgStateChange?.(errorState);
      } finally {
        setIsRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRegion, lang, mockFixtureForecast, mockFixtureWarningXml, onBmkgStateChange]
  );

  useEffect(() => {
    let isMounted = true;
    loadData(false).catch(() => {
      if (isMounted) {
        setState((prev) => ({ ...prev, status: 'ERROR', errorMessage: 'Gagal menghubungi BMKG' }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadData]);

  const handleLoadCapDetail = async (alert: BmkgNormalizedAlert) => {
    if (!alert.capCode) return;
    if (alert.capDetailLoaded) {
      setExpandedCapId((prev) => (prev === alert.id ? null : alert.id));
      return;
    }
    setLoadingCapId(alert.id);
    try {
      const updated = await getBmkgCapDetail(alert, activeRegion, { lang });
      setState((prev) => {
        const nextAlerts = prev.alerts.map((a) => (a.id === alert.id ? updated : a));
        const nextState = { ...prev, alerts: nextAlerts };
        onBmkgStateChange?.(nextState);
        return nextState;
      });
      setExpandedCapId(alert.id);
    } finally {
      setLoadingCapId(null);
    }
  };

  const formatRetrievalTime = (timestamp: number | null): string => {
    if (!timestamp) return 'Belum tersedia';
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const tz = getTimezoneLabel(activeRegion.timezone);
    return `${hours}:${minutes} (${tz}) · ${formatDataAge(timestamp)}`;
  };

  const currentStep: BmkgForecastStepNormalized | null = state.forecast?.currentStep || null;
  const activeAlerts: BmkgNormalizedAlert[] = state.alerts || [];
  const jakartaAlerts = useMemo(
    () => activeAlerts.filter((a) => a.applicability === 'GEOGRAPHIC_MATCH' || a.isJakartaRelevant),
    [activeAlerts]
  );

  const isLocalValid = isLiveTelemetry && !isTelemetryStale;
  const correlation = useMemo(
    () =>
      evaluateBmkgSensorCorrelation({
        localTemp: isLocalValid ? localTemp : null,
        localRh: isLocalValid ? localRh : null,
        localSoil: isLocalValid ? localSoil : null,
        flameDetected: isLocalValid ? flameDetected : null,
        visionPrediction,
        bmkgForecast: state.forecast,
        bmkgAlerts: activeAlerts,
      }),
    [isLocalValid, localTemp, localRh, localSoil, flameDetected, visionPrediction, state.forecast, activeAlerts]
  );

  const displayedAlerts = showAllNationalAlerts
    ? activeAlerts
    : jakartaAlerts.length > 0
      ? jakartaAlerts
      : activeAlerts.slice(0, 3);

  return (
    <section
      id="bmkg"
      aria-label="BMKG Sawah Besar Jakarta Pusat & CAP Nowcast"
      className={`scroll-mt-6 sm:scroll-mt-8 flora-card border-t-[3px] border-t-sky-500 p-5 sm:p-6 lg:p-7 transition-all ${className}`}
    >
      {/* Header & Sawah Besar Selector + CAP ID/EN Toggle */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-[#CFE2D9]">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-700 font-mono">
              BMKG Open Data &amp; CAP Nowcast · Khusus Kec. Sawah Besar, Jakarta Pusat
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display tracking-tight flex items-center gap-2 flex-wrap">
            <span>Prakiraan Cuaca &amp; Peringatan Dini Sawah Besar</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-mono">
              adm4: {activeRegion.adm4}
            </span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              Kel. {activeRegion.desa} ✓
            </span>
          </h2>
        </div>

        {/* Controls: Kelurahan Sawah Besar Picker + Language ID/EN + Refresh */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor={regionSelectId} className="text-xs font-bold text-[#46655D] whitespace-nowrap">
              Kelurahan:
            </label>
            <select
              id={regionSelectId}
              value={selectedAdm4}
              onChange={(e) => setSelectedAdm4(e.target.value)}
              className="bg-[#F2F8F5] border border-[#CFE2D9] text-[#102A24] text-xs font-semibold rounded-xl px-3 py-2 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
            >
              {presets.map((preset) => (
                <option key={preset.adm4} value={preset.adm4}>
                  {preset.desa} — Kec. {preset.kecamatan}, Jakarta Pusat
                </option>
              ))}
            </select>
          </div>

          {/* CAP Language Switcher (/alerts/nowcast/id vs /en) */}
          <div
            className="flex rounded-xl bg-[#F2F8F5] p-1 border border-[#CFE2D9] text-xs font-bold"
            role="group"
            aria-label="Bahasa Feed Nowcast CAP BMKG"
          >
            <button
              type="button"
              onClick={() => setLang('id')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                lang === 'id' ? 'bg-sky-600 text-white shadow-xs' : 'text-[#46655D] hover:text-[#102A24]'
              }`}
              title="Akses CAP RSS & Detail XML Bahasa Indonesia (/nowcast/id)"
            >
              CAP ID
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                lang === 'en' ? 'bg-sky-600 text-white shadow-xs' : 'text-[#46655D] hover:text-[#102A24]'
              }`}
              title="Access CAP RSS & Detail XML English (/nowcast/en)"
            >
              CAP EN
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#0F766E] to-[#0284C7] hover:from-[#0D5D57] hover:to-[#0369A1] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            aria-label="Perbarui data BMKG Sawah Besar"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Menyinkron...' : 'Perbarui'}</span>
          </button>
        </div>
      </div>

      {/* Freshness & CAP Endpoint Status Strip */}
      <div className="mt-3.5 mb-4 flex items-center justify-between text-xs text-[#46655D] flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {state.status === 'SUCCESS_FRESH' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>BMKG Terhubung: {formatRetrievalTime(state.retrievalTimestamp)}</span>
            </span>
          )}
          {state.status === 'SUCCESS_STALE' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 font-semibold border border-amber-200">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Data Cache Stale: {formatRetrievalTime(state.retrievalTimestamp)}</span>
            </span>
          )}
          {state.status === 'EXPIRED' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-800 font-semibold border border-rose-200">
              <span>⚠ Prakiraan Kedaluwarsa (&gt;60 menit)</span>
            </span>
          )}
          {state.status === 'LOADING' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 text-sky-800 font-semibold border border-sky-200">
              <span>Menghubungi layanan BMKG Sawah Besar...</span>
            </span>
          )}
          {state.status === 'ERROR' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 text-rose-800 font-semibold border border-rose-200">
              <span>Gagal memuat: {state.errorMessage}</span>
            </span>
          )}

          <span className="font-mono text-[11px] bg-[#F2F8F5] px-2.5 py-1 rounded-full border border-[#CFE2D9] text-[#0F766E]">
            Nowcast /{lang} ({activeAlerts.length} CAP feed)
          </span>
        </div>

        {state.sourceAnalysisDate && (
          <span className="font-mono text-[11px] text-[#46655D]">
            Analysis UTC: {state.sourceAnalysisDate}
          </span>
        )}
      </div>

      {/* Live Sensor <-> BMKG Sawah Besar Correlation Bar */}
      <div
        className={`mb-5 p-4 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
          correlation.severity === 'CRITICAL'
            ? 'bg-rose-50/90 border-rose-300 text-rose-950'
            : correlation.severity === 'WARNING'
              ? 'bg-amber-50/90 border-amber-300 text-amber-950'
              : correlation.severity === 'ADVISORY'
                ? 'bg-sky-50/90 border-sky-300 text-sky-950'
                : 'bg-gradient-to-r from-[#F2F8F5] to-[#EFF7FA] border-[#CFE2D9] text-[#102A24]'
        }`}
      >
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/80 border border-black/10 font-mono">
              Korelasi Sensor Robot × BMKG Sawah Besar
            </span>
            <span className="text-xs font-extrabold">{correlation.headline}</span>
          </div>
          <p className="text-xs leading-relaxed opacity-90 m-0">{correlation.advisory}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 shrink-0 text-center font-tabular">
          <div className="bg-white/85 border border-black/10 rounded-xl px-3 py-2">
            <span className="text-[10px] font-bold uppercase text-[#46655D] block">Δ Suhu (DHT vs BMKG)</span>
            <span className="text-sm font-extrabold text-[#102A24]">
              {correlation.tempDeltaC !== null ? `${correlation.tempDeltaC > 0 ? '+' : ''}${correlation.tempDeltaC}°C` : '--'}
            </span>
          </div>
          <div className="bg-white/85 border border-black/10 rounded-xl px-3 py-2">
            <span className="text-[10px] font-bold uppercase text-[#46655D] block">Δ RH (DHT vs BMKG)</span>
            <span className="text-sm font-extrabold text-[#102A24]">
              {correlation.rhDeltaPct !== null ? `${correlation.rhDeltaPct > 0 ? '+' : ''}${correlation.rhDeltaPct}%` : '--'}
            </span>
          </div>
          <div className="bg-white/85 border border-black/10 rounded-xl px-3 py-2">
            <span className="text-[10px] font-bold uppercase text-[#46655D] block">Hujan / Angin</span>
            <span className="text-sm font-extrabold text-[#0F766E]">
              {currentStep ? `${currentStep.precipitationMm ?? 0}mm · ${currentStep.windSpeedKmh}km/h` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Forecast Cards Display */}
      {state.status === 'LOADING' && !state.forecast ? (
        <div className="animate-pulse space-y-4 py-4">
          <div className="h-24 bg-[#F2F8F5] rounded-2xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="h-24 bg-[#F2F8F5] rounded-xl" />
            <div className="h-24 bg-[#F2F8F5] rounded-xl" />
            <div className="h-24 bg-[#F2F8F5] rounded-xl" />
            <div className="h-24 bg-[#F2F8F5] rounded-xl" />
          </div>
        </div>
      ) : currentStep ? (
        <div className="space-y-6">
          {/* Current Observed Conditions Box */}
          <div className="bg-gradient-to-br from-[#0D2E27] via-[#124B47] to-[#0E5E6F] text-white p-5 rounded-2xl shadow-md border border-emerald-400/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div className="space-y-1.5">
              <span className="text-[11px] uppercase font-bold tracking-wider text-amber-300 block font-mono">
                Kondisi Cuaca Sawah Besar · Kel. {activeRegion.desa}
              </span>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl lg:text-4xl font-extrabold font-display tracking-tight text-white">
                  {currentStep.temperatureC}°C
                </span>
                <span className="text-sm font-semibold text-emerald-100">
                  {lang === 'en' ? currentStep.weatherDescEn : currentStep.weatherDesc}
                </span>
              </div>
              <span className="text-xs text-emerald-100/80 block font-mono">
                Interval: {currentStep.localDatetime} {getTimezoneLabel(state.forecast?.timezone || activeRegion.timezone)} · Lat {activeRegion.coordinates.lat.toFixed(4)}, Lon {activeRegion.coordinates.lon.toFixed(4)}
              </span>
            </div>

            {/* Weather Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 w-full md:w-auto">
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 rounded-xl text-center">
                <span className="text-[11px] text-sky-200 flex items-center justify-center gap-1"><Droplets size={12} /> Kelembapan</span>
                <span className="text-sm font-extrabold text-white font-tabular block mt-0.5">{currentStep.humidityPercent}%</span>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 rounded-xl text-center">
                <span className="text-[11px] text-emerald-200 flex items-center justify-center gap-1"><Wind size={12} /> Angin</span>
                <span className="text-sm font-extrabold text-white font-tabular block mt-0.5">
                  {currentStep.windSpeedKmh} km/h {currentStep.windDirectionCardinal || ''}
                </span>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 rounded-xl text-center">
                <span className="text-[11px] text-amber-200 flex items-center justify-center gap-1"><Compass size={12} /> Awan</span>
                <span className="text-sm font-extrabold text-white font-tabular block mt-0.5">
                  {currentStep.cloudCoverPercent !== undefined ? `${currentStep.cloudCoverPercent}%` : 'N/A'}
                </span>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 rounded-xl text-center">
                <span className="text-[11px] text-cyan-200 flex items-center justify-center gap-1"><CloudRain size={12} /> Presipitasi</span>
                <span className="text-sm font-extrabold text-white font-tabular block mt-0.5">
                  {currentStep.precipitationMm !== undefined ? `${currentStep.precipitationMm} mm` : '0 mm'}
                </span>
              </div>
            </div>
          </div>

          {/* 3-Hour Forecast Progression Timeline */}
          {state.forecast && state.forecast.allSteps.length > 1 && (
            <div>
              <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
                <span className="text-xs font-bold text-[#102A24] font-display uppercase tracking-wider flex items-center gap-1.5">
                  <Thermometer size={14} className="text-orange-500" />
                  <span>Prakiraan Cuaca 3-Jam · {activeRegion.desa}, Sawah Besar</span>
                </span>
                <span className="text-[11px] text-[#46655D] font-mono">
                  {state.forecast.allSteps.length} Titik Prakiraan
                </span>
              </div>

              <div className="overflow-x-auto pb-2 flex gap-2.5 scrollbar-thin">
                {state.forecast.allSteps.slice(0, 12).map((step, idx) => (
                  <div
                    key={`${step.utcDatetime}-${idx}`}
                    className="min-w-[142px] bg-[#F2F8F5] border border-[#CFE2D9] p-3 rounded-xl flex flex-col justify-between shrink-0 shadow-2xs hover:border-sky-400 transition-colors"
                  >
                    <div>
                      <span className="text-[11px] text-[#46655D] block font-mono">
                        {step.localDatetime.split(' ')[1]?.slice(0, 5) || step.localDatetime} · {step.localDatetime.split(' ')[0]?.slice(5)}
                      </span>
                      <span className="text-base font-extrabold text-[#102A24] font-tabular block mt-0.5">
                        {step.temperatureC}°C
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-[#CFE2D9] text-[11px] text-[#46655D]">
                      <span className="font-semibold block truncate text-[#0F766E]" title={lang === 'en' ? step.weatherDescEn : step.weatherDesc}>
                        {lang === 'en' ? step.weatherDescEn : step.weatherDesc}
                      </span>
                      <div className="flex justify-between mt-1 text-[11px] font-tabular">
                        <span>RH {step.humidityPercent}%</span>
                        <span>{step.windSpeedKmh}km/h</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 bg-[#F2F8F5] rounded-xl border border-dashed border-[#CFE2D9]">
          <p className="text-xs text-[#46655D] font-medium">
            Data prakiraan cuaca Sawah Besar belum tersedia.
          </p>
        </div>
      )}

      {/* BMKG Early Warning Nowcast RSS & CAP Detail XML Inspector */}
      <div className="mt-6 pt-5 border-t border-[#CFE2D9] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <ShieldAlert size={13} />
              <span>Nowcast Early Warning CAP v1.2 (/{lang} &amp; {'{kode_detail_cap}'}_alert.xml)</span>
            </span>
            <p className="text-xs text-[#46655D] mt-0.5 m-0">
              {jakartaAlerts.length > 0
                ? `${jakartaAlerts.length} peringatan Nowcast relevan dengan DKI Jakarta / Sawah Besar terdeteksi.`
                : `Sawah Besar, Jakarta Pusat aman — tidak ada peringatan ekstrem DKI Jakarta pada feed /alerts/nowcast/${lang}.`}
            </p>
          </div>
          {activeAlerts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllNationalAlerts((prev) => !prev)}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-[#F2F8F5] hover:bg-sky-50 text-[#102A24] border border-[#CFE2D9] cursor-pointer"
            >
              {showAllNationalAlerts
                ? 'Sembunyikan Feed Nasional'
                : `Lihat Semua CAP Aktif (${activeAlerts.length})`}
            </button>
          )}
        </div>

        {displayedAlerts.length > 0 && (
          <div className="space-y-2.5">
            {displayedAlerts.map((alert) => {
              const isRelevant = alert.applicability === 'GEOGRAPHIC_MATCH' || alert.isJakartaRelevant;
              const isExpanded = expandedCapId === alert.id;
              return (
                <aside
                  key={alert.id}
                  className={`p-4 rounded-xl border shadow-xs ${
                    isRelevant
                      ? 'bg-rose-50/90 border-rose-300 text-rose-950'
                      : 'bg-[#F8FCFA] border-[#CFE2D9] text-[#102A24]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isRelevant ? 'bg-rose-600 animate-ping' : 'bg-sky-500'
                        }`}
                      />
                      <span className="font-bold text-xs sm:text-sm font-display">
                        {alert.event}: {alert.headline}
                      </span>
                      {alert.capCode && (
                        <code className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-black/10 text-[#0F766E]">
                          {alert.capCode}_alert.xml
                        </code>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          alert.applicability === 'GEOGRAPHIC_MATCH'
                            ? 'bg-rose-600 text-white'
                            : isRelevant
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-sky-100 text-sky-900 border border-sky-200'
                        }`}
                      >
                        {alert.applicability === 'GEOGRAPHIC_MATCH'
                          ? 'Polygon Match: Sawah Besar'
                          : isRelevant
                            ? 'Relevan DKI Jakarta'
                            : 'Nowcast Nasional'}
                      </span>
                      {alert.capCode && (
                        <button
                          type="button"
                          onClick={() => handleLoadCapDetail(alert)}
                          disabled={loadingCapId === alert.id}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#0F766E] hover:bg-[#0D5D57] text-white cursor-pointer disabled:opacity-50"
                        >
                          {loadingCapId === alert.id
                            ? 'Memuat CAP...'
                            : isExpanded
                              ? 'Tutup Detail CAP'
                              : alert.capDetailLoaded
                                ? 'Lihat Detail CAP'
                                : 'Ambil Detail XML'}
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs opacity-90 mt-2 leading-relaxed">{alert.description}</p>

                  {isExpanded && (
                    <div className="mt-3 p-3 rounded-xl bg-white/90 border border-[#CFE2D9] grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <span className="text-[#46655D] block font-semibold">Severity / Urgency</span>
                        <span className="font-bold text-[#102A24]">{alert.severity || '--'} / {alert.urgency || '--'}</span>
                      </div>
                      <div>
                        <span className="text-[#46655D] block font-semibold">Certainty</span>
                        <span className="font-bold text-[#102A24]">{alert.certainty || '--'}</span>
                      </div>
                      <div>
                        <span className="text-[#46655D] block font-semibold">Poligon Area ({alert.areaDesc || '--'})</span>
                        <span className="font-bold text-[#102A24]">{alert.allPolygons?.length ?? 0} poligon</span>
                      </div>
                      <div>
                        <span className="text-[#46655D] block font-semibold">Kedaluwarsa</span>
                        <span className="font-bold text-[#102A24]">
                          {alert.expiresTime ? new Date(alert.expiresTime).toLocaleString('id-ID') : 'Tidak dispesifikasikan'}
                        </span>
                      </div>
                      {alert.sourceUrl && (
                        <div className="col-span-2 sm:col-span-4 pt-1 flex items-center gap-3 flex-wrap">
                          <a
                            href={alert.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sky-700 font-bold hover:underline"
                          >
                            <span>Buka XML CAP Resmi</span>
                            <ExternalLink size={12} />
                          </a>
                          {alert.infographicUrl && (
                            <a
                              href={alert.infographicUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-emerald-700 font-bold hover:underline"
                            >
                              <span>Infografis Peringatan</span>
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </aside>
              );
            })}
          </div>
        )}
      </div>

      {/* Mandatory Attribution & Safety Firewall Disclaimer */}
      <footer className="mt-5 pt-3.5 border-t border-[#CFE2D9] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-[#46655D]">
        <div>
          <span className="font-bold text-[#102A24]">Sumber Resmi: </span>
          <span>BMKG Open Data (`api.bmkg.go.id`) &amp; CAP Nowcast (`www.bmkg.go.id/alerts/nowcast/{lang}`) · Sawah Besar Only</span>
        </div>
        <div className="text-left sm:text-right max-w-md opacity-85">
          Informasi makro Sawah Besar sebagai advisori; interlock pemadam api darurat robot tetap prioritas tertinggi.
        </div>
      </footer>
    </section>
  );
};
