/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ZERO-CONFIG IOT CONFIGURATION
 * Single Source of Truth for Web Dashboard & Hardware Synchronization
 * ==============================================================================
 * Keunggulan:
 * 1. ZERO-CONFIG: Tidak membutuhkan file .env. Langsung jalan out-of-the-box.
 * 2. GATEWAY FIRST: Terhubung ke Read-Only Backend Gateway untuk telemetri dan visi.
 * 3. RUNTIME PERSISTENCE: Pengaturan dapat diubah lewat UI dan tersimpan di localStorage.
 * ==============================================================================
 */

export interface IotRailwayConfig {
  wildfireUrl: string;
  leafUrl: string | null;
}

export interface IotHardwareConfig {
  esp32MainMac: string;
  esp32CamMac: string;
  espNowChannel: number;
  pins: {
    dht: number;
    soil: number;
    flameChannels: number[];
    servos: number[];
    pumpRelay: number;
    motorIn1: number;
    motorIn2: number;
    limitLeft: number;
    limitRight: number;
  };
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface IotGatewayConfig {
  baseUrl: string;
}

export interface IotConfig {
  gateway: IotGatewayConfig;
  railway: IotRailwayConfig;
  hardware: IotHardwareConfig;
}

const LOCAL_STORAGE_KEY = 'agrapatha_iot_runtime_config_v1';

// Default Hardcoded Configuration (Zero .env Required)
export const DEFAULT_IOT_CONFIG: IotConfig = {
  gateway: {
    baseUrl: '', // Defaults to same-origin relative path (proxied in dev, direct in prod)
  },
  railway: {
    wildfireUrl: 'https://be-binus-production.up.railway.app',
    leafUrl: null, // Leaf disease removed per hardware specification
  },
  hardware: {
    esp32MainMac: '8C:AA:B5:37:71:18',
    esp32CamMac: 'F8:B3:B7:A6:F3:9C',
    espNowChannel: 6,
    pins: {
      dht: 4,
      soil: 34,
      flameChannels: [25, 26, 27, 32, 33],
      servos: [13, 14, 15, 5],
      pumpRelay: 23,
      motorIn1: 16,
      motorIn2: 17,
      limitLeft: 18,
      limitRight: 19,
    },
  },
};

/**
 * Loads the active configuration.
 * Priority:
 * 1. Runtime overrides saved in browser localStorage
 * 2. Optional Vite environment variables (if provided)
 * 3. Solid hardcoded default values (zero-config, works 100% without .env)
 */
export function getIotConfig(): IotConfig {
  let runtimeOverrides: Partial<IotConfig> = {};

  // Check localStorage (browser runtime)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        runtimeOverrides = JSON.parse(stored);
      }
    } catch {
      // ignore
    }
  }

  // Check optional env vars (if user still has them, but not required)
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {} as Record<string, string>;

  const rawGatewayBaseUrl = runtimeOverrides.gateway?.baseUrl ?? (env.VITE_GATEWAY_BASE_URL !== undefined ? env.VITE_GATEWAY_BASE_URL : DEFAULT_IOT_CONFIG.gateway.baseUrl);
  const gatewayBaseUrl = typeof rawGatewayBaseUrl === 'string' ? rawGatewayBaseUrl.replace(/\/+$/, '') : '';

  const wildfireUrl = runtimeOverrides.railway?.wildfireUrl || env.VITE_VISION_API_BASE_URL || DEFAULT_IOT_CONFIG.railway.wildfireUrl;
  const leafUrl = runtimeOverrides.railway?.leafUrl ?? (env.VITE_LEAF_API_BASE_URL || DEFAULT_IOT_CONFIG.railway.leafUrl);

  return {
    gateway: {
      baseUrl: gatewayBaseUrl,
    },
    railway: {
      wildfireUrl,
      leafUrl,
    },
    hardware: {
      ...DEFAULT_IOT_CONFIG.hardware,
      ...(runtimeOverrides.hardware || {}),
    },
  };
}

/**
 * Persists runtime configuration overrides to browser localStorage.
 */
export function saveIotConfig(overrides: DeepPartial<IotConfig>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const current = getIotConfig();
      const merged = {
        ...current,
        ...overrides,
        gateway: { ...current.gateway, ...(overrides.gateway || {}) },
        railway: { ...current.railway, ...(overrides.railway || {}) },
        hardware: { ...current.hardware, ...(overrides.hardware || {}) },
      };
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }
}

/**
 * Loads the active backend gateway configuration.
 */
export function getGatewayConfig(): IotGatewayConfig {
  return getIotConfig().gateway;
}

export interface EmqxWssConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  telemetryTopics: string[];
}

/**
 * Returns Direct Browser MQTT-over-WSS (Port 8084) configuration for serverless
 * deployments (e.g., Vercel) where no local Node.js SSE gateway is running.
 * Auto-connecting is strictly read-only until the operator explicitly arms actuators.
 */
export function getEmqxWssConfig(): EmqxWssConfig {
  const env = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env as Record<string, string | undefined>)
    : {};

  return {
    host: (env.VITE_MQTT_HOST || 'q2277711.ala.asia-southeast1.emqxsl.com').trim(),
    port: Number(env.VITE_MQTT_WS_PORT) || 8084,
    username: (env.VITE_MQTT_USERNAME || 'agrapatha').trim(),
    password: env.VITE_MQTT_PASSWORD || 'agrapatha123',
    telemetryTopics: ['agrapatha/telemetry', 'grenvis/sensor/data'],
  };
}

/**
 * Resets runtime configuration back to factory default constants.
 */
export function resetIotConfig(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
