/**
 * AGRAPATHA — Sensor Display & Zero-Dummy-Data Formatting Helpers
 *
 * Implements strict zero-dummy-data, software-first presentation:
 * - When valid live telemetry is absent, disconnected, or stale, sensor values format as 'Unavailable' or 'Not Connected'.
 * - Sensor measurements are NEVER represented as zero-valued live measurements when data is unavailable or disconnected.
 * - Stale telemetry is clearly distinguished from fresh telemetry and never conflated with live conditions.
 * - Device status explicitly distinguishes 'LIVE', 'STALE TELEMETRY', 'MQTT DISCONNECTED', and 'NOT CONNECTED'.
 */

export interface SensorDisplayConfig {
  value: string;
  statusLabel: string;
  isWarn: boolean;
  percent: number;
  barColor: string;
  extra: string;
}

/**
 * Formats a sensor number value for display.
 * Returns formatted numeric string if live and valid; returns fallback ('Unavailable' or 'Not Connected') when offline/null.
 * Never represents unavailable data as a zero-valued live measurement.
 */
export function formatSensorValue(
  value: number | null | undefined,
  isLiveValid: boolean,
  decimals = 1,
  fallback = 'Unavailable'
): string {
  if (isLiveValid && typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(decimals);
  }
  return fallback;
}

export const FLAME_CHANNEL_SPECS = [
  { channel: 1, key: 'CH1', gpio: 25, label: 'Paling Kiri', shortLabel: 'P.Kiri', angleDeg: 30 },
  { channel: 2, key: 'CH2', gpio: 26, label: 'Kiri', shortLabel: 'Kiri', angleDeg: 60 },
  { channel: 3, key: 'CH3', gpio: 27, label: 'Tengah', shortLabel: 'Tengah', angleDeg: 90 },
  { channel: 4, key: 'CH4', gpio: 32, label: 'Kanan', shortLabel: 'Kanan', angleDeg: 120 },
  { channel: 5, key: 'CH5', gpio: 33, label: 'Paling Kanan', shortLabel: 'P.Kanan', angleDeg: 150 },
] as const;

export interface FlameDirectionAnalysis {
  isFireActive: boolean;
  activeIndices: number[];
  channelStates: boolean[];
  shortSide: string;
  sectorSummary: string;
  detailLabel: string;
  targetYawDeg: number | null;
}

/**
 * Resolves exact flame origin sector and weighted servo yaw angle from 5-channel flame array
 * (GPIO 25..33: Paling Kiri -> Paling Kanan) plus optional firmware direction fields.
 */
export function analyzeFlameDirection(
  flameChannels: number[] | null | undefined,
  flameDetected: number | null | undefined,
  rawDirection?: string | null,
  rawAngle?: number | null,
  isLiveValid = true
): FlameDirectionAnalysis {
  if (!isLiveValid) {
    return {
      isFireActive: false,
      activeIndices: [],
      channelStates: [false, false, false, false, false],
      shortSide: 'STANDBY',
      sectorSummary: 'STANDBY',
      detailLabel: 'Menunggu telemetri sensor Flame 5-Ch aktif',
      targetYawDeg: null,
    };
  }

  const channelStates = FLAME_CHANNEL_SPECS.map((_, idx) =>
    Boolean(flameChannels && typeof flameChannels[idx] === 'number' && flameChannels[idx] > 0)
  );
  const activeIndices: number[] = [];
  channelStates.forEach((active, idx) => {
    if (active) activeIndices.push(idx);
  });

  if (activeIndices.length === 1) {
    const spec = FLAME_CHANNEL_SPECS[activeIndices[0]];
    const yawDeg = typeof rawAngle === 'number' && Number.isFinite(rawAngle) && rawAngle >= 0 ? Math.round(rawAngle) : spec.angleDeg;
    return {
      isFireActive: true,
      activeIndices,
      channelStates,
      shortSide: `${spec.label.toUpperCase()} (${spec.key})`,
      sectorSummary: `${spec.key} · ${spec.label} (${yawDeg}°)` ,
      detailLabel: `Sumber api di sebelah ${spec.label} (${spec.key} GPIO ${spec.gpio} · Yaw ${yawDeg}°)` ,
      targetYawDeg: yawDeg,
    };
  }

  if (activeIndices.length > 1) {
    const computedAvg = Math.round(
      activeIndices.reduce((sum, idx) => sum + FLAME_CHANNEL_SPECS[idx].angleDeg, 0) / activeIndices.length
    );
    const yawDeg = typeof rawAngle === 'number' && Number.isFinite(rawAngle) && rawAngle >= 0 ? Math.round(rawAngle) : computedAvg;
    const chCodes = activeIndices.map((idx) => FLAME_CHANNEL_SPECS[idx].key).join('+');
    const sideText = yawDeg < 78 ? 'Sektor Kiri' : yawDeg > 102 ? 'Sektor Kanan' : 'Sektor Tengah';
    const sideLabels = activeIndices.map((idx) => `${FLAME_CHANNEL_SPECS[idx].key} ${FLAME_CHANNEL_SPECS[idx].label}`).join(', ');
    return {
      isFireActive: true,
      activeIndices,
      channelStates,
      shortSide: `${sideText.toUpperCase()} (${chCodes})`,
      sectorSummary: `${chCodes} · ${sideText} (${yawDeg}°)` ,
      detailLabel: `Sumber api multi-kanal: ${sideLabels} (Target Yaw ${yawDeg}°)` ,
      targetYawDeg: yawDeg,
    };
  }

  const cleanRawDir = rawDirection && rawDirection.trim() !== '' && rawDirection.trim().toUpperCase() !== 'AMAN' ? rawDirection.trim() : null;
  if ((typeof flameDetected === 'number' && Number.isFinite(flameDetected) && flameDetected > 0) || cleanRawDir) {
    const yawDeg = typeof rawAngle === 'number' && Number.isFinite(rawAngle) && rawAngle >= 0 ? Math.round(rawAngle) : null;
    return {
      isFireActive: true,
      activeIndices: [],
      channelStates,
      shortSide: cleanRawDir ? cleanRawDir.toUpperCase() : 'FLAME DETECTED',
      sectorSummary: cleanRawDir ? (yawDeg !== null ? `${cleanRawDir} (${yawDeg}°)` : cleanRawDir) : 'Api Terdeteksi',
      detailLabel: cleanRawDir ? `Api terdeteksi (${cleanRawDir})` : 'Api terdeteksi tanpa penanda kanal spesifik',
      targetYawDeg: yawDeg,
    };
  }

  return {
    isFireActive: false,
    activeIndices: [],
    channelStates,
    shortSide: 'AMAN',
    sectorSummary: 'AMAN (5 Sektor Clear)',
    detailLabel: 'Semua kanal CH1 (P.Kiri) s.d. CH5 (P.Kanan) dalam kondisi aman',
    targetYawDeg: null,
  };
}

/**
 * Formats flame sensor reading (0 = aman, 1 = flame).
 */
export function formatFlameValue(
  value: number | boolean | null | undefined,
  isLiveValid: boolean,
  fallback = 'Unavailable'
): string {
  if (isLiveValid) {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 0 ? '1' : '0';
    }
  }
  return fallback;
}

/**
 * Returns explicit status label for active sensor & BMKG cards.
 * Returns 'NOT CONNECTED' or 'STALE' when live validity is false, never deriving false environmental categories.
 */
export function getSensorStatusLabel(
  sensorType: 'temp' | 'rh' | 'soil' | 'flame' | 'bmkg_rain' | 'bmkg_wind',
  value: number | null | undefined,
  isLiveValid: boolean,
  auxiliaryStatus?: string | null,
  isStale = false
): string {
  if (!isLiveValid || typeof value !== 'number' || !Number.isFinite(value)) {
    return isStale ? 'STALE' : 'NOT CONNECTED';
  }

  switch (sensorType) {
    case 'temp':
      return value >= 32 ? 'SUHU TINGGI' : value <= 20 ? 'SEJUK' : 'OPTIMAL';
    case 'rh':
      return value < 35 ? 'KERING KRITIS' : value > 80 ? 'LEMBAP TINGGI' : 'MODERAT';
    case 'soil':
      return value < 35 ? 'TANAH KERING' : value > 80 ? 'BASAH JENUH' : 'LEMBAP SUBUR';
    case 'flame': {
      if (auxiliaryStatus) return auxiliaryStatus.toUpperCase();
      return value > 0 ? 'FLAME DETECTED' : 'AMAN';
    }
    case 'bmkg_rain': {
      const status = auxiliaryStatus ? auxiliaryStatus.toUpperCase() : '';
      if (status.includes('LEBAT') || value >= 5.0) return 'HUJAN LEBAT';
      if (status.includes('HUJAN') || status.includes('GERIMIS') || value > 0) return 'BERPOTENSI HUJAN';
      return 'CERAH / BERAWAN';
    }
    case 'bmkg_wind':
      return value >= 25 ? 'ANGIN KENCANG' : value >= 12 ? 'ANGIN SEDANG' : 'ANGIN TENANG';
    default:
      return isStale ? 'STALE' : 'NOT CONNECTED';
  }
}

/**
 * Returns device connectivity badge text.
 */
export function getDeviceConnectivityStatus(
  isLiveTelemetry: boolean,
  isTelemetryStale: boolean,
  gatewayStatus: 'connecting' | 'connected' | 'error' | 'closed',
  mqttConnected = false
): {
  text: string;
  dotClass: string;
  wrapperClass: string;
  isOnline: boolean;
} {
  if (isLiveTelemetry && !isTelemetryStale) {
    return {
      text: 'DEVICE ONLINE · LIVE',
      dotClass: 'bg-[#16A34A] animate-pulse ring-2 ring-[#5DD62C]/40',
      wrapperClass: 'bg-[#EFF3EF] border-[#5DD62C] text-[#263A35]',
      isOnline: true,
    };
  }

  if (isLiveTelemetry && isTelemetryStale) {
    return {
      text: 'DEVICE OFFLINE (STALE TELEMETRY)',
      dotClass: 'bg-[#D97706] animate-pulse ring-2 ring-[#D97706]/40',
      wrapperClass: 'bg-[#FEF7E8] border-[#FDE3B5] text-[#8A570C]',
      isOnline: false,
    };
  }

  if (gatewayStatus === 'connected') {
    if (!mqttConnected) {
      return {
        text: 'DEVICE OFFLINE (MQTT DISCONNECTED)',
        dotClass: 'bg-[#D97706] animate-pulse ring-2 ring-[#D97706]/40',
        wrapperClass: 'bg-[#FEF7E8] border-[#FDE3B5] text-[#8A570C]',
        isOnline: false,
      };
    }
    return {
      text: 'DEVICE NOT CONNECTED (NO TELEMETRY)',
      dotClass: 'bg-[#94A3B8]',
      wrapperClass: 'bg-white border-[#A6B49E] text-[#263A35]',
      isOnline: false,
    };
  }

  if (gatewayStatus === 'connecting') {
    return {
      text: 'CONNECTING TO GATEWAY...',
      dotClass: 'bg-[#D97706] animate-pulse',
      wrapperClass: 'bg-white border-[#D6DCCE] text-[#263A35]',
      isOnline: false,
    };
  }

  return {
    text: 'GATEWAY OFFLINE',
    dotClass: 'bg-[#DC2626]',
    wrapperClass: 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]',
    isOnline: false,
  };
}

/**
 * Strict safety check for AI model evaluation.
 * Returns false if telemetry is offline, stale, or any required feature is missing.
 */
export function isModelEvaluationPermitted(
  isLiveTelemetry: boolean,
  isTelemetryStale: boolean,
  requiredFeatures: Array<number | null | undefined>
): boolean {
  if (!isLiveTelemetry || isTelemetryStale) {
    return false;
  }
  for (const feat of requiredFeatures) {
    if (typeof feat !== 'number' || !Number.isFinite(feat)) {
      return false;
    }
  }
  return true;
}
