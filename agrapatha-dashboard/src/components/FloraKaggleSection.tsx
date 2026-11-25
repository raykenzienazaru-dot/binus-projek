import React from 'react';
import {
  KAGGLE_FLORA_DATASET_STATS,
  VISION_MODEL_BENCHMARKS,
} from '../lib/aiModels';

interface KaggleDatasetSectionProps {
  className?: string;
}

export const FloraKaggleSection: React.FC<KaggleDatasetSectionProps> = React.memo(({ className = '' }) => {
  return (
    <section id="benchmarks" className={`scroll-mt-6 sm:scroll-mt-8 space-y-6 ${className}`}>
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-[#CFE2D9]">
        <div>
          <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block font-mono">
            Active AI Models &amp; Regional Meteorology Calibration
          </span>
          <h2 className="text-xl font-extrabold text-[#102A24] font-display mt-0.5">
            Active Model Specifications &amp; BMKG Integration
          </h2>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200">
          Botanical ANN · MobileNetV2 · BMKG CAP
        </span>
      </div>

      {/* 2-Column Grid: Active Dataset (grenvis_sensor_model) & Vision MobileNetV2 + BMKG */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left: Microclimate Environmental Dataset & Botanical Model */}
        <div className="flora-card border-t-[3px] border-t-emerald-500 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block font-mono">
                  Botanical AI · grenvis_sensor_model.h (ANN MLP)
                </span>
                <h3 className="text-base font-bold text-[#102A24] font-display mt-0.5">
                  Microclimate Sensor Normalization &amp; Class Distribution
                </h3>
              </div>
              <a
                href={KAGGLE_FLORA_DATASET_STATS.datasetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200 transition-colors shrink-0"
              >
                Kaggle Dataset ↗
              </a>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-emerald-800 uppercase block">Low Risk</span>
                <span className="text-lg font-bold font-tabular text-emerald-900">3,000</span>
                <span className="text-[11px] text-emerald-700 block">33.3% Balanced</span>
              </div>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">Moderate</span>
                <span className="text-lg font-bold font-tabular text-amber-900">3,000</span>
                <span className="text-[11px] text-amber-700 block">33.3% Balanced</span>
              </div>
              <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-rose-800 uppercase block">High Risk</span>
                <span className="text-lg font-bold font-tabular text-rose-900">3,000</span>
                <span className="text-[11px] text-rose-700 block">33.3% Balanced</span>
              </div>
            </div>

            <div className="space-y-2.5 mb-4">
              <div className="bg-orange-50/50 border border-orange-200/80 rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    temperature_c · Suhu Udara Ambien (DHT22)
                  </span>
                  <span className="text-[11px] text-[#46655D]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular shrink-0">
                  <span className="text-sm font-bold text-orange-800 block">Mean: 28.62 °C</span>
                  <span className="text-[11px] text-orange-700 font-semibold">Std: ±4.91 °C</span>
                </div>
              </div>

              <div className="bg-sky-50/50 border border-sky-200/80 rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    humidity_percent · Kelembapan Udara (DHT22)
                  </span>
                  <span className="text-[11px] text-[#46655D]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular shrink-0">
                  <span className="text-sm font-bold text-sky-800 block">Mean: 59.83 %</span>
                  <span className="text-[11px] text-sky-700 font-semibold">Std: ±14.31 %</span>
                </div>
              </div>

              <div className="bg-emerald-50/50 border border-emerald-200/80 rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    soil_moisture_percent · Kelembapan Tanah (v1.2)
                  </span>
                  <span className="text-[11px] text-[#46655D]">StandardScaler Normalization Parameter</span>
                </div>
                <div className="text-right font-tabular shrink-0">
                  <span className="text-sm font-bold text-emerald-800 block">Mean: 67.15 %</span>
                  <span className="text-[11px] text-emerald-700 font-semibold">Std: ±17.56 %</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#CFE2D9] text-xs text-[#46655D]">
            Mengolah langsung 3 sensor onboard aktif ESP32-Main (DHT22 Temp, DHT22 RH, Capacitive Soil v1.2).
          </div>
        </div>

        {/* Right: MobileNetV2 Vision TFLite & BMKG Sawah Besar Pipeline */}
        <div className="flora-card border-t-[3px] border-t-sky-500 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider block font-mono">
                  Cloud Vision + Macro Meteorology · Railway &amp; BMKG
                </span>
                <h3 className="text-base font-bold text-[#102A24] font-display mt-0.5">
                  {VISION_MODEL_BENCHMARKS.modelTitle} &amp; BMKG Sawah Besar
                </h3>
              </div>
              <span className="text-xs font-bold text-sky-800 bg-sky-50 px-3 py-1.5 rounded-xl border border-sky-200 shrink-0 font-mono">
                TFLite 224×224
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <div className="bg-rose-50/70 border border-rose-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-rose-800 uppercase block">Class FIRE</span>
                <span className="text-base font-bold font-display text-rose-700 block mt-0.5">Surface Fire</span>
                <span className="text-[11px] text-rose-700/90 block">Trigger Pompa</span>
              </div>
              <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">Class SMOKE</span>
                <span className="text-base font-bold font-display text-amber-800 block mt-0.5">Smoke Plume</span>
                <span className="text-[11px] text-amber-700 block">Verifikasi Arm</span>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-200 p-3 rounded-xl text-center">
                <span className="text-[11px] font-bold text-emerald-800 uppercase block">Class SAFE</span>
                <span className="text-base font-bold font-display text-emerald-800 block mt-0.5">Non-Fire</span>
                <span className="text-[11px] text-emerald-700 block">Normal Scan</span>
              </div>
            </div>

            <div className="space-y-2.5 mb-4">
              <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    Backend Vision Railway (be-binus)
                  </span>
                  <span className="text-[11px] text-[#46655D] font-mono">
                    {VISION_MODEL_BENCHMARKS.runtime} · ESP32-CAM OV2640
                  </span>
                </div>
                <span className="text-xs font-bold text-[#0F766E] bg-white px-2.5 py-1 rounded-lg border border-[#CFE2D9] shrink-0">
                  POST /predict/fire
                </span>
              </div>

              <div className="bg-sky-50/50 border border-sky-200/80 rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    BMKG Prakiraan Cuaca · Kec. Sawah Besar (5 Kelurahan)
                  </span>
                  <span className="text-[11px] text-[#46655D] font-mono">
                    adm4: 31.71.02.1001 – 31.71.02.1005 (Jakarta Pusat)
                  </span>
                </div>
                <span className="text-xs font-bold text-sky-800 bg-white px-2.5 py-1 rounded-lg border border-sky-200 shrink-0">
                  JSON 3-Hourly
                </span>
              </div>

              <div className="bg-indigo-50/50 border border-indigo-200/80 rounded-xl p-3 flex justify-between items-center gap-2">
                <div>
                  <span className="text-xs font-bold text-[#102A24] block">
                    BMKG Nowcast CAP v1.2 Feed &amp; Detail XML (ID / EN)
                  </span>
                  <span className="text-[11px] text-[#46655D] font-mono">
                    /alerts/nowcast/{'{id|en}'}/{'{kode_detail_cap}'}_alert.xml
                  </span>
                </div>
                <span className="text-xs font-bold text-indigo-800 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shrink-0">
                  RSS + CAP XML
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#CFE2D9] text-xs text-[#46655D]">
            Menyelaraskan deteksi optik ESP32-CAM dan korelasi cuaca makro BMKG Sawah Besar secara real-time.
          </div>
        </div>
      </div>
    </section>
  );
});

export const KaggleDatasetSection = FloraKaggleSection;
