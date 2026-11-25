import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flame,
  ThermometerSun,
  Sprout,
  ShieldAlert,
} from 'lucide-react';
import { analyzeFlameDirection } from '../lib/sensorDisplay';

export interface TelemetryHistoryPoint {
  timestamp: string;
  temperature: number;
  humidity: number;
  soil_moisture: number;
  bmkg_wind?: number | null;
  bmkg_rain?: number | null;
  sensor_risk: 'Low' | 'Moderate' | 'High';
  sensor_confidence: number;
  vision_prediction: string;
}

export interface FloraHistoryCanvasProps {
  history: TelemetryHistoryPoint[];
  liveTemp?: number | null;
  liveRh?: number | null;
  liveSoil?: number | null;
  liveRisk?: 'Low' | 'Moderate' | 'High' | null;
  liveVisionPrediction?: string | null;
  liveFlameDetected?: number | null;
  liveFlameChannels?: number[] | null;
  liveFlameDirection?: string | null;
  liveFlameAngle?: number | null;
  bmkgWindKmh?: number | null;
  bmkgPrecipMm?: number | null;
  isLive?: boolean;
}

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export const FloraHistoryCanvas: React.FC<FloraHistoryCanvasProps> = React.memo(({
  history,
  liveTemp,
  liveRh,
  liveSoil,
  liveRisk,
  liveVisionPrediction,
  liveFlameDetected,
  liveFlameChannels,
  liveFlameDirection,
  liveFlameAngle,
  bmkgWindKmh,
  bmkgPrecipMm,
  isLive,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeRange, setTimeRange] = useState<'LIVE' | '1H' | '6H' | '24H'>('24H');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'TEMP' | 'HUM' | 'SOIL' | 'ANN'>('ALL');
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    record: TelemetryHistoryPoint;
  } | null>(null);

  const hoverX = hoverInfo ? hoverInfo.x : null;

  const visiblePoints = React.useMemo(() => {
    if (!history || history.length === 0) return [];
    if (timeRange === 'LIVE') return history.slice(-20);
    if (timeRange === '1H') return history.slice(-30);
    if (timeRange === '6H') return history.slice(-40);
    return history.slice(-50);
  }, [history, timeRange]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height || 280;
    if (w === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const padL = 46;
    const padR = 46;
    const padT = 24;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#CFE2D9';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();

      ctx.fillStyle = '#46655D';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${100 - i * 25}%`, padL - 8, y + 3.5);

      ctx.fillStyle = '#EA580C';
      ctx.textAlign = 'left';
      ctx.fillText(`${(45 - i * 11.25).toFixed(0)}°C`, w - padR + 8, y + 3.5);
    }

    if (!visiblePoints || visiblePoints.length === 0) {
      ctx.fillStyle = '#46655D';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Menunggu rekaman telemetri sensor fisik ESP32...', w / 2, h / 2);
      return;
    }

    const series = [
      {
        field: 'humidity' as const,
        color: '#0284C7',
        show: channelFilter === 'ALL' || channelFilter === 'HUM',
        scaleMax: 100,
      },
      {
        field: 'soil_moisture' as const,
        color: '#059669',
        show: channelFilter === 'ALL' || channelFilter === 'SOIL',
        scaleMax: 100,
      },
      {
        field: 'sensor_confidence' as const,
        color: '#7C3AED',
        show: channelFilter === 'ALL' || channelFilter === 'ANN',
        scaleMax: 100,
      },
      {
        field: 'temperature' as const,
        color: '#EA580C',
        show: channelFilter === 'ALL' || channelFilter === 'TEMP',
        scaleMax: 45,
      },
    ];

    series.forEach(({ field, color, show, scaleMax }) => {
      if (!show) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      visiblePoints.forEach((pt, idx) => {
        const raw = Number(pt[field]);
        const clamped = Math.min(scaleMax, Math.max(0, isNaN(raw) ? 0 : raw));
        const x = padL + (plotW * idx) / Math.max(1, visiblePoints.length - 1);
        const y = padT + plotH * (1 - clamped / scaleMax);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    if (visiblePoints.length >= 2) {
      ctx.fillStyle = '#46655D';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatTimeShort(visiblePoints[0].timestamp), padL, h - 8);

      ctx.textAlign = 'center';
      const mid = Math.floor(visiblePoints.length / 2);
      ctx.fillText(formatTimeShort(visiblePoints[mid].timestamp), padL + plotW / 2, h - 8);

      ctx.textAlign = 'right';
      ctx.fillText(formatTimeShort(visiblePoints[visiblePoints.length - 1].timestamp), w - padR, h - 8);
    }

    if (hoverX !== null) {
      ctx.strokeStyle = '#0F766E';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padT);
      ctx.lineTo(hoverX, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [visiblePoints, hoverX, channelFilter]);

  const drawChartRef = useRef(drawChart);
  drawChartRef.current = drawChart;

  useEffect(() => {
    const animId = requestAnimationFrame(() => {
      drawChart();
    });
    return () => cancelAnimationFrame(animId);
  }, [drawChart]);

  useEffect(() => {
    let animId = 0;
    const onResize = () => {
      setHoverInfo(null);
      cancelAnimationFrame(animId);
      animId = requestAnimationFrame(() => {
        drawChartRef.current();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !visiblePoints || visiblePoints.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const padL = 46;
    const plotW = rect.width - padL - 46;
    const clampedX = Math.max(0, Math.min(plotW, relX - padL));
    const idx = Math.round((clampedX / plotW) * (visiblePoints.length - 1));
    const rec = visiblePoints[idx];
    if (rec) {
      const newX = padL + (plotW * idx) / Math.max(1, visiblePoints.length - 1);
      const newY = e.clientY - rect.top;
      setHoverInfo((prev) => {
        if (prev && prev.record === rec && Math.abs(prev.y - newY) < 3) {
          return prev;
        }
        return { x: newX, y: newY, record: rec };
      });
    }
  };

  const { avgTemp, avgHum, avgSoil, latestRec } = React.useMemo(() => {
    const len = Math.max(1, visiblePoints.length);
    const aTemp = visiblePoints.reduce((acc, r) => acc + r.temperature, 0) / len;
    const aHum = visiblePoints.reduce((acc, r) => acc + r.humidity, 0) / len;
    const aSoil = visiblePoints.reduce((acc, r) => acc + r.soil_moisture, 0) / len;
    const lRec = visiblePoints[visiblePoints.length - 1];
    return { avgTemp: aTemp, avgHum: aHum, avgSoil: aSoil, latestRec: lRec };
  }, [visiblePoints]);

  return (
    <>
      <section id="history" className="scroll-mt-6 sm:scroll-mt-8 flora-card border-t-[3px] border-t-indigo-500 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
          <div>
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block font-mono">
              Telemetry Archive · Live Onboard Sensors
            </span>
            <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display mt-0.5">
              Multi-Sensor &amp; Botanical ANN Historical Trends
            </h2>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <div
              className="flex rounded-xl bg-[#F2F8F5] p-1 border border-[#CFE2D9] text-xs font-semibold flex-wrap"
              role="group"
              aria-label="Filter Channel Metrik Grafik Telemetri"
            >
              <button
                onClick={() => setChannelFilter('ALL')}
                aria-pressed={channelFilter === 'ALL'}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  channelFilter === 'ALL'
                    ? 'bg-white text-[#102A24] shadow-xs font-bold'
                    : 'text-[#46655D] hover:text-[#102A24]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setChannelFilter('TEMP')}
                aria-pressed={channelFilter === 'TEMP'}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  channelFilter === 'TEMP'
                    ? 'bg-white text-orange-600 shadow-xs font-bold'
                    : 'text-[#46655D] hover:text-orange-600'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-orange-500" aria-hidden="true" />
                <span>Temp (°C)</span>
              </button>
              <button
                onClick={() => setChannelFilter('HUM')}
                aria-pressed={channelFilter === 'HUM'}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  channelFilter === 'HUM'
                    ? 'bg-white text-sky-600 shadow-xs font-bold'
                    : 'text-[#46655D] hover:text-sky-600'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-sky-500" aria-hidden="true" />
                <span>RH (%)</span>
              </button>
              <button
                onClick={() => setChannelFilter('SOIL')}
                aria-pressed={channelFilter === 'SOIL'}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  channelFilter === 'SOIL'
                    ? 'bg-white text-emerald-700 shadow-xs font-bold'
                    : 'text-[#46655D] hover:text-emerald-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                <span>Soil (%)</span>
              </button>
              <button
                onClick={() => setChannelFilter('ANN')}
                aria-pressed={channelFilter === 'ANN'}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  channelFilter === 'ANN'
                    ? 'bg-white text-violet-700 shadow-xs font-bold'
                    : 'text-[#46655D] hover:text-violet-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-violet-500" aria-hidden="true" />
                <span>ANN Conf (%)</span>
              </button>
            </div>

            <div
              className="flex rounded-xl bg-[#F2F8F5] p-1 border border-[#CFE2D9] text-xs font-semibold"
              role="group"
              aria-label="Filter Rentang Waktu Grafik"
            >
              {(['LIVE', '1H', '6H', '24H'] as const).map((rng) => (
                <button
                  key={rng}
                  onClick={() => setTimeRange(rng)}
                  aria-pressed={timeRange === rng}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    timeRange === rng
                      ? 'bg-white text-[#0F766E] shadow-xs font-bold'
                      : 'text-[#46655D] hover:text-[#102A24]'
                  }`}
                >
                  {rng}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dual Axis Metric Legend Strip */}
        <div className="flex items-center justify-between text-xs font-mono text-[#46655D] pb-2 border-b border-[#CFE2D9] mb-2 px-1 flex-wrap gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold text-[#102A24]">Y1 (Kiri 0–100%):</span>
            <span className="flex items-center gap-1 text-sky-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-sky-500" />
              RH %
            </span>
            <span className="flex items-center gap-1 text-emerald-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Soil %
            </span>
            <span className="flex items-center gap-1 text-violet-700 font-semibold">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              ANN Conf %
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-orange-700 font-semibold">
            <span className="font-bold text-[#102A24]">Y2 (Kanan):</span>
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            <span>Suhu DHT22 (0–45°C)</span>
          </div>
        </div>

        {/* Canvas Container */}
        <div className="relative w-full h-[260px] lg:h-[285px] xl:h-[300px] my-2 bg-white rounded-xl border border-[#CFE2D9] overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverInfo(null)}
            role="img"
            aria-label={`Grafik riwayat multi-sensor dan model botani untuk rentang waktu ${timeRange}`}
            tabIndex={0}
            className="w-full h-[260px] lg:h-[285px] xl:h-[300px] block cursor-crosshair focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#0F766E]"
          />
          {hoverInfo && (
            <div
              className="absolute z-20 pointer-events-none bg-[#0D2E27] text-white p-3.5 rounded-xl shadow-xl text-xs border border-emerald-400/30 -translate-x-1/2 -translate-y-full mb-2 min-w-[220px] backdrop-blur-sm"
              style={{ left: hoverInfo.x, top: Math.max(70, hoverInfo.y) }}
            >
              <div className="text-[11px] font-bold text-amber-300 font-tabular border-b border-white/15 pb-1.5 mb-2 flex items-center justify-between">
                <span>Waktu Rekam</span>
                <span>{formatTimeShort(hoverInfo.record.timestamp)}</span>
              </div>
              <div className="space-y-1.5 font-tabular">
                <div className="flex justify-between items-center">
                  <span className="text-emerald-100 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    Suhu DHT22:
                  </span>
                  <span className="font-bold text-amber-200">{hoverInfo.record.temperature.toFixed(1)} °C</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-emerald-100 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    Kelembapan RH:
                  </span>
                  <span className="font-bold text-sky-200">{hoverInfo.record.humidity.toFixed(1)} %</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-emerald-100 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Soil Moisture:
                  </span>
                  <span className="font-bold text-emerald-200">{hoverInfo.record.soil_moisture.toFixed(1)} %</span>
                </div>
                <div className="pt-1.5 mt-1.5 border-t border-white/15 flex justify-between items-center">
                  <span className="text-emerald-200">grenvis ANN:</span>
                  <span className="font-bold text-white">
                    {hoverInfo.record.sensor_risk} ({hoverInfo.record.sensor_confidence.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom 3 Trend Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-4 pt-3 border-t border-[#CFE2D9]">
          <div className="bg-violet-50/70 border border-violet-200 p-3.5 rounded-xl flex flex-col justify-between min-h-[92px]">
            <span className="text-[11px] font-bold text-violet-800 uppercase tracking-wider block font-mono">
              Botanical ANN (grenvis_sensor_model.h)
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                latestRec?.sensor_risk === 'High'
                  ? 'text-rose-700'
                  : latestRec?.sensor_risk === 'Moderate'
                    ? 'text-amber-700'
                    : 'text-emerald-800'
              }`}
            >
              {latestRec
                ? `${latestRec.sensor_risk.toUpperCase()} Risk (${latestRec.sensor_confidence.toFixed(1)}%)`
                : 'Menunggu Data Sensor'}
            </span>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl flex flex-col justify-between min-h-[92px]">
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block font-mono">
              Soil Moisture Momentum
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                (latestRec?.soil_moisture ?? 50) < 35 ? 'text-amber-700' : 'text-emerald-800'
              }`}
            >
              {latestRec
                ? latestRec.soil_moisture < 35
                  ? `Defisit Hidrasi (${latestRec.soil_moisture.toFixed(1)}%)`
                  : latestRec.soil_moisture > 80
                    ? `Jenuh Air (${latestRec.soil_moisture.toFixed(1)}%)`
                    : `Optimal Hydration (${latestRec.soil_moisture.toFixed(1)}%)`
                : 'Menunggu Soil v1.2'}
            </span>
          </div>
          <div className="bg-sky-50/70 border border-sky-200 p-3.5 rounded-xl flex flex-col justify-between min-h-[92px]">
            <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider block font-mono">
              ESP32-CAM Vision + BMKG Sawah Besar
            </span>
            <span
              className={`text-sm font-bold font-display block mt-1.5 ${
                latestRec?.vision_prediction.toLowerCase().includes('fire')
                  ? 'text-rose-700'
                  : latestRec?.vision_prediction.toLowerCase().includes('smoke')
                  ? 'text-orange-600'
                  : 'text-sky-800'
              }`}
            >
              {latestRec?.vision_prediction || 'Healthy Forest Canopy'}
            </span>
          </div>
        </div>

        {/* Multisensor Mitigation Protocol (Hardware + BMKG Sawah Besar) */}
        {(() => {
          const currentTemp = typeof liveTemp === 'number' ? liveTemp : latestRec?.temperature ?? null;
          const currentRh = typeof liveRh === 'number' ? liveRh : latestRec?.humidity ?? null;
          const currentSoil = typeof liveSoil === 'number' ? liveSoil : latestRec?.soil_moisture ?? null;
          const currentRisk = liveRisk || latestRec?.sensor_risk || null;
          const currentVision = liveVisionPrediction || latestRec?.vision_prediction || null;
          const currentFlame = typeof liveFlameDetected === 'number' ? liveFlameDetected : null;
          const flameOrigin = analyzeFlameDirection(
            liveFlameChannels,
            currentFlame,
            liveFlameDirection,
            liveFlameAngle,
            Boolean(isLive)
          );

          const isFireAlert =
            flameOrigin.isFireActive ||
            currentFlame === 1 ||
            Boolean(currentVision && currentVision.toLowerCase().includes('fire')) ||
            Boolean(currentVision && currentVision.toLowerCase().includes('smoke'));
          const isFireWarning = !isFireAlert && currentRisk === 'High';

          const isMicroclimateHotDry = (currentTemp !== null && currentTemp >= 32) || (currentRh !== null && currentRh <= 40);
          const isMicroclimateColdWet = !isMicroclimateHotDry && ((currentRh !== null && currentRh >= 85) || (currentTemp !== null && currentTemp <= 20));

          const isSoilDry = currentSoil !== null && currentSoil < 35;
          const isSoilWet = currentSoil !== null && currentSoil > 80;

          return (
            <div className="mt-6 pt-5 border-t border-[#CFE2D9]">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
                <div>
                  <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block font-mono">
                    Panduan Tindakan &amp; Mitigasi Operasional
                  </span>
                  <h3 className="text-base sm:text-lg font-bold text-[#102A24] font-display flex items-center gap-2 mt-0.5">
                    <ShieldAlert size={18} className="text-[#0F766E] shrink-0" />
                    <span>Solusi Penanganan Masalah (Sensor Robot + BMKG Sawah Besar)</span>
                  </h3>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#F2F8F5] border border-[#CFE2D9] text-[#102A24] shadow-2xs font-mono">
                  {isLive ? '● Live Telemetri Aktif' : '○ Standby & Protokol Kontingensi'}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* CARD 1: MITIGASI KEBAKARAN (Flame 5-Ch + Vision + Angin BMKG) */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-t-[3px] border-t-rose-500 transition-all duration-300 ${
                    isFireAlert
                      ? 'bg-rose-50 border-rose-300 shadow-md'
                      : isFireWarning
                      ? 'bg-amber-50 border-amber-300 shadow-xs'
                      : 'bg-[#FFF8F9] border-rose-200/80 shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isFireAlert ? 'bg-rose-600' : isFireWarning ? 'bg-amber-600' : 'bg-[#0F766E]'
                          }`}
                        >
                          <Flame size={15} />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider block text-[#46655D] font-mono">
                            Domain 1 · Api &amp; Asap
                          </span>
                          <h4 className="text-sm font-bold text-[#102A24] font-display">
                            Flame 5-Ch &amp; Vision AI
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full font-mono shrink-0 ${
                          isFireAlert
                            ? 'bg-rose-600 text-white animate-pulse'
                            : isFireWarning
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isFireAlert ? 'KRITIS' : isFireWarning ? 'WASPADA' : 'AMAN'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-xs text-[#102A24]/90 leading-relaxed font-medium">
                        {isFireAlert
                          ? flameOrigin.isFireActive
                            ? `Api terdeteksi di ${flameOrigin.detailLabel}. Protokol pemadaman staged arm mengarah ke sektor aktif!`
                            : 'Sensor Flame 5-Channel atau ESP32-CAM Vision mendeteksi api/asap. Protokol pemadaman staged arm aktif!'
                          : isFireWarning
                          ? 'Model Botani ANN membaca risiko stres tinggi. Siagakan pemindaian kamera dan pompa.'
                          : 'Sensor nyala api 5-channel (CH1 P.Kiri–CH5 P.Kanan) dan MobileNetV2 dalam status aman.'}
                      </p>

                      <div className="my-2.5 px-3 py-2 rounded-lg bg-white border border-black/10 text-[11px] font-mono text-[#102A24] flex items-center justify-between gap-2 flex-wrap">
                        <span>Flame: {flameOrigin.isFireActive ? flameOrigin.sectorSummary : currentFlame === 1 ? 'API AKTIF' : 'CLEAR'} · Angin BMKG: {typeof bmkgWindKmh === 'number' ? `${bmkgWindKmh} km/h` : '--'}</span>
                      </div>

                      <ul className="space-y-1.5 text-xs text-[#102A24]/90 mt-2">
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-rose-700 shrink-0">1.</span>
                          <span><strong>Pemadaman Arm 4-DoF:</strong> Servo Base–Nozzle mengarah ke sektor Flame aktif dan memicu pompa GPIO 23.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-rose-700 shrink-0">2.</span>
                          <span><strong>Verifikasi MobileNetV2:</strong> ESP32-CAM mengonfirmasi citra FIRE/SMOKE via API Railway.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-rose-700 shrink-0">3.</span>
                          <span><strong>Pantau Angin BMKG Sawah Besar:</strong> Evaluasi kecepatan angin regional agar arah penyemprotan efektif.</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* CARD 2: MIKROKLIMAT (DHT22 vs BMKG) */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-t-[3px] border-t-orange-500 transition-all duration-300 ${
                    isMicroclimateHotDry
                      ? 'bg-amber-50 border-amber-300 shadow-xs'
                      : isMicroclimateColdWet
                      ? 'bg-sky-50 border-sky-300 shadow-xs'
                      : 'bg-[#FFFDF7] border-orange-200/80 shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isMicroclimateHotDry
                              ? 'bg-amber-600'
                              : isMicroclimateColdWet
                              ? 'bg-sky-600'
                              : 'bg-emerald-600'
                          }`}
                        >
                          <ThermometerSun size={15} />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider block text-[#46655D] font-mono">
                            Domain 2 · Mikroklimat
                          </span>
                          <h4 className="text-sm font-bold text-[#102A24] font-display">
                            Suhu &amp; Kelembapan (DHT22)
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full font-mono shrink-0 ${
                          isMicroclimateHotDry
                            ? 'bg-amber-600 text-white'
                            : isMicroclimateColdWet
                            ? 'bg-sky-600 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isMicroclimateHotDry ? 'PANAS & KERING' : isMicroclimateColdWet ? 'LEMBAP TINGGI' : 'OPTIMAL'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-xs text-[#102A24]/90 leading-relaxed font-medium">
                        {isMicroclimateHotDry
                          ? 'Suhu udara tinggi (≥ 32°C) atau RH rendah (≤ 40%) meningkatkan laju penguapan daun kanopi.'
                          : isMicroclimateColdWet
                          ? 'Kelembapan udara sangat tinggi (≥ 85%) — kurangi penyiraman agar daun tidak berjamur.'
                          : 'Temperatur dan kelembapan DHT22 seimbang di rentang fisiologis ideal vegetasi.'}
                      </p>

                      <div className="my-2.5 px-3 py-2 rounded-lg bg-white border border-black/10 text-[11px] font-mono text-[#102A24] flex items-center justify-between">
                        <span>DHT22: {currentTemp !== null ? `${currentTemp.toFixed(1)}°C` : '--'} · RH {currentRh !== null ? `${currentRh.toFixed(0)}%` : '--'}</span>
                        <span className="font-bold">{currentRisk ? `ANN: ${currentRisk}` : 'STANDBY'}</span>
                      </div>

                      <ul className="space-y-1.5 text-xs text-[#102A24]/90 mt-2">
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-orange-700 shrink-0">1.</span>
                          <span><strong>Misting Pendingin:</strong> Aktifkan penyemprotan kabut singkat jika suhu kanopi melonjak.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-orange-700 shrink-0">2.</span>
                          <span><strong>Validasi BMKG Sawah Besar:</strong> Bandingkan suhu mikro DHT22 dengan prakiraan Sawah Besar untuk mendeteksi panas lokal.</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* CARD 3: HIDRASI TANAH & PRECIPITASI BMKG */}
                <div
                  className={`rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-t-[3px] border-t-emerald-500 transition-all duration-300 ${
                    isSoilDry
                      ? 'bg-amber-50 border-amber-300 shadow-xs'
                      : isSoilWet
                      ? 'bg-sky-50 border-sky-300 shadow-xs'
                      : 'bg-[#F5FBF8] border-emerald-200/80 shadow-2xs'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-black/10">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 ${
                            isSoilDry ? 'bg-amber-600' : isSoilWet ? 'bg-sky-600' : 'bg-emerald-600'
                          }`}
                        >
                          <Sprout size={15} />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider block text-[#46655D] font-mono">
                            Domain 3 · Tanah &amp; Hujan BMKG
                          </span>
                          <h4 className="text-sm font-bold text-[#102A24] font-display">
                            Soil v1.2 &amp; Prakiraan Hujan
                          </h4>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full font-mono shrink-0 ${
                          isSoilDry ? 'bg-amber-600 text-white' : isSoilWet ? 'bg-sky-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isSoilDry ? 'TANAH KERING' : isSoilWet ? 'BASAH JENUH' : 'OPTIMAL'}
                      </span>
                    </div>

                    <div className="mt-3 text-xs">
                      <p className="text-xs text-[#102A24]/90 leading-relaxed font-medium">
                        {isSoilDry
                          ? 'Kelembapan tanah < 35%. Cek prakiraan hujan BMKG Sawah Besar sebelum memulai irigasi penuh.'
                          : isSoilWet
                          ? 'Kelembapan tanah > 80% — interlock Pump Lockout mengunci pompa guna mencegah genangan akar.'
                          : 'Kelembapan tanah berada pada kapasitas lapang ideal (35%–80%).'}
                      </p>

                      <div className="my-2.5 px-3 py-2 rounded-lg bg-white border border-black/10 text-[11px] font-mono text-[#102A24] flex items-center justify-between">
                        <span>Soil: {currentSoil !== null ? `${currentSoil.toFixed(1)}%` : '--'} · Hujan BMKG: {typeof bmkgPrecipMm === 'number' ? `${bmkgPrecipMm} mm` : '--'}</span>
                      </div>

                      <ul className="space-y-1.5 text-xs text-[#102A24]/90 mt-2">
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-emerald-700 shrink-0">1.</span>
                          <span><strong>Irigasi Terjadwal:</strong> Jika Soil &lt; 35% dan BMKG cerah, jalankan `CMD_START_IRRIGATION` hingga target 60%.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <span className="font-bold text-emerald-700 shrink-0">2.</span>
                          <span><strong>Pump Lockout Otomatis:</strong> Jika Soil &gt; 80% atau hujan lebat BMKG, tahan pompa dengan hysteresis 5%.</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* 24-Hour Statistical Summary Rollup */}
      <section className="flora-card border-t-[3px] border-t-emerald-500 p-5 sm:p-6 mt-6 shadow-xs">
        <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
          <div>
            <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block font-mono">
              Aggregation Archive · Onboard Telemetry &amp; BMKG Sawah Besar
            </span>
            <h2 className="text-base sm:text-lg font-bold text-[#102A24] font-display mt-0.5">
              Session Statistical Summary &amp; Weather Sync
            </h2>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
            {visiblePoints.length} Data Points · Live Session
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-orange-50/70 border border-orange-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-orange-800 uppercase tracking-wider block truncate">
              Session Avg Temp
            </span>
            <span className="text-sm sm:text-base font-bold font-tabular text-orange-950 block mt-1">
              {visiblePoints.length > 0 ? `${avgTemp.toFixed(1)}°C` : '--'}
            </span>
          </div>
          <div className="bg-sky-50/70 border border-sky-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider block truncate">
              Session Avg RH
            </span>
            <span className="text-sm sm:text-base font-bold font-tabular text-sky-950 block mt-1">
              {visiblePoints.length > 0 ? `${avgHum.toFixed(1)}%` : '--'}
            </span>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider block truncate">
              Session Avg Soil
            </span>
            <span className="text-sm sm:text-base font-bold font-tabular text-emerald-950 block mt-1">
              {visiblePoints.length > 0 ? `${avgSoil.toFixed(1)}%` : '--'}
            </span>
          </div>
          <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block truncate">
              Angin Sawah Besar
            </span>
            <span className="text-sm sm:text-base font-bold font-tabular text-amber-950 block mt-1">
              {typeof bmkgWindKmh === 'number' ? `${bmkgWindKmh.toFixed(1)} km/h` : '--'}
            </span>
          </div>
          <div className="bg-teal-50/70 border border-teal-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider block truncate">
              Dominant Vision
            </span>
            <span className="text-sm font-bold font-display text-teal-950 block mt-1 truncate">
              {latestRec?.vision_prediction || 'Healthy Canopy'}
            </span>
          </div>
          <div className="bg-violet-50/70 border border-violet-200 p-3 rounded-xl flex flex-col justify-between">
            <span className="text-[11px] font-bold text-violet-800 uppercase tracking-wider block truncate">
              Botanical ANN Risk
            </span>
            <span className="text-sm sm:text-base font-bold font-tabular text-violet-900 block mt-1">
              {latestRec?.sensor_risk || 'STANDBY'}
            </span>
          </div>
        </div>
      </section>
    </>
  );
});
