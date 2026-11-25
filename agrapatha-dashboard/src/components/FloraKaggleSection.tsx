import React from 'react';
import {
  KAGGLE_FOREST_FIRE_STATS,
  KAGGLE_FLORA_DATASET_STATS,
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
            Dataset Provenance &amp; Benchmark Evaluation
          </span>
          <h2 className="text-xl font-extrabold text-[#102A24] font-display mt-0.5">
            Kaggle Dataset Information &amp; Model Benchmarks
          </h2>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200">
          Verified Kaggle Benchmarks
        </span>
      </div>

      {/* 2-Column Grid: Dataset 1 (Montesinho forestfires.csv) & Dataset 2 (Microclimate grenvis_sensor_model) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left: Forest Fire Area Classification Notebook Metrics */}
        <div className="flora-card border-t-[3px] border-t-amber-500 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block font-mono">
                  Verified Dataset 1 · Montesinho Park (forestfires.csv)
                </span>
                <h3 className="text-base font-bold text-[#102A24] font-display mt-0.5">
                  Forest Fire Area Classification &amp; Holdout Evaluation
                </h3>
              </div>
              <a
                href={KAGGLE_FOREST_FIRE_STATS.notebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-[#0F766E] bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200 transition-colors shrink-0"
              >
                Kaggle Notebook ↗
              </a>
            </div>

            {/* Dataset Split Pill Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
              <div className="bg-[#F2F8F5] border border-[#CFE2D9] p-3 rounded-xl">
                <span className="text-[11px] font-bold text-[#46655D] uppercase block">Total Rows</span>
                <span className="text-base font-bold font-tabular text-[#102A24]">517</span>
                <span className="text-[11px] text-[#46655D] block">361 Train / 156 Test</span>
              </div>
              <div className="bg-[#F2F8F5] border border-[#CFE2D9] p-3 rounded-xl">
                <span className="text-[11px] font-bold text-[#46655D] uppercase block">Binary Label</span>
                <span className="text-base font-bold font-tabular text-[#102A24]">270 / 247</span>
                <span className="text-[11px] text-[#46655D] block">52.2% Fire · 47.8% Safe</span>
              </div>
              <div className="bg-rose-50/70 border border-rose-200 p-3 rounded-xl">
                <span className="text-[11px] font-bold text-rose-800 uppercase block">model_hazard.h</span>
                <span className="text-base font-bold font-tabular text-rose-700">338 High</span>
                <span className="text-[11px] text-rose-700/90 block">146 Mod · 33 Low</span>
              </div>
              <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">Max Burned</span>
                <span className="text-base font-bold font-tabular text-amber-900">1090.84 ha</span>
                <span className="text-[11px] text-amber-800/90 block">Mean: 12.85 ha</span>
              </div>
            </div>

            {/* Holdout Table */}
            <div
              className="overflow-x-auto border border-[#CFE2D9] rounded-xl flora-table-scroll focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#0F766E]"
              tabIndex={0}
              role="region"
              aria-label="Tabel Evaluasi Holdout Classifier Kaggle"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F2F8F5] border-b border-[#CFE2D9] text-[11px] font-bold text-[#46655D] uppercase">
                    <th className="py-2.5 px-3">Algorithm (test_size=0.3)</th>
                    <th className="py-2.5 px-2.5 text-right">Accuracy</th>
                    <th className="py-2.5 px-2.5 text-right">Precision</th>
                    <th className="py-2.5 px-2.5 text-right">Recall</th>
                    <th className="py-2.5 px-3 text-right">Confusion Matrix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#CFE2D9] font-tabular">
                  {KAGGLE_FOREST_FIRE_STATS.classifiersHoldout.map((clf) => (
                    <tr key={clf.name} className="hover:bg-emerald-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-sans font-semibold text-[#102A24] whitespace-nowrap">{clf.name}</td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-[#0F766E] whitespace-nowrap">{clf.accuracy.toFixed(2)}%</td>
                      <td className="py-2.5 px-2.5 text-right text-[#102A24] whitespace-nowrap">{clf.precision.toFixed(2)}%</td>
                      <td className="py-2.5 px-2.5 text-right text-[#102A24] whitespace-nowrap">{clf.recall.toFixed(2)}%</td>
                      <td className="py-2.5 px-3 text-right text-[11px] text-[#46655D] whitespace-nowrap font-mono">
                        {clf.confusionMatrix
                           ? `[[${clf.confusionMatrix[0][0]}, ${clf.confusionMatrix[0][1]}], [${clf.confusionMatrix[1][0]}, ${clf.confusionMatrix[1][1]}]]`
                          : 'Optimal K=19'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>

          <div className="mt-4 pt-3 border-t border-[#CFE2D9] text-xs text-[#46655D]">
            10-Fold Cross Validation (<code className="font-mono">seed=7</code>): SVM (0.4802) · KNN (0.4684) · MLP (0.4414) · CART (0.4373) · Bagging (0.4298) · GradientBoost (0.4279) · ExtraTrees (0.4086) · NB (0.3975) · AdaBoost (0.3969) · LR (0.3952) · RF (0.3911).
          </div>
        </div>

        {/* Right: Microclimate Environmental Dataset & Model Architecture */}
        <div className="flora-card border-t-[3px] border-t-emerald-500 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start gap-2 mb-4">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block font-mono">
                  Verified Dataset 2 · Microclimate Neural Network
                </span>
                <h3 className="text-base font-bold text-[#102A24] font-display mt-0.5">
                  Microclimate Sensor Distribution &amp; Normalization Parameters
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
                    soil_moisture_percent · Kelembapan Tanah
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
            Evaluasi parameter mikroklimat diproses secara deterministik untuk pemantauan lingkungan perakaran dan kanopi.
          </div>
        </div>
      </div>
    </section>
  );
});

export const KaggleDatasetSection = FloraKaggleSection;
