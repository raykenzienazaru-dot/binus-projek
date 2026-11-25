// ============================================================================
// 1. MODEL BOTANI ANN: grenvis_sensor_model.h (FLORA Environmental Risk Neural Network)
//    Trained on Kaggle: raykenzie/flora-environmental-risk-dataset (9,000 rows)
//    Features: [temperature_c, humidity_percent, soil_moisture_percent]
//    Classes : ['High', 'Low', 'Moderate']
// ============================================================================

import type { BmkgNormalizedAlert, BmkgNormalizedForecast } from '../types/bmkg.ts';

export interface FloraSensorModelResult {
  sensorRisk: 'High' | 'Low' | 'Moderate';
  sensorConfidence: number;
  highProbability: number;
  lowProbability: number;
  moderateProbability: number;
}

export const FLORA_SENSOR_MODEL_CONFIG = {
  classes: ['High', 'Low', 'Moderate'] as const,
  scaler: {
    mean: [28.62221905, 59.83464446, 67.15121274],
    std: [4.90833472, 14.30678582, 17.56037094],
  },
  weights: {
    w1: [
      [0.06882256269454956, -0.4267715513706207, -0.737812876701355],
      [-0.8693224787712097, -0.7673643827438354, 0.9594364762306213],
      [1.0567576885223389, 1.106550693511963, 0.018498126417398453],
      [-0.14441879093647003, 0.00937872938811779, -0.167218416929245],
      [-0.8071327209472656, -0.07039181143045425, -0.8527116179466248],
      [0.833522617816925, -0.004474660847336054, -0.870482861995697],
      [1.2302871942520142, -0.04089164733886719, -0.11043281108140945],
      [0.4346289038658142, -0.5216134190559387, 0.4670726954936981],
      [-0.3797735273838043, 0.44210222363471985, -0.466645747423172],
      [0.3798741400241852, 0.8371866345405579, 0.931255042552948],
      [0.27597203850746155, -1.0527435541152954, -1.10983407497406],
      [0.028266865760087967, 0.3196512460708618, -0.24809375405311584],
      [0.8012734055519104, -0.8134379982948303, 0.044027362018823624],
      [-0.8783088326454163, -0.028593210503458977, -1.149275541305542],
      [-0.015918029472231865, 1.098854899406433, -1.223756194114685],
      [-0.9087123274803162, 0.7294166684150696, 0.6827735900878906],
    ],
    b1: [
      -0.33383816480636597, -0.04227512702345848, 0.00598018616437912, 0.9734883308410645,
      0.0101948706433177, 0.08699293434619904, 0.15194343030452728, -0.039835698902606964,
      -0.1792176514863968, -0.1527959257364273, 0.050946008414030075, 1.1363394260406494,
      0.032514918595552444, 0.16508275270462036, 0.08269620686769485, -0.1381007581949234,
    ],
    w2: [
      [-0.08528643846511841, 0.9258883595466614, 0.9372411966323853, -0.2972812354564667, 0.28391730785369873, 0.6539251804351807, -0.45965415239334106, 0.39327797293663025, 0.7302142977714539, 0.6038991212844849, 0.27909255027770996, -0.6000090837478638, 0.8755719065666199, 0.27866849303245544, 0.4186272919178009, 0.5126122236251831],
      [0.38313302397727966, -0.2798565924167633, -0.6670504212379456, 0.7949616312980652, -0.5273675322532654, -0.2648628056049347, 0.8802730441093445, -0.4845865070819855, 0.02055532857775688, -0.3929181396961212, -0.2888396978378296, 1.393118977546692, -0.15848633646965027, -0.014853849075734615, -0.5457460284233093, -0.33138036727905273],
      [0.4096508324146271, 0.6907843351364136, 0.5744191408157349, -0.4921860992908478, 0.21714578568935394, 0.2794820964336395, 0.5689708590507507, 0.11954770237207413, -0.24762453138828278, 1.1214158535003662, 0.8481930494308472, -0.5134627819061279, 0.46792274713516235, 1.0409159660339355, 0.690727710723877, 1.0592621564865112],
      [0.6716789603233337, -0.433378666639328, -0.3417074680328369, 1.1884747743606567, -0.6467021107673645, -1.3498767614364624, 1.0179617404937744, -0.6889092326164246, -0.49025285243988037, -1.0054714679718018, -0.13654395937919617, 1.2754573822021484, -0.7012107372283936, -0.38324686884880066, -0.19201244413852692, -0.1864306926727295],
      [0.3110116124153137, 0.6469503045082092, 0.656973123550415, -0.42947953939437866, 1.0382357835769653, 0.7639718055725098, 0.09721807390451431, 0.9110994935035706, 0.3641708791255951, 0.7807572484016418, 1.0385931730270386, -0.6630306839942932, 0.9146028757095337, 0.6162042021751404, 1.0718811750411987, 1.0075286626815796],
      [-1.461543083190918, 0.7269726395606995, -0.40606456995010376, -0.08050477504730225, -0.5667373538017273, 0.1318613588809967, 0.591193675994873, 0.055499445647001266, 0.07901997119188309, -0.9624040722846985, -0.7183491587638855, -0.02602144330739975, -0.047028105705976486, 0.35150280594825745, 0.912333071231842, -0.6064872145652771],
      [-0.7923133373260498, 0.1591053456068039, 0.8603146076202393, -0.12581093609333038, 0.777137815952301, 0.3313423991203308, -0.10066390782594681, 0.38185828924179077, 0.3132287561893463, -0.3796441853046417, 0.3952942192554474, -0.6672437191009521, 0.29572203755378723, -0.173675075173378, 0.556067943572998, 0.5922378301620483],
      [0.08922634273767471, 0.893825888633728, 0.5647271871566772, -0.331464946269989, 0.1557532101869583, 0.5404926538467407, -0.03166302293539047, 0.49496689438819885, 0.9643188118934631, 0.5456828474998474, 0.10235010832548141, -0.50180584192276, 0.7161643505096436, 0.4410538375377655, -0.008739474229514599, 0.31059911847114563],
    ],
    b2: [
      -0.4448825716972351, 1.08997642993927, -0.07677268236875534, 1.2537405490875244,
      -0.4421117603778839, 0.11290084570646286, -0.42201805114746094, -0.41561034321784973,
    ],
    w3: [
      [1.6813514232635498, -1.5571410655975342, 0.32658571004867554, -2.547600746154785, 0.9485321640968323, -2.1808338165283203, 1.1100209951400757, 1.5548009872436523],
      [-1.6825470924377441, 1.2517266273498535, -1.506621241569519, 1.286407470703125, -1.9308793544769287, 0.43764057755470276, -0.5190735459327698, -2.007999897003174],
      [-0.14856992661952972, 0.2482733279466629, 1.1309523582458496, -0.5288796424865723, 0.34089553356170654, 1.4595993757247925, -1.7829900979995728, -0.24722546339035034],
    ],
    b3: [-0.6362723112106323, 0.5786270499229431, 0.16296890377998352],
  },
};

function denseLayer(input: number[], weights: number[][], bias: number[]): number[] {
  const out = new Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    let sum = bias[i];
    const row = weights[i];
    for (let j = 0; j < input.length; j++) {
      sum += input[j] * row[j];
    }
    out[i] = sum;
  }
  return out;
}

function relu(vec: number[]): number[] {
  return vec.map((v) => Math.max(0, v));
}

function softmax(vec: number[]): number[] {
  const maxVal = Math.max(...vec);
  const exps = vec.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / (sum || 1));
}

export function evaluateFloraSensorModel(
  tempC?: number | null,
  humidityPct?: number | null,
  soilMoisturePct?: number | null
): FloraSensorModelResult | null {
  if (
    typeof tempC !== 'number' || !Number.isFinite(tempC) ||
    typeof humidityPct !== 'number' || !Number.isFinite(humidityPct) ||
    typeof soilMoisturePct !== 'number' || !Number.isFinite(soilMoisturePct)
  ) {
    return null;
  }

  const { mean, std } = FLORA_SENSOR_MODEL_CONFIG.scaler;
  const { w1, b1, w2, b2, w3, b3 } = FLORA_SENSOR_MODEL_CONFIG.weights;

  const x0 = (tempC - mean[0]) / std[0];
  const x1 = (humidityPct - mean[1]) / std[1];
  const x2 = (soilMoisturePct - mean[2]) / std[2];

  const h1 = relu(denseLayer([x0, x1, x2], w1, b1));
  const h2 = relu(denseLayer(h1, w2, b2));
  const logits = denseLayer(h2, w3, b3);
  const probs = softmax(logits);

  const highProb = Number((probs[0] * 100).toFixed(2));
  const lowProb = Number((probs[1] * 100).toFixed(2));
  const modProb = Number((probs[2] * 100).toFixed(2));

  let maxIdx = 0;
  if (probs[1] > probs[maxIdx]) maxIdx = 1;
  if (probs[2] > probs[maxIdx]) maxIdx = 2;

  return {
    sensorRisk: FLORA_SENSOR_MODEL_CONFIG.classes[maxIdx], // 'High' | 'Low' | 'Moderate'
    sensorConfidence: Number((probs[maxIdx] * 100).toFixed(2)),
    highProbability: highProb,
    lowProbability: lowProb,
    moderateProbability: modProb,
  };
}

// ============================================================================
// 2. BMKG SAWAH BESAR <-> LOCAL SENSOR CORRELATION ENGINE
//    Integrates live BMKG forecast & CAP warnings with ESP32 DHT22, Soil, Flame
// ============================================================================

export interface BmkgSensorCorrelation {
  severity: 'NORMAL' | 'ADVISORY' | 'WARNING' | 'CRITICAL';
  headline: string;
  advisory: string;
  tempDeltaC: number | null;
  rhDeltaPct: number | null;
  windSpeedKmh: number | null;
  precipitationMm: number | null;
  weatherDesc: string | null;
  hasRainForecast: boolean;
  hasJakartaAlert: boolean;
}

export function evaluateBmkgSensorCorrelation(params: {
  localTemp: number | null;
  localRh: number | null;
  localSoil: number | null;
  flameDetected: number | null;
  visionPrediction: string | null;
  bmkgForecast: BmkgNormalizedForecast | null;
  bmkgAlerts: BmkgNormalizedAlert[];
}): BmkgSensorCorrelation {
  const {
    localTemp,
    localRh,
    localSoil,
    flameDetected,
    visionPrediction,
    bmkgForecast,
    bmkgAlerts,
  } = params;

  const step = bmkgForecast?.currentStep ?? null;
  const bmkgTemp = step?.temperatureC ?? null;
  const bmkgRh = step?.humidityPercent ?? null;
  const windSpeedKmh = step?.windSpeedKmh ?? null;
  const precipitationMm = step?.precipitationMm ?? null;
  const weatherDesc = step?.weatherDesc ?? null;

  const tempDeltaC =
    typeof localTemp === 'number' && typeof bmkgTemp === 'number'
      ? Number((localTemp - bmkgTemp).toFixed(1))
      : null;

  const rhDeltaPct =
    typeof localRh === 'number' && typeof bmkgRh === 'number'
      ? Number((localRh - bmkgRh).toFixed(1))
      : null;

  const hasRainForecast =
    (typeof precipitationMm === 'number' && precipitationMm >= 0.5) ||
    Boolean(weatherDesc && /hujan|petir|gerimis/i.test(weatherDesc));

  const hasJakartaAlert = bmkgAlerts.some(
    (a) => a.applicability === 'GEOGRAPHIC_MATCH' || a.isJakartaRelevant
  );

  const isFireActive =
    (typeof flameDetected === 'number' && flameDetected > 0) ||
    Boolean(visionPrediction && /fire|active surface fire/i.test(visionPrediction));

  if (isFireActive) {
    return {
      severity: 'CRITICAL',
      headline: 'Titik Api Aktif + Korelasi Angin BMKG Sawah Besar',
      advisory:
        typeof windSpeedKmh === 'number'
          ? `Flame 5-Ch / Vision mendeteksi api aktif dengan kecepatan angin BMKG Sawah Besar ${windSpeedKmh.toFixed(1)} km/h. Prioritaskan pemadaman segera — interlock darurat beroperasi independen.`
          : 'Flame 5-Ch / Vision mendeteksi api aktif. Prioritaskan pemadaman segera.',
      tempDeltaC,
      rhDeltaPct,
      windSpeedKmh,
      precipitationMm,
      weatherDesc,
      hasRainForecast,
      hasJakartaAlert,
    };
  }

  if (typeof localSoil === 'number' && localSoil < 35 && hasRainForecast) {
    return {
      severity: 'ADVISORY',
      headline: 'Tanah Kering vs Prakiraan Hujan BMKG Sawah Besar',
      advisory: `Kelembapan tanah lokal rendah (${localSoil.toFixed(1)}%), namun BMKG Sawah Besar memprakirakan "${weatherDesc || 'Hujan'}" (${precipitationMm ?? 0} mm). Siram singkat atau pantau hujan alami sebelum irigasi penuh.`,
      tempDeltaC,
      rhDeltaPct,
      windSpeedKmh,
      precipitationMm,
      weatherDesc,
      hasRainForecast,
      hasJakartaAlert,
    };
  }

  if (hasJakartaAlert) {
    return {
      severity: 'WARNING',
      headline: 'Peringatan Dini Nowcast CAP Aktif Area DKI Jakarta / Sawah Besar',
      advisory:
        typeof localSoil === 'number' && localSoil > 75
          ? `Tanah sudah jenuh (${localSoil.toFixed(1)}%) dan Nowcast BMKG aktif. Pastikan Pump Lockout aktif agar perakaran tidak tergenang.`
          : 'Peringatan dini cuaca BMKG aktif untuk wilayah Jakarta. Siagakan pemantauan DHT22, Soil v1.2, dan kanopi ESP32-CAM.',
      tempDeltaC,
      rhDeltaPct,
      windSpeedKmh,
      precipitationMm,
      weatherDesc,
      hasRainForecast,
      hasJakartaAlert,
    };
  }

  if (tempDeltaC !== null && tempDeltaC >= 3.0) {
    return {
      severity: 'ADVISORY',
      headline: 'Anomali Panas Mikro vs Makro BMKG Sawah Besar',
      advisory: `Suhu DHT22 lokal +${tempDeltaC.toFixed(1)}°C lebih hangat dari suhu udara BMKG Sawah Besar (${bmkgTemp}°C). Pertimbangkan misting kanopi bila kelembapan tanah menurun.`,
      tempDeltaC,
      rhDeltaPct,
      windSpeedKmh,
      precipitationMm,
      weatherDesc,
      hasRainForecast,
      hasJakartaAlert,
    };
  }

  return {
    severity: 'NORMAL',
    headline: step
      ? `Selaras dengan Cuaca BMKG Sawah Besar (${weatherDesc || 'Stabil'})`
      : 'Menunggu Sinkronisasi Cuaca BMKG Sawah Besar',
    advisory:
      step && typeof localTemp === 'number'
        ? `Mikroklimat lokal (${localTemp.toFixed(1)}°C / RH ${localRh?.toFixed(0) ?? '--'}%) sinkron dengan makro Sawah Besar (${bmkgTemp}°C / ${bmkgRh}%).`
        : 'Data makro BMKG Sawah Besar (5 Kelurahan Jakarta Pusat) siap disandingkan dengan telemetri sensor fisik ESP32.',
    tempDeltaC,
    rhDeltaPct,
    windSpeedKmh,
    precipitationMm,
    weatherDesc,
    hasRainForecast,
    hasJakartaAlert,
  };
}

// ============================================================================
// 3. KAGGLE DATASET BENCHMARKS & ACTIVE MODEL METADATA
//    1) Botanical ANN: https://www.kaggle.com/datasets/raykenzie/flora-environmental-risk-dataset
//    2) Vision MobileNetV2: be-binus-production.up.railway.app (3-Class TFLite)
// ============================================================================

export const KAGGLE_FLORA_DATASET_STATS = {
  datasetTitle: 'FLORA Environmental Risk Dataset',
  datasetUrl: 'https://www.kaggle.com/datasets/raykenzie/flora-environmental-risk-dataset',
  totalSamples: 9000,
  classBalance: {
    Low: 3000,
    Moderate: 3000,
    High: 3000,
  },
  features: {
    temperature_c: { mean: 28.62, std: 4.91, unit: '°C', label: 'Ambient Temperature (DHT22)' },
    humidity_percent: { mean: 59.83, std: 14.31, unit: '%', label: 'Relative Humidity (DHT22)' },
    soil_moisture_percent: { mean: 67.15, std: 17.56, unit: '%', label: 'Soil Moisture (Capacitive)' },
  },
};

export const VISION_MODEL_BENCHMARKS = {
  modelTitle: 'AGRAPATHA MobileNetV2 TFLite Vision Classifier',
  architecture: 'MobileNetV2 (224x224 RGB)',
  runtime: 'ai-edge-litert (be-binus Railway)',
  classes: ['Fire', 'Smoke', 'Non-Fire'] as const,
  endpoint: 'https://be-binus-production.up.railway.app/predict/fire',
  transport: 'ESP32-CAM OV2640 + ESP-NOW -> Main Controller',
};
