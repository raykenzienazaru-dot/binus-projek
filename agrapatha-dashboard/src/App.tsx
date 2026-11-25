import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateBmkgSensorCorrelation,
  evaluateFloraSensorModel,
} from './lib/aiModels';
import { FloraSplash } from './components/FloraSplash';
import { FloraKaggleSection } from './components/FloraKaggleSection';
import { FloraHistoryCanvas, type TelemetryHistoryPoint } from './components/FloraHistoryCanvas';
import { FloraBmkgCard } from './components/FloraBmkgCard';
import { Model2BotanicalView } from './components/Model2BotanicalView';
import type { BmkgServiceState } from './types/bmkg';
import {
  AlertCircle,
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  Bell,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Crosshair,
  Droplet,
  Flame,
  Info,
  Layers,
  LayoutGrid,
  Leaf,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Upload,
  Video,
  VideoOff,
  Wind,
} from 'lucide-react';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import type {
  CameraStatus,
  CaptureSource,
  InferenceStatus,
  WildfirePredictionData,
} from './types/vision';
import {
  captureFrameFromVideo,
  startCameraStream,
  stopMediaStream,
  validateImageFile,
} from './lib/cameraCapture';
import { predictWildfireImage } from './lib/wildfireService';
import { MqttWssClient } from './lib/mqttWssClient';
import { getEmqxWssConfig } from './config/iotConfig';
import {
  parseGatewayTelemetry,
  subscribeGatewayTelemetry,
  fetchLatestCameraFrame,
  checkGatewayHealth,
  type GatewayTelemetryPayload,
  type GatewayConnectionStatus,
  type GatewayHealthResponse,
} from './lib/gatewayService';
import {
  FLAME_CHANNEL_SPECS,
  analyzeFlameDirection,
  formatSensorValue,
  getSensorStatusLabel,
  getDeviceConnectivityStatus,
} from './lib/sensorDisplay';

const SECTION_IDS = [
  'overview',
  'monitoring',
  'bmkg',
  'analysis',
  'benchmarks',
  'cameraCapture',
  'device-control',
  'treatment',
  'history',
  'devices',
] as const;

interface WateringLogEvent {
  id: number;
  timestamp: string;
  soilBefore: number;
  note: string;
}

// Leaf component for clock to isolate 1-second interval re-renders from the dashboard tree
const LiveClockBadge: React.FC<{ isGlassy: boolean }> = React.memo(({ isGlassy }) => {
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      className={`hidden xl:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold text-emerald-100 font-tabular shadow-xs transition-all duration-200 cursor-default select-none whitespace-nowrap shrink-0 ${isGlassy
          ? 'bg-white/10 backdrop-blur-md border-white/20'
          : 'bg-white/10 border-white/15'
        }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
      <span>{clockText}</span>
    </span>
  );
});

export type ActiveDashboardTab = 'overview' | 'bmkg' | 'model_botanical' | 'model_vision' | 'all';

export const App: React.FC = () => {
  // Boot splash state ('boot' shows the 3D Welcome screen just like flora-six-zeta.vercel.app)
  const [viewMode, setViewMode] = useState<'boot' | 'dashboard'>('boot');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [currentTab, setCurrentTab] = useState<ActiveDashboardTab>('overview');
  const [isDashboard1Open, setIsDashboard1Open] = useState(true);
  const isDashboard1Active = currentTab === 'overview' || currentTab === 'bmkg' || currentTab === 'model_botanical' || currentTab === 'model_vision';
  const [isScrolled, setIsScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > 0);
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Live telemetry parameters initialized to null (strict live-only data integrity)
  const [temp, setTemp] = useState<number | null>(null);
  const [rh, setRh] = useState<number | null>(null);
  const [soilMoisture, setSoilMoisture] = useState<number | null>(null);

  // BMKG Sawah Besar, Jakarta Pusat Regional Weather & CAP Alert State
  const [bmkgState, setBmkgState] = useState<BmkgServiceState | null>(null);
  const bmkgStep = bmkgState?.forecast?.currentStep ?? null;
  const bmkgAlerts = useMemo(() => bmkgState?.alerts ?? [], [bmkgState]);
  const bmkgStepRef = useRef(bmkgStep);
  useEffect(() => {
    bmkgStepRef.current = bmkgStep;
  }, [bmkgStep]);

  // Vision & Camera state
  const [visionPrediction, setVisionPrediction] = useState<string>('Standby / Belum Dianalisis');
  const [visionProbs, setVisionProbs] = useState({ healthy: 0, smoke: 0, fire: 0 });
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);

  // Optical Fire & Smoke Vision State (MobileNetV2 · be-binus Railway)
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [captureSource, setCaptureSource] = useState<CaptureSource>('none');
  const [capturedBlob, setCapturedBlob] = useState<Blob | File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inferenceStatus, setInferenceStatus] = useState<InferenceStatus>('idle');
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [wildfireResult, setWildfireResult] = useState<WildfirePredictionData | null>(null);
  const [isVideoReady, setIsVideoReady] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeInferenceAbortRef = useRef<AbortController | null>(null);


  // Actuator / Rail L298N & 4-DoF Robot Arm State (Zero-Dummy Live Values)
  const [movementStatus, setMovementStatus] = useState<
    'idle' | 'left_command_sent' | 'right_command_sent' | 'stop_command_sent' | 'capture_command_sent'
  >('idle');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [limitLeft, setLimitLeft] = useState<boolean>(false);
  const [limitRight, setLimitRight] = useState<boolean>(false);
  const [zone, setZone] = useState<number | null>(null);
  const [pumpStatus, setPumpStatus] = useState<boolean | null>(null);
  const [pumpLockout, setPumpLockout] = useState<boolean | null>(null);
  const [flameChannels, setFlameChannels] = useState<number[] | null>(null);
  const [flameDirection, setFlameDirection] = useState<string | null>(null);
  const [flameAngle, setFlameAngle] = useState<number | null>(null);
  const [armManualMode, setArmManualMode] = useState<boolean | null>(null);
  const [servoAngles, setServoAngles] = useState<number[] | null>(null);
  const [manualServoAngles, setManualServoAngles] = useState<[number, number, number, number]>([90, 45, 45, 90]);
  const servoInitializedFromTelemetryRef = useRef<boolean>(false);
  const [systemState, setSystemState] = useState<string | null>(null);
  const [envCondition, setEnvCondition] = useState<string | null>(null);
  const [actionCommand, setActionCommand] = useState<string | null>(null);
  const [commandLabel, setCommandLabel] = useState<string | null>(null);
  const railPositionMm = limitLeft ? 0 : limitRight ? 1200 : zone === 2 ? 600 : zone === 1 ? 150 : zone === 3 ? 1050 : null;

  // Direct EMQX Cloud WSS (Port 8084) State for Two-Way Robot Command Dispatch
  const emqxWssDefaults = useMemo(() => getEmqxWssConfig(), []);
  const [mqttHostInput, setMqttHostInput] = useState<string>(emqxWssDefaults.host);
  const [mqttUserInput, setMqttUserInput] = useState<string>(() => {
    try {
      return (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('agrapatha_mqtt_user')) || emqxWssDefaults.username;
    } catch {
      return emqxWssDefaults.username;
    }
  });
  const [mqttPassInput, setMqttPassInput] = useState<string>(emqxWssDefaults.password);
  const [mqttWssStatus, setMqttWssStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [mqttWssError, setMqttWssError] = useState<string | null>(null);
  const [actuatorArmed, setActuatorArmed] = useState<boolean>(false);
  const mqttWssRef = useRef<MqttWssClient | null>(null);
  const mqttWssStatusRef = useRef(mqttWssStatus);
  useEffect(() => {
    mqttWssStatusRef.current = mqttWssStatus;
  }, [mqttWssStatus]);
  const hadSseTelemetryRef = useRef<boolean>(false);

  // Watering / Suppression log state initialized empty (live session logs only)
  const [wateringEvents, setWateringEvents] = useState<WateringLogEvent[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const showToast = useCallback((msg: string) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3200);
  }, []);


  // Backend Gateway SSE Telemetry State (/api/telemetry/stream)
  const [gatewayStatus, setGatewayStatus] = useState<GatewayConnectionStatus>('connecting');
  const [isLiveTelemetry, setIsLiveTelemetry] = useState<boolean>(false);
  const [isTelemetryStale, setIsTelemetryStale] = useState<boolean>(false);
  const [lastLiveTelemetryTime, setLastLiveTelemetryTime] = useState<Date | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthResponse | null>(null);
  const [, setGatewayUptimeSeconds] = useState<number | null>(null);
  const [, setSoilRaw] = useState<number | null>(null);
  const [flameDetected, setFlameDetected] = useState<number | null>(null);
  const [, setFlameRaw] = useState<number | null>(null);
  const [motorDriverInfo, setMotorDriverInfo] = useState<string>('L298N OUT3 & OUT4');
  const [activeNodeId] = useState<string | null>(null);
  const [edgePrediction, setEdgePrediction] = useState<string | null>(null);
  const [edgeConfidence, setEdgeConfidence] = useState<number | null>(null);

  // Gateway Camera Frame State (/api/vision/latest-frame.jpg)
  const [gatewayFrameMeta, setGatewayFrameMeta] = useState<{
    byteLength: number;
    receivedAt: number | null;
    ageSeconds: number | null;
    isStale: boolean;
  } | null>(null);
  const [isFetchingGatewayFrame, setIsFetchingGatewayFrame] = useState<boolean>(false);
  const [gatewayFrameStatus, setGatewayFrameStatus] = useState<'idle' | 'standby' | 'ready' | 'error'>('idle');
  const isFetchingFrameRef = useRef(false);

  // Stable references to decouple effect lifecycle from reactive sensor updates
  const lastTelemetryTimestampRef = useRef<number | null>(null);
  const sensorValuesRef = useRef<{
    temp: number | null;
    rh: number | null;
    soilMoisture: number | null;
  }>({ temp, rh, soilMoisture });
  useEffect(() => {
    sensorValuesRef.current = { temp, rh, soilMoisture };
  });

  // Fetch latest camera JPEG frame from backend cache (/api/vision/latest-frame.jpg)
  const handleFetchGatewayFrame = useCallback(async (manual = false) => {
    if (isFetchingFrameRef.current) return;
    isFetchingFrameRef.current = true;
    setIsFetchingGatewayFrame(true);

    try {
      const res = await fetchLatestCameraFrame();
      if (res.hasFrame && res.frame) {
        const newUrl = URL.createObjectURL(res.frame.blob);
        setGatewayFrameMeta({
          byteLength: res.frame.byteLength,
          receivedAt: res.frame.receivedAt,
          ageSeconds: res.frame.ageSeconds,
          isStale: res.frame.isStale,
        });
        setGatewayFrameStatus('ready');
        setLastCaptureTime(new Date(res.frame.receivedAt || Date.now()).toISOString());

        // Make frame available for AI visual inference (previewUrl effect handles single-owner lifecycle)
        setCapturedBlob(res.frame.blob);
        setPreviewUrl(newUrl);
        setCaptureSource('gateway');
        setCameraStatus('captured');
        setInferenceStatus('idle');
        setInferenceError(null);

        if (manual) {
          showToast(`Frame gateway berhasil dimuat (${(res.frame.byteLength / 1024).toFixed(1)} KB${res.frame.isStale ? ' · STALE' : ''})`);
        }
      } else {
        setGatewayFrameStatus('standby');
        if (manual) {
          showToast('Belum ada frame kamera di cache gateway (HTTP 204 Standby). Menunggu transmisi ESP32-CAM.');
        }
      }
    } catch (err: unknown) {
      setGatewayFrameStatus('error');
      if (manual) {
        const msg = err instanceof Error ? err.message : 'Gagal mengambil frame dari gateway';
        showToast(msg);
      }
    } finally {
      isFetchingFrameRef.current = false;
      setIsFetchingGatewayFrame(false);
    }
  }, [showToast]);

  const fetchGatewayFrameRef = useRef(handleFetchGatewayFrame);
  useEffect(() => {
    fetchGatewayFrameRef.current = handleFetchGatewayFrame;
  });

  const resetTelemetryState = useCallback(() => {
    setIsLiveTelemetry(false);
    setIsTelemetryStale(false);
    setTemp(null);
    setRh(null);
    setSoilMoisture(null);
    setSoilRaw(null);
    setFlameDetected(null);
    setFlameRaw(null);
    setEdgePrediction(null);
    setEdgeConfidence(null);
    setZone(null);
    setPumpStatus(null);
    setPumpLockout(null);
    setFlameChannels(null);
    setFlameDirection(null);
    setFlameAngle(null);
    setArmManualMode(null);
    setServoAngles(null);
    servoInitializedFromTelemetryRef.current = false;
    setSystemState(null);
    setEnvCondition(null);
    setActionCommand(null);
    setCommandLabel(null);
  }, []);

  const applyTelemetryPayload = useCallback((payload: GatewayTelemetryPayload) => {
    const now = Date.now();
    lastTelemetryTimestampRef.current = now;
    setLastLiveTelemetryTime(new Date(now));
    setIsLiveTelemetry(true);
    setIsTelemetryStale(payload.freshness === 'STALE');

    const newTemp = typeof payload.temp === 'number' && Number.isFinite(payload.temp) ? Number(payload.temp.toFixed(1)) : null;
    const newRh = typeof payload.rh === 'number' && Number.isFinite(payload.rh) ? Number(payload.rh.toFixed(1)) : null;
    const newSoil = typeof payload.soilMoisture === 'number' && Number.isFinite(payload.soilMoisture) ? Number(payload.soilMoisture.toFixed(1)) : null;

    if (newTemp !== null) setTemp(newTemp);
    if (newRh !== null) setRh(newRh);
    if (newSoil !== null) setSoilMoisture(newSoil);
    if (typeof payload.soilRaw === 'number' && Number.isFinite(payload.soilRaw)) {
      setSoilRaw(payload.soilRaw);
    }
    if (typeof payload.flameDetected === 'number' && Number.isFinite(payload.flameDetected)) {
      setFlameDetected(payload.flameDetected);
    } else {
      setFlameDetected(null);
    }
    if (typeof payload.flameRaw === 'number' && Number.isFinite(payload.flameRaw)) {
      setFlameRaw(Math.round(payload.flameRaw));
    } else {
      setFlameRaw(null);
    }
    if (typeof payload.motorDriver === 'string' && payload.motorDriver.trim() !== '') {
      setMotorDriverInfo(payload.motorDriver.trim());
    }
    if (typeof payload.uptimeSeconds === 'number' && Number.isFinite(payload.uptimeSeconds)) {
      setGatewayUptimeSeconds(payload.uptimeSeconds);
    }
    if (typeof payload.limitLeft === 'boolean') setLimitLeft(payload.limitLeft);
    if (typeof payload.limitRight === 'boolean') setLimitRight(payload.limitRight);

    if (typeof payload.motorState === 'string') {
      if (payload.motorState === 'LEFT') setMovementStatus('left_command_sent');
      else if (payload.motorState === 'RIGHT') setMovementStatus('right_command_sent');
      else if (payload.motorState === 'STOPPED') setMovementStatus('stop_command_sent');
    }

    // 4-DoF Robot Arm, 5-ch Flame & Onboard Condition Fields
    if (typeof payload.zone === 'number' && Number.isFinite(payload.zone)) setZone(payload.zone);
    if (typeof payload.pumpStatus === 'boolean') setPumpStatus(payload.pumpStatus);
    if (typeof payload.pumpLockout === 'boolean') setPumpLockout(payload.pumpLockout);
    if (Array.isArray(payload.flameChannels)) {
      setFlameChannels(payload.flameChannels);
    } else {
      setFlameChannels(null);
    }
    if (typeof payload.flameDirection === 'string' && payload.flameDirection.trim() !== '') {
      setFlameDirection(payload.flameDirection.trim());
    } else {
      setFlameDirection(null);
    }
    if (typeof payload.flameAngle === 'number' && Number.isFinite(payload.flameAngle)) {
      setFlameAngle(payload.flameAngle);
    } else {
      setFlameAngle(null);
    }
    if (typeof payload.armManualMode === 'boolean') {
      setArmManualMode(payload.armManualMode);
    } else {
      setArmManualMode(null);
    }
    if (Array.isArray(payload.servoAngles)) {
      setServoAngles(payload.servoAngles);
      if (!servoInitializedFromTelemetryRef.current && payload.servoAngles.length >= 4) {
        setManualServoAngles([
          Math.max(0, Math.min(180, Math.round(payload.servoAngles[0]))),
          Math.max(0, Math.min(180, Math.round(payload.servoAngles[1]))),
          Math.max(0, Math.min(180, Math.round(payload.servoAngles[2]))),
          Math.max(0, Math.min(180, Math.round(payload.servoAngles[3]))),
        ]);
        servoInitializedFromTelemetryRef.current = true;
      }
    }
    if (typeof payload.systemState === 'string') setSystemState(payload.systemState);
    if (typeof payload.envCondition === 'string') setEnvCondition(payload.envCondition);
    if (typeof payload.actionCommand === 'string') setActionCommand(payload.actionCommand);
    if (typeof payload.commandLabel === 'string') setCommandLabel(payload.commandLabel);

    // Evaluate Botanical ANN (grenvis_sensor_model.h) directly on genuine onboard DHT22 & Soil readings
    const currentSensors = sensorValuesRef.current;
    const currentTemp = newTemp !== null ? newTemp : currentSensors.temp;
    const currentRh = newRh !== null ? newRh : currentSensors.rh;
    const currentSoil = newSoil !== null ? newSoil : currentSensors.soilMoisture;

    if (currentTemp !== null && currentRh !== null && currentSoil !== null) {
      const floraEval = evaluateFloraSensorModel(currentTemp, currentRh, currentSoil);
      if (floraEval) {
        const bmkgNow = bmkgStepRef.current;
        const genuinePoint: TelemetryHistoryPoint = {
          timestamp: new Date().toISOString(),
          temperature: currentTemp,
          humidity: currentRh,
          soil_moisture: currentSoil,
          bmkg_wind: bmkgNow?.windSpeedKmh ?? null,
          bmkg_rain: bmkgNow?.precipitationMm ?? null,
          sensor_risk: floraEval.sensorRisk,
          sensor_confidence: floraEval.sensorConfidence,
          vision_prediction: typeof payload.visionPrediction === 'string' ? payload.visionPrediction : 'SAFE',
        };
        setHistory((prev) => [...prev.slice(-49), genuinePoint]);
      }
    }

    if (payload.visionPrediction) {
      setEdgePrediction(payload.visionPrediction);
      setEdgeConfidence(payload.visionConfidence);
    }

    if (payload.imageReady === true) {
      fetchGatewayFrameRef.current(false);
    }
  }, []);

  // Subscribe to read-only Backend Gateway Server-Sent Events (/api/telemetry/stream) when available
  useEffect(() => {
    const unsubscribe = subscribeGatewayTelemetry({
      onTelemetry: (payload: GatewayTelemetryPayload) => {
        hadSseTelemetryRef.current = true;
        applyTelemetryPayload(payload);
      },
      onStatusChange: (status) => {
        setGatewayStatus(status);
        if ((status === 'error' || status === 'closed') && hadSseTelemetryRef.current && mqttWssStatusRef.current !== 'connected') {
          resetTelemetryState();
        }
      },
      onError: () => {
        setGatewayStatus('error');
        if (hadSseTelemetryRef.current && mqttWssStatusRef.current !== 'connected') {
          resetTelemetryState();
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [applyTelemetryPayload, resetTelemetryState]);

  const startMqttWssConnection = useCallback(
    (host: string, username: string, password: string, silent = false) => {
      const cleanHost = host.trim();
      const cleanUser = username.trim();
      if (!cleanHost || !cleanUser || !password) {
        if (!silent) {
          setMqttWssError('Masukkan Host EMQX, Username, dan Password terlebih dahulu.');
          showToast('Kredensial MQTT WSS belum lengkap.');
        }
        return;
      }

      setMqttWssStatus('connecting');
      setMqttWssError(null);
      mqttWssRef.current?.disconnect();

      const client = new MqttWssClient({
        host: cleanHost,
        port: emqxWssDefaults.port,
        username: cleanUser,
        password,
        telemetryTopics: emqxWssDefaults.telemetryTopics,
        onConnect: () => {
          setMqttWssStatus('connected');
          setMqttWssError(null);
          if (!silent) {
            showToast(`Terhubung ke EMQX WSS (${cleanHost}:${emqxWssDefaults.port})`);
          }
        },
        onMessage: (_topic, payloadStr) => {
          try {
            const parsedRaw = JSON.parse(payloadStr);
            if (parsedRaw && typeof parsedRaw === 'object') {
              const normalized = parseGatewayTelemetry({
                ...(parsedRaw as Record<string, unknown>),
                freshness: 'FRESH',
                timestamp: Date.now(),
              });
              if (normalized) {
                applyTelemetryPayload(normalized);
              }
            }
          } catch {
            // ignore malformed telemetry
          }
        },
        onError: (errMsg) => {
          setMqttWssStatus('error');
          setMqttWssError(errMsg);
          setActuatorArmed(false);
          if (!silent) {
            showToast(errMsg);
          }
        },
        onClose: () => {
          setMqttWssStatus('disconnected');
          setActuatorArmed(false);
        },
      });

      mqttWssRef.current = client;
      client.connect();
    },
    [emqxWssDefaults.port, emqxWssDefaults.telemetryTopics, applyTelemetryPayload, showToast]
  );

  // Auto-connect read-only EMQX WSS telemetry stream on mount (essential on Vercel/static deploy)
  useEffect(() => {
    startMqttWssConnection(mqttHostInput, mqttUserInput, mqttPassInput, true);
    return () => {
      mqttWssRef.current?.disconnect();
    };
    // Intentionally connect once on mount using initial defaults while keeping actuators Fail-Closed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectMqttWss = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      try {
        if (typeof sessionStorage !== 'undefined' && mqttUserInput.trim()) {
          sessionStorage.setItem('agrapatha_mqtt_user', mqttUserInput.trim());
        }
      } catch {
        // ignore
      }
      startMqttWssConnection(mqttHostInput, mqttUserInput, mqttPassInput, false);
    },
    [mqttHostInput, mqttUserInput, mqttPassInput, startMqttWssConnection]
  );

  const handleDisconnectMqttWss = useCallback(() => {
    mqttWssRef.current?.disconnect();
    mqttWssRef.current = null;
    setMqttWssStatus('disconnected');
    setActuatorArmed(false);
    setMqttWssError(null);
    if (gatewayStatus !== 'connected') {
      resetTelemetryState();
    }
    showToast('Koneksi EMQX WSS diputus.');
  }, [gatewayStatus, resetTelemetryState, showToast]);

  // Periodic Telemetry Freshness Watchdog (10s threshold) (F-02 fix)
  useEffect(() => {
    const timer = setInterval(() => {
      const lastTime = lastTelemetryTimestampRef.current;
      if (!lastTime) return;
      const age = Date.now() - lastTime;
      if (age > 10000) {
        setIsTelemetryStale((prev) => (prev ? prev : true));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Periodic Gateway Health Check (/health) (F-03 fix)
  useEffect(() => {
    let active = true;
    let abortController: AbortController | null = null;

    const performHealthCheck = async () => {
      abortController?.abort();
      abortController = new AbortController();

      try {
        const health = await checkGatewayHealth({ signal: abortController.signal });
        if (active) {
          setGatewayHealth(health);
          if (typeof health.uptimeSeconds === 'number') {
            setGatewayUptimeSeconds(health.uptimeSeconds);
          }
        }
      } catch (err: unknown) {
        if (active) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setGatewayHealth((prev) => (prev ? { ...prev, mqttConnected: false } : null));
        }
      }
    };

    performHealthCheck();
    const interval = setInterval(performHealthCheck, 15000);

    return () => {
      active = false;
      abortController?.abort();
      clearInterval(interval);
    };
  }, []);

  // Close mobile drawer on Escape key press for keyboard accessibility (WCAG 2.1)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Real-time C Header AI Model: grenvis_sensor_model.h (FLORA Botanical Neural Network)
  // Evaluated ONLY when genuine live telemetry is actively connected, fresh, and complete
  const floraResult = useMemo(
    () => {
      if (!isLiveTelemetry || isTelemetryStale) return null;
      if (temp === null || rh === null || soilMoisture === null) return null;
      return evaluateFloraSensorModel(temp, rh, soilMoisture);
    },
    [isLiveTelemetry, isTelemetryStale, temp, rh, soilMoisture]
  );

  // Live directional origin of fire across 5-channel flame array (GPIO 25..33)
  const flameInfo = useMemo(
    () =>
      analyzeFlameDirection(
        flameChannels,
        flameDetected,
        flameDirection,
        flameAngle,
        isLiveTelemetry && !isTelemetryStale
      ),
    [flameChannels, flameDetected, flameDirection, flameAngle, isLiveTelemetry, isTelemetryStale]
  );

  // Real-time Correlation between Onboard Physical Sensors and BMKG Sawah Besar (Jakarta Pusat)
  const bmkgCorrelation = useMemo(
    () =>
      evaluateBmkgSensorCorrelation({
        localTemp: isLiveTelemetry && !isTelemetryStale ? temp : null,
        localRh: isLiveTelemetry && !isTelemetryStale ? rh : null,
        localSoil: isLiveTelemetry && !isTelemetryStale ? soilMoisture : null,
        flameDetected: isLiveTelemetry && !isTelemetryStale ? flameDetected : null,
        flameChannels: isLiveTelemetry && !isTelemetryStale ? flameChannels : null,
        flameDirection: isLiveTelemetry && !isTelemetryStale ? flameDirection : null,
        visionPrediction,
        bmkgForecast: bmkgState?.forecast ?? null,
        bmkgAlerts,
      }),
    [isLiveTelemetry, isTelemetryStale, temp, rh, soilMoisture, flameDetected, flameChannels, flameDirection, visionPrediction, bmkgState, bmkgAlerts]
  );

  // Historical telemetry buffer initialized empty (populated solely by genuine telemetry)
  const [history, setHistory] = useState<TelemetryHistoryPoint[]>([]);

  // Push new point into history when genuine inference or telemetry arrives
  const appendSnapshotToHistory = useCallback(
    (
      tVal = temp,
      rhVal = rh,
      soilVal = soilMoisture,
      visPred = visionPrediction
    ) => {
      if (!isLiveTelemetry || isTelemetryStale) return;
      if (tVal === null || rhVal === null || soilVal === null) {
        return;
      }
      const res = evaluateFloraSensorModel(tVal, rhVal, soilVal);
      if (!res) return;
      const pt: TelemetryHistoryPoint = {
        timestamp: new Date().toISOString(),
        temperature: tVal,
        humidity: rhVal,
        soil_moisture: soilVal,
        bmkg_wind: bmkgStep?.windSpeedKmh ?? null,
        bmkg_rain: bmkgStep?.precipitationMm ?? null,
        sensor_risk: res.sensorRisk,
        sensor_confidence: res.sensorConfidence,
        vision_prediction: typeof visPred === 'string' ? visPred : 'Healthy Forest Canopy',
      };
      setHistory((prev) => [...prev.slice(-49), pt]);
    },
    [isLiveTelemetry, isTelemetryStale, temp, rh, soilMoisture, visionPrediction, bmkgStep]
  );

  // Scroll spy for sidebar with requestAnimationFrame throttling to eliminate layout thrashing
  useEffect(() => {
    let ticking = false;
    let rafId = 0;
    const onScroll = () => {
      if (!ticking) {
        rafId = window.requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > 0);
          if (window.scrollY < 80) {
            setActiveSection((prev) => (prev !== SECTION_IDS[0] ? SECTION_IDS[0] : prev));
          } else {
            let current = SECTION_IDS[0] as string;
            for (const id of SECTION_IDS) {
              const el = document.getElementById(id);
              if (el && el.getBoundingClientRect().top <= 160) {
                current = id;
              }
            }
            setActiveSection((prev) => (prev !== current ? current : prev));
          }
          ticking = false;
          rafId = 0;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      ticking = false;
    };
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    setMobileMenuOpen(false);

    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return true;
      }
      return false;
    };

    if (tryScroll()) return;

    // If element is not rendered in current tab (e.g. filtered view), return to overview and poll
    if (currentTab !== 'overview' && currentTab !== 'all') {
      setCurrentTab('overview');
    }

    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      if (tryScroll() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 40);
  };

  // Phase 2B.2: Stop active camera stream and abort pending inference strictly on unmount
  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (activeInferenceAbortRef.current) {
        activeInferenceAbortRef.current.abort();
        activeInferenceAbortRef.current = null;
      }
    };
  }, []);

  // Phase 2B.2: Revoke preview object URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Phase 2B.2: Synchronize stream attachment when cameraStatus transitions to 'streaming'
  useEffect(() => {
    if (cameraStatus === 'streaming' && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      }
      video.muted = true;
      video.play().catch((playErr: unknown) => {
        if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
        const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
        setInferenceError(`Gagal memutar preview kamera: ${msg}`);
      });
    }
  }, [cameraStatus]);

  // Phase 2B.2: Callback ref to attach stream immediately as soon as the <video> element mounts in DOM
  const setVideoElement = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.muted = true;
      node.play().catch((playErr: unknown) => {
        if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
        const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
        setInferenceError(`Gagal memutar preview kamera: ${msg}`);
      });
    }
  }, []);

  // Start live device camera stream
  const handleStartCamera = async () => {
    setInferenceError(null);
    setIsVideoReady(false);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setCaptureSource('none');

    if (streamRef.current) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStatus('requesting');

    try {
      const stream = await startCameraStream();
      streamRef.current = stream;
      setCameraStatus('streaming');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch((playErr: unknown) => {
          if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
          const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
          setInferenceError(`Gagal memutar preview kamera: ${msg}`);
        });
      }
    } catch (err: unknown) {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setIsVideoReady(false);
      const isDenied = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'PERMISSION_DENIED';
      setCameraStatus(isDenied ? 'permission_denied' : 'device_error');
      const msg = err instanceof Error ? err.message : 'Gagal membuka kamera perangkat.';
      setInferenceError(msg);
      showToast(msg);
    }
  };

  // Stop camera stream
  const handleStopCamera = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoReady(false);
    setCameraStatus('idle');
  };

  // Capture frame from active video stream
  const handleCaptureFromVideo = async () => {
    if (!videoRef.current || cameraStatus !== 'streaming') return;
    const v = videoRef.current;
    if (!isVideoReady || v.videoWidth <= 0 || v.videoHeight <= 0) {
      showToast('Kamera sedang mempersiapkan frame, harap tunggu sebentar...');
      return;
    }
    try {
      const blob = await captureFrameFromVideo(v);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsVideoReady(false);
      const url = URL.createObjectURL(blob);
      setCapturedBlob(blob);
      setPreviewUrl(url);
      setCaptureSource('camera');
      setCameraStatus('captured');
      setInferenceStatus('idle');
      setInferenceError(null);
      showToast('Frame foto berhasil diambil dari kamera.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil frame foto.';
      setInferenceError(msg);
      showToast(msg);
    }
  };

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    handleStopCamera();
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setInferenceError(validation.error || 'File tidak valid.');
      showToast(validation.error || 'File tidak valid.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const url = URL.createObjectURL(file);
    setCapturedBlob(file);
    setPreviewUrl(url);
    setCaptureSource('upload');
    setCameraStatus('captured');
    setInferenceStatus('idle');
    setInferenceError(null);
    showToast(`Gambar dipilih: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
  };

  // Reset / retake photo
  const handleRetake = () => {
    handleStopCamera();
    setPreviewUrl(null);
    setCapturedBlob(null);
    setCaptureSource('none');
    setCameraStatus('idle');
    setInferenceStatus('idle');
    setInferenceError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Run real wildfire/smoke inference on capturedBlob via be-binus Railway API
  const handleAnalyzeImage = async () => {
    if (!capturedBlob || isCapturing) return;

    setIsCapturing(true);
    setInferenceStatus('analyzing');
    setInferenceError(null);

    const abortController = new AbortController();
    activeInferenceAbortRef.current = abortController;

    const res = await predictWildfireImage(capturedBlob, abortController.signal);
    setIsCapturing(false);
    activeInferenceAbortRef.current = null;

    if (res.success && res.data) {
      setWildfireResult(res.data);
      const labelMap: Record<string, 'Healthy Forest Canopy' | 'Smoke Plume Detected' | 'Active Surface Fire'> = {
        'Non-Fire': 'Healthy Forest Canopy',
        'Smoke': 'Smoke Plume Detected',
        'Fire': 'Active Surface Fire',
      };
      const mappedLabel = labelMap[res.data.predicted_label] || 'Healthy Forest Canopy';
      setVisionPrediction(mappedLabel);
      setVisionProbs({
        healthy: res.data.scores['Non-Fire'] * 100,
        smoke: res.data.scores['Smoke'] * 100,
        fire: res.data.scores['Fire'] * 100,
      });
      const ts = res.data.timestamp || new Date().toISOString();
      setLastCaptureTime(ts);
      appendSnapshotToHistory(temp, rh, soilMoisture, mappedLabel);
      setInferenceStatus('success');
      showToast(`Inferensi MobileNetV2 Sukses: ${res.data.predicted_label} (${res.data.confidence_percentage.toFixed(1)}%)`);
    } else {
      setInferenceStatus('error');
      setInferenceError(res.error || 'Gagal memproses inferensi citra ke be-binus-production.up.railway.app.');
      showToast(res.error || 'Inferensi gagal.');
    }
  };

  // Dispatch two-way executable robot commands to MQTT `agrapatha/commands` (Safety-Gated)
  const dispatchRobotCommand = useCallback(
    (cmdName: string, humanLabel?: string, params?: Record<string, unknown>) => {
      const isEmergencyStop = cmdName === 'CMD_EMERGENCY_STOP';
      if (mqttWssStatus !== 'connected' || !mqttWssRef.current) {
        showToast(
          `Gagal kirim ${cmdName}: Hubungkan EMQX WSS (Port 8084) di panel Kontrol Robot terlebih dahulu (Fail-Closed).`
        );
        return false;
      }
      if (!actuatorArmed && !isEmergencyStop) {
        showToast(
          `Interlock Safety Aktif: Aktifkan toggle "ARM AKTUATOR" untuk mengirim perintah ${cmdName}.`
        );
        return false;
      }

      const payloadJson = JSON.stringify(params ? { cmd: cmdName, params } : { cmd: cmdName });
      const sent = mqttWssRef.current.publish('agrapatha/commands', payloadJson);
      if (sent) {
        setLastCommand(cmdName);
        if (cmdName === 'CMD_SLIDER_LEFT' || cmdName === 'L') setMovementStatus('left_command_sent');
        else if (cmdName === 'CMD_SLIDER_RIGHT' || cmdName === 'R') setMovementStatus('right_command_sent');
        else if (cmdName === 'CMD_SLIDER_STOP' || cmdName === 'S' || isEmergencyStop) setMovementStatus('stop_command_sent');
        else if (cmdName === 'CMD_TRIGGER_CAPTURE' || cmdName === 'C') setMovementStatus('capture_command_sent');
        showToast(`Perintah Terkirim: ${humanLabel || cmdName}`);
        return true;
      }
      showToast('Gagal mengirim payload ke broker EMQX.');
      return false;
    },
    [mqttWssStatus, actuatorArmed, showToast]
  );

  // Legacy short-char wrapper mapped cleanly to Robot Arm & Slider command dispatcher
  const handleRailCommand = (cmd: 'L' | 'R' | 'S' | 'C') => {
    const cmdMap: Record<'L' | 'R' | 'S' | 'C', string> = {
      L: 'CMD_SLIDER_LEFT',
      R: 'CMD_SLIDER_RIGHT',
      S: 'CMD_SLIDER_STOP',
      C: 'CMD_TRIGGER_CAPTURE',
    };
    dispatchRobotCommand(cmdMap[cmd]);
  };

  // Manual 4-DoF Arm Servo Degree Dispatcher (0..180 deg)
  const SERVO_JOINT_SPECS = useMemo(
    () => [
      { idx: 0 as const, key: 'base' as const, label: 'Base J1 (Yaw)', gpio: 13, min: 0, max: 180, defaultDeg: 90, desc: 'Putaran Kiri (30°) ↔ Kanan (150°)' },
      { idx: 1 as const, key: 'shoulder' as const, label: 'Shoulder J2', gpio: 14, min: 0, max: 180, defaultDeg: 45, desc: 'Elevasi Bahu Lengan (0°–180°)' },
      { idx: 2 as const, key: 'elbow' as const, label: 'Elbow J3', gpio: 15, min: 0, max: 180, defaultDeg: 45, desc: 'Jangkauan Siku Lengan (0°–180°)' },
      { idx: 3 as const, key: 'nozzle' as const, label: 'Nozzle J4', gpio: 5, min: 0, max: 180, defaultDeg: 90, desc: 'Sudut Nozzle & Kamera (0°–180°)' },
    ],
    []
  );

  const handleSetAllServoAngles = (angles: [number, number, number, number] = manualServoAngles) => {
    const clamped: [number, number, number, number] = [
      Math.max(0, Math.min(180, Math.round(angles[0]))),
      Math.max(0, Math.min(180, Math.round(angles[1]))),
      Math.max(0, Math.min(180, Math.round(angles[2]))),
      Math.max(0, Math.min(180, Math.round(angles[3]))),
    ];
    setManualServoAngles(clamped);
    dispatchRobotCommand(
      'CMD_SET_SERVO',
      `Set Arm Manual (${clamped[0]}°/${clamped[1]}°/${clamped[2]}°/${clamped[3]}°)`,
      {
        base: clamped[0],
        shoulder: clamped[1],
        elbow: clamped[2],
        nozzle: clamped[3],
      }
    );
  };

  const handleSetSingleServoAngle = (jointIdx: 0 | 1 | 2 | 3, targetDeg: number) => {
    const clampedDeg = Math.max(0, Math.min(180, Math.round(targetDeg)));
    const spec = SERVO_JOINT_SPECS[jointIdx];
    const nextTuple: [number, number, number, number] = [...manualServoAngles] as [number, number, number, number];
    nextTuple[jointIdx] = clampedDeg;
    setManualServoAngles(nextTuple);
    dispatchRobotCommand(
      'CMD_SET_SERVO',
      `Set ${spec.label} -> ${clampedDeg}°`,
      { [spec.key]: clampedDeg }
    );
  };

  // Record manual watering / suppression
  const handleRecordWatering = () => {
    const newEvt: WateringLogEvent = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      soilBefore: typeof soilMoisture === 'number' ? soilMoisture : 0,
      note: 'Penyiraman manual & pendinginan zona kanopi tercatat dari konsol',
    };
    setWateringEvents((prev) => [newEvt, ...prev.slice(0, 8)]);
    showToast('Penyiraman dicatat — Log pemeliharaan diperbarui');
  };

  // Dynamic Alert Banner Config
  const alertBanner = useMemo(() => {
    if (!isLiveTelemetry || isTelemetryStale) {
      return {
        severity: 'STANDBY',
        title: isTelemetryStale
          ? 'Device Offline · Telemetri Stale'
          : mqttWssStatus === 'connected'
            ? 'EMQX WSS :8084 Terhubung · BMKG Sawah Besar Aktif'
            : 'Menghubungkan Stream EMQX WSS (:8084) · BMKG Sawah Besar Aktif',
        description:
          mqttWssStatus === 'connected'
            ? `Koneksi broker EMQX Serverless (:8084) aktif. Data sensor DHT22/Soil/Flame akan tampil otomatis saat ESP32 mengirim payload; cuaca Sawah Besar (${bmkgStep ? `${bmkgStep.temperatureC}°C, ${bmkgStep.weatherDesc}` : 'menyinkron'}) terhubung.`
            : 'Menghubungkan stream telemetri via EMQX WSS (:8084). Status sensor fisik ditahan standby hingga paket ESP32 diterima.',
        wrapper: 'bg-[#F2F8F5] border-[#CFE2D9] text-[#102A24]',
        badge: 'bg-sky-50 text-sky-800 border border-sky-200',
        btn: 'bg-[#0F766E] text-white hover:bg-[#0D5D57]',
        actionText: 'Cek Koneksi & Kontrol',
        actionTarget: 'device-control',
      };
    }

    if (envCondition === 'KEBAKARAN' || flameInfo.isFireActive || (typeof flameDetected === 'number' && flameDetected > 0)) {
      return {
        severity: 'KEBAKARAN',
        title: `Peringatan Darurat KEBAKARAN — ${flameInfo.isFireActive ? flameInfo.sectorSummary : 'Vision FIRE'}`,
        description: `${flameInfo.isFireActive ? `${flameInfo.detailLabel} · ` : ''}${commandLabel || actionCommand || 'Pemadaman aktif'} · Suhu DHT22 ${typeof temp === 'number' ? temp.toFixed(1) : '--'}°C · Zona ${zone ?? '--'} · Angin BMKG ${bmkgStep ? `${bmkgStep.windSpeedKmh} km/h` : '--'}.`,
        wrapper: 'bg-rose-50 border-rose-300 text-rose-900',
        badge: 'bg-rose-600 text-white',
        btn: 'bg-rose-600 text-white hover:bg-rose-700',
        actionText: 'Kontrol Manual Arm & Rel',
        actionTarget: 'device-control',
      };
    }

    if (envCondition === 'ASAP_VISUAL' || envCondition === 'FAULT' || envCondition === 'KERING' || envCondition === 'BASAH') {
      return {
        severity: envCondition,
        title: `Perhatian Kondisi Lapangan: ${envCondition} (${systemState || 'ESP32-MAIN'})`,
        description: `${commandLabel ? `${commandLabel} · ` : ''}Suhu ${typeof temp === 'number' ? temp.toFixed(1) : '--'}°C · RH ${typeof rh === 'number' ? rh.toFixed(0) : '--'}% · Soil ${typeof soilMoisture === 'number' ? soilMoisture.toFixed(1) : '--'}% · BMKG Hujan ${bmkgStep?.precipitationMm ?? 0} mm`,
        wrapper: 'bg-amber-50 border-amber-300 text-amber-950',
        badge: 'bg-amber-500 text-white',
        btn: 'bg-amber-600 text-white hover:bg-amber-700',
        actionText: 'Lihat Notifikasi Kondisi',
        actionTarget: 'treatment',
      };
    }

    if (floraResult?.sensorRisk === 'High' || bmkgCorrelation.severity === 'WARNING') {
      return {
        severity: 'WARNING',
        title: bmkgCorrelation.hasJakartaAlert
          ? 'Waspada Cuaca BMKG Sawah Besar & Mikroklimat Kanopi'
          : `Waspada Risiko Botani Tinggi (ANN: ${floraResult?.sensorConfidence.toFixed(1) ?? '--'}%)`,
        description: bmkgCorrelation.advisory,
        wrapper: 'bg-amber-50 border-amber-300 text-amber-950',
        badge: 'bg-amber-500 text-white',
        btn: 'bg-amber-600 text-white hover:bg-amber-700',
        actionText: 'Cek Korelasi BMKG',
        actionTarget: 'bmkg',
      };
    }

    return {
      severity: 'NORMAL',
      title: `Sistem & Mikroklimat Optimal (${floraResult ? `ANN ${floraResult.sensorRisk}: ${floraResult.sensorConfidence.toFixed(1)}%` : systemState || 'LIVE'})`,
      description: `DHT22 ${typeof temp === 'number' ? temp.toFixed(1) : '--'}°C / ${typeof rh === 'number' ? rh.toFixed(0) : '--'}% · Soil ${typeof soilMoisture === 'number' ? soilMoisture.toFixed(1) : '--'}% · Flame CLEAR · BMKG Sawah Besar: ${bmkgStep ? `${bmkgStep.weatherDesc} (${bmkgStep.temperatureC}°C)` : 'Terhubung'}`,
      wrapper: 'bg-emerald-50/80 border-emerald-200 text-[#102A24]',
      badge: 'bg-emerald-600 text-white',
      btn: 'bg-[#0F766E] text-white hover:bg-[#0D5D57]',
      actionText: 'Lihat Telemetri',
      actionTarget: 'monitoring',
    };
  }, [isLiveTelemetry, isTelemetryStale, mqttWssStatus, envCondition, systemState, flameDetected, flameInfo, commandLabel, actionCommand, zone, floraResult, soilMoisture, temp, rh, bmkgStep, bmkgCorrelation]);

  const navItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview Status', badge: floraResult ? floraResult.sensorRisk.toUpperCase() : undefined },
      { id: 'monitoring', label: 'Live Sensors & BMKG' },
      { id: 'bmkg', label: 'BMKG Sawah Besar (CAP)', badge: bmkgAlerts.length > 0 ? 'CAP' : undefined },
      { id: 'analysis', label: 'Botanical ANN & Vision' },
      { id: 'benchmarks', label: 'Active Model Specs' },
      { id: 'cameraCapture', label: 'ESP32-CAM Vision' },
      { id: 'device-control', label: 'Kontrol Manual Arm & L298N' },
      { id: 'treatment', label: 'Notifikasi Kondisi Lapangan' },
      { id: 'history', label: 'Historical Trends' },
      { id: 'devices', label: 'Hardware Topology' },
    ],
    [floraResult, bmkgAlerts.length]
  );

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full p-4 select-none">
      {/* Brand Box */}
      <div className="flex items-center justify-between pb-3.5 mb-3 border-b border-emerald-400/20 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shadow-xs shrink-0 p-1 overflow-hidden">
            <img
              src="/agrapatha-logo.png"
              alt="Logo AGRAPATHA"
              className="w-full h-full object-contain drop-shadow-sm"
            />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-extrabold text-white tracking-wide uppercase block font-display truncate">
              AGRAPATHA
            </span>
            <span className="text-[11px] text-emerald-200/90 block truncate font-medium">
              Smart Forest &amp; Robotics
            </span>
          </div>
        </div>
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="text-emerald-100 hover:text-white hover:bg-white/10 w-9 h-9 flex items-center justify-center rounded-lg text-base shrink-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300"
            aria-label="Tutup navigasi"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      {/* Middle Scrollable Section */}
      <div className="flex-1 overflow-y-auto min-h-0 flora-sidebar-scroll pr-1 space-y-5">
        {/* Primary Dashboards & Models */}
        <nav aria-label="Primary Dashboards &amp; Models" className="space-y-1.5">
          <span className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-emerald-200/80 block mb-2">
            Views &amp; AI Models
          </span>

          {/* Dashboard 1 with Collapsible Sub-Menus */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setIsDashboard1Open((prev) => !prev);
                if (!isDashboard1Open && currentTab === 'all') {
                  setCurrentTab('overview');
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${isDashboard1Active
                  ? 'bg-emerald-500/20 text-white shadow-xs border-emerald-400/45'
                  : 'text-emerald-100/90 border-transparent hover:bg-white/10 hover:text-white'
                }`}
              aria-expanded={isDashboard1Open}
              aria-label="Toggle Dashboard 1 Sub Menu"
            >
              <span className="flex items-center gap-2 truncate">
                <LayoutGrid size={15} className="shrink-0 text-amber-300" />
                <span className="truncate">Dashboard 1</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-amber-300 text-[#0D2E27] font-mono">
                  3-MODEL
                </span>
                <ChevronDown
                  size={14}
                  className={`text-emerald-200 transition-transform duration-200 ${isDashboard1Open ? 'rotate-0' : '-rotate-90'
                    }`}
                />
              </div>
            </button>

            {/* Sub Menu Items: Overview, Model 1, Model 2, Model 3 */}
            {isDashboard1Open && (
              <div className="ml-3 pl-2.5 border-l-2 border-emerald-400/30 space-y-1 pt-1 pb-1 transition-all">
                {/* Sub Menu 0: Overview */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('overview');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${currentTab === 'overview'
                      ? 'bg-white/15 text-white shadow-xs font-bold border-emerald-300/40'
                      : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    <span className="truncate">Overview</span>
                  </span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-200">
                    ALL
                  </span>
                </button>

                {/* Sub Menu 1: BMKG Sawah Besar */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('bmkg');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${currentTab === 'bmkg'
                      ? 'bg-white/15 text-white shadow-xs font-bold border-l-2 border-l-sky-400 border-y-emerald-300/30 border-r-emerald-300/30'
                      : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <CloudRain size={14} className="shrink-0 text-sky-300" />
                    <span className="truncate">BMKG Sawah Besar</span>
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-sky-500 text-white">
                    {bmkgStep ? `${bmkgStep.temperatureC}°C` : 'API/CAP'}
                  </span>
                </button>

                {/* Sub Menu 2: Model 2 Botanical */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('model_botanical');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${currentTab === 'model_botanical'
                      ? 'bg-white/15 text-white shadow-xs font-bold border-l-2 border-l-emerald-400 border-y-emerald-300/30 border-r-emerald-300/30'
                      : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Leaf size={14} className="shrink-0 text-emerald-300" />
                    <span className="truncate">Model 2: Botanical</span>
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-emerald-950/70 text-emerald-200">
                    {floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                  </span>
                </button>

                {/* Sub Menu 3: Model 3 Computer Vision */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTab('model_vision');
                    if (isMobile) setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${currentTab === 'model_vision'
                      ? 'bg-white/15 text-white shadow-xs font-bold border-l-2 border-l-sky-400 border-y-emerald-300/30 border-r-emerald-300/30'
                      : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Camera size={14} className="shrink-0 text-sky-300" />
                    <span className="truncate">Model 3: Vision</span>
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-sky-500/80 text-white">
                    AI.OPT
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setCurrentTab('all');
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${currentTab === 'all'
                ? 'bg-amber-300 text-[#0D2E27] shadow-xs border-amber-200 font-bold'
                : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
              }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Layers size={14} className="shrink-0" />
              <span className="truncate">All Views (Combined)</span>
            </span>
          </button>
        </nav>

        {/* Navigation Links */}
        <nav aria-label="Console Sections" className="space-y-1 pt-3 border-t border-emerald-400/20">
          <span className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-emerald-200/80 block mb-2">
            Section Quick Links
          </span>
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  scrollToSection(item.id);
                  if (isMobile) setMobileMenuOpen(false);
                }}
                aria-current={isActive ? 'location' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 border ${isActive
                    ? 'bg-emerald-500/20 text-white shadow-xs font-bold border-emerald-400/45'
                    : 'text-emerald-100/85 border-transparent hover:bg-white/10 hover:text-white'
                  }`}
              >
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ml-1.5 ${isActive ? 'bg-amber-300 text-[#0D2E27]' : 'bg-emerald-950/70 text-emerald-200'
                      }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom System Channel Status */}
      <div className="bg-white/10 p-3 rounded-xl border border-emerald-400/25 flex items-center gap-2.5 mt-3 shrink-0">
        <span className="w-2 h-2 rounded-full shrink-0 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" />
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] text-emerald-200/85 font-semibold uppercase tracking-wider truncate">
            AI &amp; Meteorology Stack
          </span>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <span className="block text-xs font-bold text-white uppercase tracking-wider truncate">
              LIVE · ANN + BMKG
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-amber-300 text-[#0D2E27] font-mono shrink-0">
              CAP ID/EN
            </span>
          </div>
          <span className="block text-[11px] text-emerald-200/80 truncate mt-0.5">
            grenvis_sensor + Sawah Besar
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#ECF4F0] via-[#F4FAF7] to-[#E6F1F4] text-[#102A24] flex flex-col font-sans">
      {/* 3D Boot Splash Screen */}
      {viewMode === 'boot' && <FloraSplash onComplete={() => setViewMode('dashboard')} />}

      {/* TOP NAVIGATION BAR (Deep Botanical Emerald · Anti-Collision Grid Layout) */}
      <header className={`sticky top-0 z-40 w-full border-b transition-all duration-300 select-none animate-navbar-slide-down ${isScrolled
          ? 'bg-[#0D2E27]/95 backdrop-blur-xl border-emerald-400/25 shadow-[0_10px_28px_-8px_rgba(13,46,39,0.45)]'
          : 'bg-gradient-to-r from-[#0D2E27] via-[#134237] to-[#0E484D] border-emerald-400/20 shadow-md'
        }`}>
        {/* Top Accent Strip */}
        <div className="h-[3px] w-full animate-nav-shimmer shadow-[0_1px_10px_rgba(52,211,153,0.5)] shrink-0" />

        {/* Single Clean Row with Balanced Zones & Zero Overlap */}
        <div className="w-full max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-8 py-2.5">
          <div className="flex items-center justify-between gap-3">
            {/* Zone 1 (Left): Mobile Toggle & Brand Identity */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 shrink-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden text-emerald-100 hover:text-white w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 border border-white/15 text-base shrink-0 cursor-pointer hover:bg-white/15 active:scale-95 transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300"
                aria-label="Buka menu navigasi"
                aria-expanded={mobileMenuOpen}
              >
                <span aria-hidden="true">☰</span>
              </button>

              <button
                type="button"
                className="flex items-center gap-2.5 group cursor-pointer text-left min-w-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300 rounded-xl pr-1"
                onClick={() => scrollToSection('overview')}
                title="Kembali ke Ringkasan AGRAPATHA"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shadow-xs shrink-0 transition-transform duration-200 group-hover:scale-105 p-1 overflow-hidden">
                  <img
                    src="/agrapatha-logo.png"
                    alt="Logo AGRAPATHA"
                    className="w-full h-full object-contain drop-shadow-sm"
                  />
                </div>
                <div className="min-w-0 leading-tight">
                  <span className="text-sm sm:text-[15px] font-extrabold text-white tracking-wider uppercase block font-display whitespace-nowrap transition-colors duration-200 group-hover:text-emerald-200">
                    AGRAPATHA
                  </span>
                  <span className="hidden xl:block text-[11px] text-emerald-200/85 font-medium whitespace-nowrap">
                    Smart Forest Robotics &amp; AI
                  </span>
                </div>
              </button>
            </div>

            {/* Zone 2 (Center): Navigation Capsule (Desktop >= lg) */}
            <nav aria-label="Navigasi Utama Dashboard" className="hidden lg:flex items-center shrink-0">
              <NavigationMenu>
                <NavigationMenuList className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.08] border border-white/[0.14] shadow-inner">
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className="h-9 px-3.5 py-1.5 rounded-xl text-[13px] font-semibold transition-all duration-150 cursor-pointer border bg-transparent text-emerald-50 border-transparent hover:bg-white hover:text-[#0D2E27] focus:bg-white focus:text-[#0D2E27] data-[active]:bg-white data-[active]:text-[#0D2E27] data-[state=open]:bg-white data-[state=open]:text-[#0D2E27]"
                    >
                      <LayoutGrid size={15} className="shrink-0 mr-1.5 text-amber-300 group-data-[state=open]:text-emerald-700" />
                      <span className="whitespace-nowrap">Dashboard Views</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase font-mono ml-2 bg-amber-300 text-[#0D2E27]">
                        {currentTab === 'bmkg'
                          ? 'BMKG'
                          : currentTab === 'model_botanical'
                            ? 'BOTANICAL'
                            : currentTab === 'model_vision'
                              ? 'VISION'
                              : 'FULL SUITE'}
                      </span>
                    </NavigationMenuTrigger>

                    <NavigationMenuContent className="p-2.5 w-68 space-y-1">
                      {/* Sub Menu 0: Overview */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('overview')}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left border ${currentTab === 'overview'
                              ? 'bg-emerald-50 text-[#0D2E27] shadow-xs font-bold border-emerald-300'
                              : 'text-[#102A24]/85 border-transparent hover:bg-[#F2F8F5] hover:text-[#0D2E27]'
                            }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
                            <span className="truncate">Overview (Ringkasan)</span>
                          </span>
                          <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            ALL
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 1: BMKG Sawah Besar */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('bmkg')}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left border ${currentTab === 'bmkg'
                              ? 'bg-sky-50 text-[#0D2E27] shadow-xs font-bold border-sky-300'
                              : 'text-[#102A24]/85 border-transparent hover:bg-[#F2F8F5] hover:text-[#0D2E27]'
                            }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <CloudRain size={14} className="shrink-0 text-sky-600" />
                            <span className="truncate">BMKG Sawah Besar</span>
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-sky-600 text-white">
                            {bmkgStep ? `${bmkgStep.temperatureC}°C` : 'API/CAP'}
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 2: Model 2 Botanical */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('model_botanical')}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left border ${currentTab === 'model_botanical'
                              ? 'bg-emerald-50 text-[#0D2E27] shadow-xs font-bold border-emerald-300'
                              : 'text-[#102A24]/85 border-transparent hover:bg-[#F2F8F5] hover:text-[#0D2E27]'
                            }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Leaf size={14} className="shrink-0 text-emerald-600" />
                            <span className="truncate">Model 2: Botanical</span>
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${floraResult ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                            {floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                          </span>
                        </button>
                      </NavigationMenuLink>

                      {/* Sub Menu 3: Model 3 Computer Vision */}
                      <NavigationMenuLink asChild>
                        <button
                          type="button"
                          onClick={() => setCurrentTab('model_vision')}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left border ${currentTab === 'model_vision'
                              ? 'bg-sky-50 text-[#0D2E27] shadow-xs font-bold border-sky-300'
                              : 'text-[#102A24]/85 border-transparent hover:bg-[#F2F8F5] hover:text-[#0D2E27]'
                            }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Camera size={14} className="shrink-0 text-sky-600" />
                            <span className="truncate">Model 3: Vision AI</span>
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 bg-sky-100 text-sky-800">
                            TFLITE
                          </span>
                        </button>
                      </NavigationMenuLink>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  {/* Quick Jump Menu */}
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className="h-9 px-3.5 py-1.5 rounded-xl text-[13px] font-semibold transition-all duration-150 cursor-pointer border bg-transparent text-emerald-50 border-transparent hover:bg-white hover:text-[#0D2E27] focus:bg-white focus:text-[#0D2E27] data-[active]:bg-white data-[active]:text-[#0D2E27] data-[state=open]:bg-white data-[state=open]:text-[#0D2E27]"
                    >
                      <span className="w-2 h-2 rounded-full mr-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                      <span className="whitespace-nowrap">Seksi Konsol</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase bg-emerald-300 text-[#0D2E27] font-mono ml-2">
                        {navItems.length}
                      </span>
                    </NavigationMenuTrigger>

                    <NavigationMenuContent className="p-3.5 w-[420px] sm:w-[520px] md:w-[580px]">
                      <div className="mb-2.5 px-1.5 pb-2 border-b border-[#CDE0D7] flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#0F766E] flex items-center gap-1.5 font-mono">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Navigasi Cepat Seksi Konsol</span>
                        </span>
                        <span className="text-[11px] text-[#46655D]">
                          Klik untuk lompat langsung
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[360px] overflow-y-auto pr-1 flora-sidebar-scroll">
                        {navItems.map((item) => {
                          const isActive = activeSection === item.id;
                          return (
                            <NavigationMenuLink asChild key={item.id}>
                              <button
                                type="button"
                                onClick={() => scrollToSection(item.id)}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-all cursor-pointer text-left border ${isActive
                                    ? 'bg-emerald-50 text-[#0D2E27] shadow-xs font-bold border-emerald-300'
                                    : 'text-[#102A24]/85 border-transparent hover:bg-[#F2F8F5] hover:text-[#0D2E27]'
                                  }`}
                              >
                                <span className="truncate">{item.label}</span>
                                {item.badge && (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ml-1.5 ${isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-800'
                                      }`}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </button>
                            </NavigationMenuLink>
                          );
                        })}
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </nav>

            {/* Zone 3 (Right): Compact Status Badge + 3D + Clock (Zero Collision) */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Connectivity status */}
              {(() => {
                const effectiveGatewayStatus = mqttWssStatus === 'connected' ? 'connected' : gatewayStatus;
                const effectiveBrokerConnected =
                  mqttWssStatus === 'connected' || (gatewayHealth?.mqttConnected ?? false);
                const deviceConn = getDeviceConnectivityStatus(
                  isLiveTelemetry,
                  isTelemetryStale,
                  effectiveGatewayStatus,
                  effectiveBrokerConnected
                );
                const compactStatusText =
                  isLiveTelemetry && !isTelemetryStale
                    ? 'LIVE'
                    : isTelemetryStale
                      ? 'STALE'
                      : mqttWssStatus === 'connected'
                        ? 'WSS READY'
                        : mqttWssStatus === 'connecting'
                          ? 'CONNECTING'
                          : 'STANDBY';
                return (
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs shadow-xs transition-all duration-200 backdrop-blur-md whitespace-nowrap ${
                      deviceConn.isOnline
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-white'
                        : isTelemetryStale
                          ? 'bg-amber-500/20 border-amber-400/60 text-amber-100'
                          : 'bg-white/10 border-white/15 text-emerald-100'
                    }`}
                    title={`Status Detail: ${deviceConn.text} · Gateway SSE: ${gatewayStatus.toUpperCase()} · EMQX WSS: ${mqttWssStatus.toUpperCase()}`}
                    aria-label="Status Koneksi Telemetri"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${deviceConn.dotClass}`} />
                    <span className="font-bold font-display text-xs uppercase tracking-wider">
                      {compactStatusText}
                    </span>
                    <span className="text-[11px] text-emerald-200/90 font-tabular border-l border-white/20 pl-2 hidden sm:inline-block">
                      {isLiveTelemetry && !isTelemetryStale && lastLiveTelemetryTime
                        ? lastLiveTelemetryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : mqttWssStatus === 'connected'
                          ? 'WSS :8084'
                          : 'SSE'}
                    </span>
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={() => setViewMode('boot')}
                className="group px-3 py-1.5 rounded-xl text-amber-200 hover:bg-amber-400 hover:text-[#0D2E27] border border-amber-300/40 bg-white/10 text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1.5 shadow-xs active:scale-95 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-300 whitespace-nowrap shrink-0"
                title="Buka tampilan 3D Welcome Screen"
                aria-label="Buka kembali tampilan 3D Welcome Screen"
              >
                <span aria-hidden="true" className="transition-transform duration-300 group-hover:rotate-45">✦</span>
                <span className="hidden md:inline">3D View</span>
              </button>

              <LiveClockBadge isGlassy={isScrolled} />
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-screen">
        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <div
            id="mobile-navigation-drawer"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 lg:hidden flex"
            onClick={() => setMobileMenuOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Navigasi AGRAPATHA"
          >
            <div
              className="w-72 h-full bg-gradient-to-b from-[#0D2E27] to-[#134237] border-r border-emerald-400/25 shadow-2xl flex flex-col z-50"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarContent(true)}
            </div>
          </div>
        )}

        {/* Main Console Workspace */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 xl:p-8 max-w-[1620px] mx-auto w-full overflow-x-clip">
          {/* Top Console Header Banner */}
          <div
            ref={headerRef}
            className="rounded-2xl border border-emerald-400/30 bg-gradient-to-r from-[#0D2E27] via-[#134E4A] to-[#0E6B74] p-5 sm:p-6 mb-5 shadow-[0_12px_32px_-8px_rgba(13,46,39,0.3)] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden"
          >
            {/* Decorative Ambient Orbs */}
            <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-emerald-400/15 blur-2xl pointer-events-none" />
            <div className="absolute left-1/3 -bottom-16 w-64 h-40 rounded-full bg-sky-400/10 blur-2xl pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-[3px] animate-nav-shimmer z-10" />

            <div className="min-w-0 relative z-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-bold tracking-wide text-emerald-200 uppercase font-mono">
                  <img src="/agrapatha-logo.png" alt="Logo AGRAPATHA" className="w-4 h-4 object-contain shrink-0" />
                  <span>AGRAPATHA · Intelligence Console</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/20 border border-amber-300/40 text-xs font-semibold text-amber-100">
                  EMQX WSS :8084 + BMKG Sawah Besar + Railway AI
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl lg:text-[26px] font-extrabold text-white mt-2.5 tracking-tight font-display">
                Botanical, Fire Vision &amp; BMKG Sawah Besar Monitor
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100/90 mt-1.5 leading-relaxed max-w-3xl">
                Monitoring telemetri sensor real-time (DHT22, Soil v1.2, Flame 5-Ch), inferensi Edge{' '}
                <code className="font-mono text-emerald-200 px-1.5 py-0.5 rounded bg-black/25 border border-white/15">
                  grenvis_sensor_model.h
                </code>
                , prakiraan cuaca &amp; peringatan CAP{' '}
                <code className="font-mono text-amber-200 px-1.5 py-0.5 rounded bg-black/25 border border-white/15">
                  BMKG Sawah Besar
                </code>
                , serta kendali lengan robot 4-DoF.
              </p>
            </div>
          </div>

          {/* Realtime Status Alert Banner */}
          <div className="mb-6">
            <aside
              aria-label="Realtime Forest Status Alert"
              className={`p-3.5 sm:p-4 rounded-xl border transition-all duration-300 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${alertBanner.wrapper}`}
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="mt-0.5 sm:mt-0">
                  <svg
                    className="w-4 h-4 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs sm:text-sm tracking-tight font-display">
                      {alertBanner.title}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${alertBanner.badge}`}
                    >
                      {alertBanner.severity}
                    </span>
                  </div>
                  <p className="text-xs opacity-90 mt-0.5 leading-snug">{alertBanner.description}</p>
                </div>
              </div>
              <button
                onClick={() => scrollToSection(alertBanner.actionTarget)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 self-end sm:self-auto cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-current ${alertBanner.btn}`}
                aria-label={`${alertBanner.actionText}: Menuju seksi ${alertBanner.actionTarget}`}
              >
                <span>{alertBanner.actionText}</span>
                <span className="text-[11px]">→</span>
              </button>
            </aside>
          </div>

          <div className="space-y-8 sm:space-y-10">
            {/* THREE-SUBSYSTEM SUMMARIES (BMKG SAWAH BESAR + BOTANICAL ANN + VISION TFLITE) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Summary 1: BMKG Sawah Besar & CAP Nowcast */}
                <div className="agra-card border-t-[3px] border-t-sky-500 p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2.5 gap-2">
                      <span className="text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-200 px-2.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1.5">
                        <CloudRain size={13} className="text-sky-600" />
                        <span>BMKG · Sawah Besar</span>
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${bmkgCorrelation.hasJakartaAlert
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : bmkgStep
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                      >
                        {bmkgCorrelation.hasJakartaAlert ? 'CAP ALERT AKTIF' : bmkgStep ? 'TERHUBUNG' : 'MEMUAT'}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-bold text-[#102A24] font-display">
                      Cuaca &amp; CAP (<code className="text-xs font-mono text-sky-700">{bmkgState?.selectedRegion.desa || 'Sawah Besar'}</code>)
                    </h3>
                    <p className="text-xs text-[#46655D] mt-1.5 leading-relaxed">
                      {bmkgStep
                        ? `${bmkgStep.temperatureC}°C · RH ${bmkgStep.humidityPercent}% · Angin ${bmkgStep.windSpeedKmh} km/h · ${bmkgStep.weatherDesc}`
                        : 'Menghubungkan prakiraan adm4 Kec. Sawah Besar & CAP Nowcast (id/en)...'}
                    </p>

                    <div className="space-y-1.5 mt-3 pt-2.5 border-t border-[#D8E7E0]">
                      <div className="flex justify-between text-[11px] font-medium text-[#46655D]">
                        <span>Presipitasi: {bmkgStep ? `${bmkgStep.precipitationMm ?? 0} mm` : '--'}</span>
                        <span>CAP Feed: {bmkgAlerts.length} item</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${bmkgStep ? Math.min(100, Math.max(15, bmkgStep.humidityPercent)) : 0}%` }}
                          className="h-full bg-gradient-to-r from-sky-400 to-teal-500 rounded-full transition-all duration-300"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('bmkg');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#D8E7E0] text-xs font-bold text-sky-700 hover:text-sky-800 flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Detail BMKG Sawah Besar &amp; CAP</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                {/* Model 2 Card */}
                <div className="agra-card border-t-[3px] border-t-emerald-500 p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2.5 gap-2">
                      <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1.5">
                        <Leaf size={13} className="text-emerald-600" />
                        <span>Model 2 · ANN Microclimate</span>
                      </span>
                      <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${!isLiveTelemetry || isTelemetryStale || !floraResult ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'agra-badge-safe'
                        }`}>
                        {isLiveTelemetry && !isTelemetryStale && floraResult ? floraResult.sensorRisk.toUpperCase() : 'STANDBY'}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-bold text-[#102A24] font-display">
                      Botanical &amp; Soil Risk (<code className="text-xs font-mono text-emerald-700">grenvis_sensor_model.h</code>)
                    </h3>
                    <p className="text-xs text-[#46655D] mt-1.5 leading-relaxed">
                      {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && typeof temp === 'number'
                        ? `ANN Health Index · Soil ${soilMoisture.toFixed(1)}% (${soilMoisture >= 30 ? 'Hidrasi Aman' : 'Defisit'}), Temp ${temp.toFixed(1)}°C`
                        : 'Menunggu pembacaan sensor tanah dan DHT22 untuk evaluasi grenvis_sensor_model.h.'}
                    </p>

                    {/* Hydration / Confidence Indicator */}
                    <div className="space-y-1.5 mt-3 pt-2.5 border-t border-[#D8E7E0]">
                      <div className="flex justify-between text-[11px] font-medium text-[#46655D]">
                        <span>Hydration: {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? (soilMoisture >= 30 ? 'Optimal' : 'Defisit Hidrasi') : '--'}</span>
                        <span>Conf: {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorConfidence.toFixed(1)}%` : '--'}</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture)) : 0}%` }}
                          className={`h-full rounded-full transition-all duration-300 ${typeof soilMoisture === 'number'
                              ? soilMoisture < 25 ? 'bg-rose-500' : soilMoisture < 35 ? 'bg-amber-500' : 'bg-emerald-500'
                              : 'bg-slate-300'
                            }`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('model_botanical');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#D8E7E0] text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Model 2 Botani &amp; Irigasi</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                {/* Model 3 Card */}
                <div className="agra-card border-t-[3px] border-t-sky-500 p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2.5 gap-2">
                      <span className="text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-200 px-2.5 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1.5">
                        <Camera size={13} className="text-sky-600" />
                        <span>Model 3 · Vision TFLite</span>
                      </span>
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full agra-badge-skyline">
                        {visionPrediction.includes('Fire')
                          ? 'FIRE DETECTED'
                          : visionPrediction.includes('Smoke')
                            ? 'SMOKE DETECTED'
                            : 'OPTICAL CLEAR'}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-bold text-[#102A24] font-display">
                      Computer Vision (<code className="text-xs font-mono text-sky-700">be-binus</code>)
                    </h3>
                    <p className="text-xs text-[#46655D] mt-1.5 leading-relaxed">
                      Railway Cloud API · Frame Status: {cameraStatus === 'streaming' ? 'Live Stream' : previewUrl ? 'Captured Frame' : 'Standby / Ready'}
                    </p>

                    {/* Optical Proba Mini-Bar */}
                    <div className="space-y-1.5 mt-3 pt-2.5 border-t border-[#D8E7E0]">
                      <div className="flex justify-between text-[11px] font-medium text-[#46655D]">
                        <span>Smoke: {visionProbs.smoke.toFixed(1)}%</span>
                        <span>Fire: {visionProbs.fire.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                        <div
                          style={{ width: `${visionProbs.healthy}%` }}
                          className="bg-emerald-500"
                          title={`Non-Fire: ${visionProbs.healthy.toFixed(1)}%`}
                        />
                        <div
                          style={{ width: `${visionProbs.smoke}%` }}
                          className="bg-amber-500"
                          title={`Smoke: ${visionProbs.smoke.toFixed(1)}%`}
                        />
                        <div
                          style={{ width: `${visionProbs.fire}%` }}
                          className="bg-rose-600"
                          title={`Fire: ${visionProbs.fire.toFixed(1)}%`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentTab('model_vision');
                    }}
                    className="mt-4 pt-2.5 border-t border-[#D8E7E0] text-xs font-bold text-sky-700 hover:text-sky-800 flex items-center justify-between cursor-pointer"
                  >
                    <span>Buka Model 3 Kamera &amp; Inferensi</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* 1. OVERVIEW HERO CARD (Deep Emerald-Teal Telemetry Command Theme) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <section
                  id="overview"
                  className="scroll-mt-6 sm:scroll-mt-8 rounded-2xl border border-emerald-400/35 bg-gradient-to-br from-[#0D2E27] via-[#124E46] to-[#0E6A75] p-5 sm:p-6 lg:p-7 flex flex-col justify-between gap-6 transition-all shadow-[0_14px_36px_-8px_rgba(13,46,39,0.3)] relative overflow-hidden text-white"
                >
                  {/* Decorative Highlight & Shimmer Strip */}
                  <div className="absolute -right-20 -bottom-20 w-72 h-72 rounded-full bg-teal-300/10 blur-3xl pointer-events-none" />
                  <div className="absolute top-0 left-0 right-0 h-[3px] animate-nav-shimmer z-10" />

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-white/15 relative z-1">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-200 block font-mono">
                        AGRAPATHA · Onboard Sensors × BMKG Sawah Besar Overview
                      </span>
                      <h2 className="text-xl lg:text-2xl font-extrabold font-display text-white tracking-tight mt-1">
                        Smart Botanical Risk, Fire Vision &amp; Meteorology Intelligence
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
                      <span className="text-xs text-emerald-100 font-tabular px-3 py-1 rounded-xl bg-white/10 backdrop-blur-md border border-white/20">
                        ANN: {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorRisk} (${floraResult.sensorConfidence.toFixed(0)}%)` : 'STANDBY'}
                      </span>
                      <span className="text-xs font-bold px-3 py-1 rounded-xl bg-amber-300 text-[#0D2E27] shadow-xs font-mono uppercase">
                        {isLiveTelemetry && !isTelemetryStale ? (envCondition || 'ONLINE') : bmkgCorrelation.hasJakartaAlert ? 'CAP ALERT' : 'STANDBY'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start relative z-1">
                    <div className="lg:col-span-2 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-200">
                          Status Sensor Onboard &amp; Sinkronisasi Sawah Besar
                        </span>
                      </div>
                      <h3 className="text-lg lg:text-xl font-bold font-display text-white leading-snug">
                        {bmkgCorrelation.headline}
                      </h3>
                      <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed max-w-2xl">
                        {bmkgCorrelation.advisory}
                      </p>

                      {/* Telemetry Pill Strip (Strict Active Hardware + BMKG Sawah Besar Only) */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 pt-1 w-full">
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-orange-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">Suhu (DHT22)</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? `${temp.toFixed(1)}°C` : '--'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-sky-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">RH Udara</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? `${rh.toFixed(1)}%` : '--'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-emerald-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">Tanah (v1.2)</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : '--'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-rose-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${flameInfo.isFireActive ? 'bg-rose-500 animate-ping' : 'bg-rose-400'}`} />
                            <span className="text-emerald-100 font-semibold truncate">Flame 5-Ch</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[12px] whitespace-nowrap shrink-0">
                            {isLiveTelemetry && !isTelemetryStale ? (flameInfo.isFireActive ? flameInfo.shortSide : typeof flameDetected === 'number' ? 'SAFE' : '--') : '--'}
                          </span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-indigo-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-indigo-300 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">Vision AI</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{wildfireResult ? wildfireResult.predicted_label : edgePrediction || 'STANDBY'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-teal-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-teal-300 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">BMKG Cuaca</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{bmkgStep ? `${bmkgStep.temperatureC}°C` : '--'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-amber-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">Angin BMKG</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{bmkgStep ? `${bmkgStep.windSpeedKmh}km/h` : '--'}</span>
                        </div>
                        <div className="bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/16 hover:border-cyan-300/60 px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-xs transition-all duration-150 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-cyan-300 shrink-0" />
                            <span className="text-emerald-100 font-semibold truncate">Rel &amp; Zona</span>
                          </div>
                          <span className="font-bold font-tabular text-white text-[13px] whitespace-nowrap shrink-0">{zone !== null ? `Z${zone}` : movementStatus === 'idle' ? 'STANDBY' : movementStatus.replace(/_command_sent|_command/g, '').toUpperCase()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Status & CAP Summary Box */}
                    <div className="bg-black/20 backdrop-blur-md border border-emerald-300/25 rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-lg">
                      <span className="text-xs text-emerald-200 uppercase tracking-wider font-bold block mb-1 font-mono">
                        Status AI &amp; Sawah Besar
                      </span>
                      <div
                        className={`px-4 py-1.5 rounded-xl text-sm font-extrabold border my-2 font-display ${!isLiveTelemetry || isTelemetryStale
                            ? bmkgCorrelation.hasJakartaAlert
                              ? 'bg-amber-400 text-[#0D2E27] border-amber-200'
                              : 'bg-white/10 text-amber-200 border-amber-300/40'
                            : envCondition === 'KEBAKARAN' || envCondition === 'ASAP_VISUAL' || floraResult?.sensorRisk === 'High'
                              ? 'bg-rose-500 text-white border-rose-300'
                              : envCondition === 'FAULT' || envCondition === 'KERING' || envCondition === 'BASAH' || floraResult?.sensorRisk === 'Moderate'
                                ? 'bg-amber-400 text-[#0D2E27] border-amber-200'
                                : 'bg-emerald-400 text-[#0D2E27] border-emerald-200'
                          }`}
                      >
                        {isLiveTelemetry && !isTelemetryStale
                          ? envCondition && envCondition !== 'NORMAL'
                            ? envCondition
                            : floraResult
                              ? `${floraResult.sensorRisk.toUpperCase()} BOTANICAL`
                              : 'ONLINE'
                          : bmkgStep
                            ? `BMKG ${bmkgStep.temperatureC}°C`
                            : 'STANDBY'}
                      </div>
                      <span className="text-xs text-emerald-100 font-tabular mt-0.5">
                        {isLiveTelemetry && !isTelemetryStale && floraResult
                          ? `${floraResult.sensorConfidence.toFixed(1)}% ANN confidence`
                          : bmkgStep
                            ? `${bmkgState?.selectedRegion.desa} · ${bmkgStep.weatherDesc}`
                            : 'Menunggu Telemetri'}
                      </span>
                      <p className="text-xs text-emerald-200/85 mt-2.5 m-0 leading-relaxed">
                        {isLiveTelemetry && !isTelemetryStale
                          ? (commandLabel || `Kondisi ${systemState || 'SCANNING'} · Sawah Besar Sinkron`)
                          : 'Evaluasi ANN menunggu stream ESP32; cuaca makro BMKG Sawah Besar tetap aktif.'}
                      </p>
                    </div>
                  </div>

                  {/* 4 Bottom Pillar Boxes */}
                  <div className="pt-4 border-t border-white/15 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative z-1">
                    <div className="bg-black/20 backdrop-blur-md border border-white/15 hover:border-amber-300/50 transition-all duration-150 p-3.5 rounded-xl flex flex-col justify-between min-h-22">
                      <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block font-mono">
                        1. Mikroklimat (DHT22)
                      </span>
                      <span className="text-sm font-bold text-white block mt-1">
                        {isLiveTelemetry && !isTelemetryStale && typeof temp === 'number'
                          ? temp >= 32 ? 'Suhu Tinggi / Terik' : temp <= 20 ? 'Kanopi Sejuk' : 'Temperatur Optimal'
                          : 'STANDBY'}
                      </span>
                      <span className="text-xs text-emerald-100/85 block font-tabular mt-1">
                        {isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' && typeof rh === 'number'
                          ? `${temp.toFixed(1)}°C · RH ${rh.toFixed(0)}%${bmkgCorrelation.tempDeltaC !== null ? ` (Δ ${bmkgCorrelation.tempDeltaC > 0 ? '+' : ''}${bmkgCorrelation.tempDeltaC}°C)` : ''}`
                          : 'Menunggu DHT22 GPIO 4'}
                      </span>
                    </div>
                    <div className="bg-black/20 backdrop-blur-md border border-white/15 hover:border-sky-300/50 transition-all duration-150 p-3.5 rounded-xl flex flex-col justify-between min-h-22">
                      <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider block font-mono">
                        2. BMKG Sawah Besar (CAP)
                      </span>
                      <span className="text-sm font-bold text-white block mt-1">
                        {bmkgStep ? bmkgStep.weatherDesc : 'Menghubungkan BMKG...'}
                      </span>
                      <span className="text-xs text-emerald-100/85 block font-tabular mt-1">
                        {bmkgStep
                          ? `${bmkgStep.temperatureC}°C · Angin ${bmkgStep.windSpeedKmh}km/h · Hujan ${bmkgStep.precipitationMm ?? 0}mm`
                          : 'Sawah Besar, Jakarta Pusat'}
                      </span>
                    </div>
                    <div className="bg-black/20 backdrop-blur-md border border-white/15 hover:border-rose-300/50 transition-all duration-150 p-3.5 rounded-xl flex flex-col justify-between min-h-22">
                      <span className="text-[11px] font-bold text-rose-300 uppercase tracking-wider block font-mono">
                        3. Flame 5-Ch &amp; Vision AI
                      </span>
                      <span className="text-sm font-bold text-white block mt-1">
                        {isLiveTelemetry && !isTelemetryStale
                          ? flameInfo.isFireActive
                            ? `API: ${flameInfo.shortSide}`
                            : 'AMAN TERKENDALI'
                          : 'STANDBY'}
                      </span>
                      <span className="text-xs text-emerald-100/85 block font-tabular mt-1">
                        {flameInfo.isFireActive && flameInfo.targetYawDeg !== null
                          ? `Arah Yaw Arm: ${flameInfo.targetYawDeg}° · ${flameInfo.sectorSummary}`
                          : wildfireResult && inferenceStatus === 'success'
                            ? wildfireResult.predicted_label
                            : edgePrediction
                              ? `Edge Vision: ${edgePrediction}`
                              : 'MobileNetV2 (be-binus)'}
                      </span>
                    </div>
                    <div className="bg-black/20 backdrop-blur-md border border-white/15 hover:border-emerald-300/50 transition-all duration-150 p-3.5 rounded-xl flex flex-col justify-between min-h-22">
                      <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider block font-mono">
                        4. Tanah &amp; Botanical ANN
                      </span>
                      <span className="text-sm font-bold text-white block mt-1">
                        {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && floraResult
                          ? `Soil ${soilMoisture.toFixed(1)}% (${floraResult.sensorRisk})`
                          : 'Soil -- (STANDBY)'}
                      </span>
                      <span className="text-xs text-emerald-100/85 block font-tabular mt-1">
                        grenvis_sensor_model.h (ANN)
                      </span>
                    </div>
                  </div>
                </section>

                {/* 2. LIVE ENVIRONMENTAL SENSORS & BMKG SAWAH BESAR (6-Card Color-Coded Grid) */}
                <section id="monitoring" className="scroll-mt-6 sm:scroll-mt-8">
                  <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                    <div>
                      <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                        Telemetry Stream &amp; Regional Weather · Live Array
                      </span>
                      <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] tracking-tight font-display">
                        Live Onboard Sensors &amp; BMKG Sawah Besar
                      </h2>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>DHT22 · Soil v1.2 · Flame 5-Ch · BMKG Sawah Besar</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      {
                        title: '1. Suhu Udara (Air Temperature)',
                        shortTitle: 'Suhu Udara (DHT22)',
                        channelTag: 'Sensor 1 · GPIO 4',
                        cardTopAccent: 'border-t-[3px] border-t-orange-500',
                        tagClass: 'text-orange-700 bg-orange-50 border-orange-200',
                        value: formatSensorValue(temp, isLiveTelemetry && !isTelemetryStale, 1),
                        unit: isLiveTelemetry && !isTelemetryStale ? '°C' : '',
                        statusLabel: getSensorStatusLabel('temp', temp, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                        isWarn: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' && temp >= 32,
                        percent: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? Math.min(100, Math.max(0, (temp / 45) * 100)) : 0,
                        minLabel: '0°C',
                        maxLabel: '45°C',
                        barColor: isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? (temp >= 32 ? 'bg-gradient-to-r from-orange-500 to-rose-600' : temp <= 20 ? 'bg-gradient-to-r from-cyan-400 to-sky-500' : 'bg-gradient-to-r from-amber-400 to-orange-500') : 'bg-slate-300',
                        isCardLive: isLiveTelemetry && !isTelemetryStale,
                        explanation: '',
                        reference: bmkgStep ? `BMKG Sawah Besar: ${bmkgStep.temperatureC}°C` : '',
                        extra: bmkgCorrelation.tempDeltaC !== null ? `Δ Lokal: ${bmkgCorrelation.tempDeltaC > 0 ? '+' : ''}${bmkgCorrelation.tempDeltaC}°C` : '',
                      },
                      {
                        title: '2. Kelembapan Udara (Relative Humidity)',
                        shortTitle: 'Kelembapan Udara (DHT22)',
                        channelTag: 'Sensor 2 · GPIO 4',
                        cardTopAccent: 'border-t-[3px] border-t-sky-500',
                        tagClass: 'text-sky-700 bg-sky-50 border-sky-200',
                        value: formatSensorValue(rh, isLiveTelemetry && !isTelemetryStale, 1),
                        unit: isLiveTelemetry && !isTelemetryStale ? '%' : '',
                        statusLabel: getSensorStatusLabel('rh', rh, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                        isWarn: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' && rh < 35,
                        percent: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? Math.min(100, Math.max(0, rh)) : 0,
                        minLabel: '0%',
                        maxLabel: '100%',
                        barColor: isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? (rh < 35 ? 'bg-gradient-to-r from-orange-500 to-rose-600' : 'bg-gradient-to-r from-cyan-400 to-sky-600') : 'bg-slate-300',
                        isCardLive: isLiveTelemetry && !isTelemetryStale,
                        explanation: '',
                        reference: bmkgStep ? `BMKG Sawah Besar: ${bmkgStep.humidityPercent}%` : '',
                        extra: bmkgCorrelation.rhDeltaPct !== null ? `Δ Lokal: ${bmkgCorrelation.rhDeltaPct > 0 ? '+' : ''}${bmkgCorrelation.rhDeltaPct}%` : '',
                      },
                      {
                        title: '3. Kelembapan Tanah (Soil Moisture)',
                        shortTitle: 'Kelembapan Tanah (Soil v1.2)',
                        channelTag: 'Sensor 3 · GPIO 34 ADC',
                        cardTopAccent: 'border-t-[3px] border-t-emerald-500',
                        tagClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
                        value: formatSensorValue(soilMoisture, isLiveTelemetry && !isTelemetryStale, 1),
                        unit: isLiveTelemetry && !isTelemetryStale ? '%' : '',
                        statusLabel: getSensorStatusLabel('soil', soilMoisture, isLiveTelemetry && !isTelemetryStale, undefined, isTelemetryStale),
                        isWarn: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && soilMoisture < 35,
                        percent: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? Math.min(100, Math.max(0, soilMoisture)) : 0,
                        minLabel: '0%',
                        maxLabel: '100%',
                        barColor: isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? (soilMoisture < 35 ? 'bg-gradient-to-r from-amber-500 to-rose-600' : soilMoisture > 80 ? 'bg-gradient-to-r from-sky-400 to-blue-600' : 'bg-gradient-to-r from-emerald-400 to-teal-600') : 'bg-slate-300',
                        isCardLive: isLiveTelemetry && !isTelemetryStale,
                        explanation: '',
                        reference: pumpLockout ? 'Lockout Aktif (>80%)' : 'Target Ideal: 35%–80%',
                        extra: typeof soilMoisture === 'number' && soilMoisture < 35 && bmkgCorrelation.hasRainForecast ? 'BMKG: Potensi Hujan' : '',
                      },
                      {
                        title: '4. Deteksi Api (Flame Sensor 5-Ch)',
                        shortTitle: 'Flame Sensor 5-Ch (Arah)',
                        channelTag: 'Sensor 4 · GPIO 25–33',
                        cardTopAccent: 'border-t-[3px] border-t-rose-500',
                        tagClass: 'text-rose-700 bg-rose-50 border-rose-200',
                        value: formatSensorValue(
                          flameDetected ?? (flameInfo.isFireActive ? 1 : null),
                          isLiveTelemetry && !isTelemetryStale,
                          0
                        ),
                        unit: isLiveTelemetry && !isTelemetryStale
                          ? flameInfo.isFireActive
                            ? flameInfo.shortSide
                            : typeof flameDetected === 'number' || flameChannels
                              ? 'CLEAR'
                              : ''
                          : '',
                        statusLabel: getSensorStatusLabel(
                          'flame',
                          flameDetected ?? (flameInfo.isFireActive ? 1 : null),
                          isLiveTelemetry && !isTelemetryStale,
                          flameInfo.isFireActive ? flameInfo.shortSide : undefined,
                          isTelemetryStale
                        ),
                        isWarn: flameInfo.isFireActive,
                        percent: flameInfo.isFireActive ? 100 : 0,
                        minLabel: 'Kiri (CH1)',
                        maxLabel: 'Kanan (CH5)',
                        barColor: flameInfo.isFireActive ? 'bg-gradient-to-r from-orange-500 to-rose-600' : isLiveTelemetry && !isTelemetryStale ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-slate-300',
                        isCardLive: isLiveTelemetry && !isTelemetryStale,
                        flameChannelsVisual: true,
                        explanation: '',
                        reference: flameInfo.isFireActive && flameInfo.targetYawDeg !== null
                          ? `Target Servo: ${flameInfo.targetYawDeg}°`
                          : '5 Sektor (Kiri -> Kanan)',
                        extra: flameInfo.isFireActive
                          ? flameInfo.sectorSummary
                          : `Vision: ${wildfireResult ? wildfireResult.predicted_label : edgePrediction || 'Standby'}`,
                      },
                      {
                        title: '5. Angin & Cuaca Makro (BMKG Sawah Besar)',
                        shortTitle: 'Angin BMKG (Sawah Besar)',
                        channelTag: 'BMKG API · Kel. Sawah Besar',
                        cardTopAccent: 'border-t-[3px] border-t-amber-500',
                        tagClass: 'text-amber-800 bg-amber-50 border-amber-200',
                        value: bmkgStep ? formatSensorValue(bmkgStep.windSpeedKmh, true, 1) : 'Unavailable',
                        unit: bmkgStep ? `km/h ${bmkgStep.windDirectionCardinal || ''}`.trim() : '',
                        statusLabel: getSensorStatusLabel('bmkg_wind', bmkgStep?.windSpeedKmh, Boolean(bmkgStep)),
                        isWarn: Boolean(bmkgStep && bmkgStep.windSpeedKmh >= 25),
                        percent: bmkgStep ? Math.min(100, Math.max(0, (bmkgStep.windSpeedKmh / 50) * 100)) : 0,
                        minLabel: '0 km/h',
                        maxLabel: '50 km/h',
                        barColor: bmkgStep ? (bmkgStep.windSpeedKmh >= 25 ? 'bg-gradient-to-r from-orange-500 to-rose-600' : 'bg-gradient-to-r from-amber-400 to-orange-500') : 'bg-slate-300',
                        isCardLive: Boolean(bmkgStep),
                        explanation: '',
                        reference: bmkgStep ? bmkgStep.weatherDesc : 'Memuat BMKG...',
                        extra: bmkgStep?.visibilityText ? `Vis: ${bmkgStep.visibilityText}` : '',
                      },
                      {
                        title: '6. Hujan & Nowcast CAP (BMKG Sawah Besar)',
                        shortTitle: 'Presipitasi & CAP BMKG',
                        channelTag: 'BMKG CAP · /nowcast/{id|en}',
                        cardTopAccent: 'border-t-[3px] border-t-indigo-500',
                        tagClass: 'text-indigo-800 bg-indigo-50 border-indigo-200',
                        value: bmkgStep ? formatSensorValue(bmkgStep.precipitationMm ?? 0, true, 1) : 'Unavailable',
                        unit: bmkgStep ? 'mm' : '',
                        statusLabel: bmkgCorrelation.hasJakartaAlert
                          ? 'CAP ALERT JAKARTA'
                          : getSensorStatusLabel('bmkg_rain', bmkgStep?.precipitationMm ?? 0, Boolean(bmkgStep), bmkgStep?.weatherDesc),
                        isWarn: bmkgCorrelation.hasJakartaAlert,
                        percent: bmkgStep ? Math.min(100, Math.max(0, ((bmkgStep.precipitationMm ?? 0) / 20) * 100)) : 0,
                        minLabel: '0 mm',
                        maxLabel: '20+ mm',
                        barColor: bmkgCorrelation.hasJakartaAlert ? 'bg-gradient-to-r from-rose-500 to-amber-500' : bmkgStep ? 'bg-gradient-to-r from-indigo-400 to-sky-500' : 'bg-slate-300',
                        isCardLive: Boolean(bmkgStep),
                        explanation: '',
                        reference: `Awan: ${bmkgStep?.cloudCoverPercent ?? '--'}%`,
                        extra: `${bmkgAlerts.length} Nowcast XML`,
                      },
                    ].map((card) => (
                      <article
                        key={card.title}
                        className={`flora-card flora-card-interactive ${card.cardTopAccent} p-5 flex flex-col justify-between transition-all duration-200`}
                      >
                        <div className="flex flex-col">
                          <div>
                            {/* Header: Channel tag + Status Pill */}
                            <div className="flex justify-between items-start mb-2.5 gap-2">
                              <div className="min-w-0">
                                <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wide font-mono ${card.tagClass}`}>
                                  {card.channelTag}
                                </span>
                                <h3 className="text-[15px] font-bold text-[#102A24] font-display mt-1.5 truncate">
                                  {card.shortTitle}
                                </h3>
                              </div>
                              <span
                                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 uppercase tracking-wide shrink-0 whitespace-nowrap ${card.isWarn
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : card.isCardLive && card.value !== 'Unavailable'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                              >
                                <span
                                  className={`w-2 h-2 rounded-full ${card.isWarn ? 'bg-rose-500 animate-pulse' : card.isCardLive && card.value !== 'Unavailable' ? 'bg-emerald-500' : 'bg-slate-400'
                                    }`}
                                />
                                {card.statusLabel}
                              </span>
                            </div>

                            {/* Balanced Metric Value Display */}
                            {card.value && card.value !== 'Unavailable' ? (
                              <div className="my-2.5 flex items-baseline gap-2 flex-wrap">
                                <span className="text-2xl sm:text-[28px] font-extrabold font-tabular text-[#102A24] tracking-tight">
                                  {card.value}
                                </span>
                                <span className="text-sm font-bold text-[#46655D] font-display whitespace-nowrap">
                                  {card.unit}
                                </span>
                              </div>
                            ) : (
                              <div className="my-2.5 text-sm font-semibold text-slate-400 italic">
                                Menunggu sensor aktif...
                              </div>
                            )}

                            {/* Visual Range Spectrum Gauge / 5-Sector Directional Flame Strip */}
                            {'flameChannelsVisual' in card && card.flameChannelsVisual ? (
                              <div className="my-2 bg-[#F2F8F5] p-3 rounded-xl border border-[#CFE2D9]">
                                <div className="flex justify-between items-center text-[11px] font-mono text-[#46655D] mb-1.5 gap-2">
                                  <span>Peta 5 Sektor Api (Kiri → Kanan)</span>
                                  <span className={`font-bold ${flameInfo.isFireActive ? 'text-rose-700' : 'text-[#102A24]'}`}>
                                    {flameInfo.isFireActive ? flameInfo.sectorSummary : isLiveTelemetry && !isTelemetryStale ? 'CLEAR' : '--'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-5 gap-1">
                                  {FLAME_CHANNEL_SPECS.map((spec, idx) => {
                                    const hasLive = isLiveTelemetry && !isTelemetryStale && Array.isArray(flameChannels);
                                    const active = hasLive && flameInfo.channelStates[idx];
                                    return (
                                      <div
                                        key={spec.key}
                                        title={`${spec.key} (${spec.label} · GPIO ${spec.gpio} · Yaw ${spec.angleDeg}°)`}
                                        className={`rounded-lg py-1.5 px-1 text-center border transition-all ${
                                          !hasLive
                                            ? 'bg-white border-slate-200 text-slate-400'
                                            : active
                                              ? 'bg-rose-600 border-rose-700 text-white shadow-xs animate-pulse'
                                              : 'bg-white border-emerald-200 text-emerald-800'
                                        }`}
                                      >
                                        <span className="block text-[10px] font-bold font-mono leading-tight">{spec.key}</span>
                                        <span className="block text-[9px] font-semibold leading-tight truncate">{spec.shortLabel}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <div className="my-2 bg-[#F2F8F5] p-3 rounded-xl border border-[#CFE2D9]">
                                <div className="flex justify-between items-center text-[11px] font-mono text-[#46655D] mb-1.5">
                                  <span>Range Spectrum</span>
                                  <span className="font-bold text-[#102A24]">{card.percent.toFixed(0)}%</span>
                                </div>
                                <div className="w-full h-2 bg-white rounded-full overflow-hidden border border-[#DCECE4]">
                                  <div
                                    className={`h-full rounded-full flora-meter-bar ${card.barColor}`}
                                    style={{ width: `${card.percent}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-[11px] font-mono text-[#46655D] mt-1.5">
                                  <span>{card.minLabel}</span>
                                  <span>{card.maxLabel}</span>
                                </div>
                              </div>
                            )}

                            {/* Descriptive Context */}
                            {card.explanation ? (
                              <p className="text-xs text-[#50645F] leading-relaxed my-2 min-h-11">
                                {card.explanation}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {/* Metadata Footer */}
                        {card.reference || card.extra ? (
                          <div className="pt-3 mt-3 border-t border-[#CFE2D9] flex items-center justify-between gap-2 text-[11px] min-h-8.5">
                            {card.reference ? (
                              <span className="font-semibold text-[#0F766E] bg-[#F2F8F5] px-2.5 py-0.5 rounded-md border border-[#CFE2D9] font-mono shrink-0 truncate max-w-[62%]">
                                {card.reference}
                              </span>
                            ) : null}
                            {card.extra ? (
                              <span className="font-tabular text-[#46655D] font-semibold truncate text-right">
                                {card.extra}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* BMKG SAWAH BESAR FORECAST & CAP NOWCAST SECTION */}
            {(currentTab === 'overview' || currentTab === 'all' || currentTab === 'bmkg') && (
              <FloraBmkgCard
                localTemp={temp}
                localRh={rh}
                localSoil={soilMoisture}
                flameDetected={flameDetected}
                flameChannels={flameChannels}
                flameDirection={flameDirection}
                visionPrediction={visionPrediction}
                isLiveTelemetry={isLiveTelemetry}
                isTelemetryStale={isTelemetryStale}
                onBmkgStateChange={setBmkgState}
              />
            )}

            {/* DEDICATED VIEW: BOTANICAL & ENVIRONMENTAL RISK (grenvis_sensor_model.h) */}
            {currentTab === 'model_botanical' && (
              <Model2BotanicalView
                floraResult={floraResult}
                temp={temp}
                rh={rh}
                soilMoisture={soilMoisture}
                history={history}
                wateringHistory={wateringEvents}
                isLiveTelemetry={isLiveTelemetry}
                isTelemetryStale={isTelemetryStale}
              />
            )}

            {/* DUAL AI ANALYSIS GRID (Botanical ANN + BMKG Sync + AI Vision) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <div className="scroll-mt-6 sm:scroll-mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch" id="analysis">
                  {/* Left: grenvis_sensor_model.h Analysis Card */}
                  <section className="flora-card border-t-[3px] border-t-emerald-500 p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-4 gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                              Botanical Neural Network · grenvis_sensor_model.h
                            </span>
                            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                              9,000 Samples ANN
                            </span>
                          </div>
                          <h2 className="text-base sm:text-lg font-bold text-[#102A24] font-display mt-1">
                            Botanical Stress &amp; Microclimate Analysis
                          </h2>
                        </div>

                        <span
                          className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 shrink-0 whitespace-nowrap ${!isLiveTelemetry || isTelemetryStale || !floraResult
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : floraResult.sensorRisk === 'High'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : floraResult.sensorRisk === 'Moderate'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${!isLiveTelemetry || isTelemetryStale || !floraResult
                                ? 'bg-slate-400'
                                : floraResult.sensorRisk === 'High'
                                  ? 'bg-rose-500'
                                  : floraResult.sensorRisk === 'Moderate'
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                              }`}
                          />
                          {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorRisk.toUpperCase()} RISK` : 'STANDBY'}
                        </span>
                      </div>

                      <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-4 my-2 flex items-center justify-between">
                        <div>
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wider block">
                            Assessed Botanical Stress Level
                          </span>
                          <span className="text-base sm:text-lg font-bold text-[#102A24] font-display block mt-0.5">
                            {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorRisk} Risk (DHT22 + Soil)` : 'Standby'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] font-semibold text-[#46655D] uppercase tracking-wider block">
                            ANN Confidence
                          </span>
                          <span className="text-base font-bold font-tabular text-[#0F766E] block mt-0.5">
                            {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorConfidence.toFixed(2)}%` : '--'}
                          </span>
                        </div>
                      </div>

                      {/* 3 Class Probabilities from grenvis_sensor_model.h */}
                      <div className="grid grid-cols-3 gap-2.5 my-3">
                        <div className="bg-rose-50/70 p-3 rounded-xl border border-rose-200 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[11px] font-semibold text-rose-800 uppercase block truncate">
                                High [0]
                              </span>
                              <span className="w-2 h-2 rounded-full bg-rose-600 shrink-0" />
                            </div>
                            <span className="text-sm sm:text-base font-bold font-tabular text-rose-700 block mt-0.5 whitespace-nowrap">
                              {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.highProbability.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden mt-2">
                            <div
                              className="h-full bg-rose-600 rounded-full flora-meter-bar"
                              style={{ width: `${isLiveTelemetry && !isTelemetryStale && floraResult ? Math.min(100, Math.max(0, floraResult.highProbability)) : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[11px] font-semibold text-amber-800 uppercase block truncate">
                                Moderate [2]
                              </span>
                              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                            </div>
                            <span className="text-sm sm:text-base font-bold font-tabular text-amber-700 block mt-0.5 whitespace-nowrap">
                              {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.moderateProbability.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden mt-2">
                            <div
                              className="h-full bg-amber-500 rounded-full flora-meter-bar"
                              style={{ width: `${isLiveTelemetry && !isTelemetryStale && floraResult ? Math.min(100, Math.max(0, floraResult.moderateProbability)) : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[11px] font-semibold text-emerald-800 uppercase block truncate">
                                Low [1]
                              </span>
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            </div>
                            <span className="text-sm sm:text-base font-bold font-tabular text-emerald-700 block mt-0.5 whitespace-nowrap">
                              {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.lowProbability.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-white rounded-full overflow-hidden mt-2">
                            <div
                              className="h-full bg-emerald-500 rounded-full flora-meter-bar"
                              style={{ width: `${isLiveTelemetry && !isTelemetryStale && floraResult ? Math.min(100, Math.max(0, floraResult.lowProbability)) : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Right: AI Vision Canopy & Smoke/Fire Analysis Card */}
                  <section className="flora-card border-t-[3px] border-t-sky-500 p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-4 gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider block">
                            Cloud AI Vision · Topologi Kamera
                          </span>
                          <h2 className="text-base sm:text-lg font-bold text-[#102A24] font-display mt-1">
                            Optical Canopy &amp; Plume Classification
                          </h2>
                        </div>
                        <span className="text-xs font-semibold px-3 py-1 rounded-full border flex items-center gap-1.5 bg-sky-50 text-sky-800 border-sky-200 shrink-0">
                          <span className="w-2 h-2 rounded-full bg-sky-500" />
                          ESP32-CAM Vision
                        </span>
                      </div>

                      <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-4 mb-4 flex justify-between items-center">
                        <div>
                          <span className="text-[11px] uppercase font-bold text-[#46655D] tracking-wider block">
                            Dominant Optical Classification
                          </span>
                          <span className="text-base sm:text-lg font-bold text-[#102A24] font-display block mt-0.5">
                            {wildfireResult ? visionPrediction : edgePrediction ? `${edgePrediction} (Edge AI)` : 'Standby / Belum Dianalisis'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] font-semibold text-[#46655D] uppercase tracking-wider block">
                            Sumber Citra
                          </span>
                          <span className="text-xs font-bold font-tabular text-[#0F766E] block mt-0.5">
                            {captureSource === 'camera'
                              ? 'Webcam Lokal'
                              : captureSource === 'upload'
                                ? 'Unggahan Manual'
                                : captureSource === 'gateway'
                                  ? 'Gateway ESP32-CAM'
                                  : 'Standby'}
                          </span>
                        </div>
                      </div>

                      {wildfireResult ? (
                        <div className="space-y-3.5 my-3">
                          {[
                            {
                              label: 'Healthy Forest Canopy (Non-Fire)',
                              value: visionProbs.healthy,
                              color: '#10B981',
                            },
                            {
                              label: 'Smoke Plume / Haze Indication',
                              value: visionProbs.smoke,
                              color: '#F59E0B',
                            },
                            {
                              label: 'Active Surface Fire / Thermal Glow',
                              value: visionProbs.fire,
                              color: '#E11D48',
                            },
                          ].map((bar) => (
                            <div key={bar.label}>
                              <div className="flex justify-between text-xs font-semibold text-[#102A24] mb-1.5">
                                <span>{bar.label}</span>
                                <span className="font-tabular text-[#46655D]">{bar.value.toFixed(1)}%</span>
                              </div>
                              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden border border-slate-200/70">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${bar.value}%`, backgroundColor: bar.color }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-4 px-3 my-3 text-center text-xs text-[#46655D] bg-[#F2F8F5] rounded-xl border border-[#CFE2D9]">
                          <p className="font-bold text-[#102A24] mb-1">Belum Ada Inferensi Citra Visual</p>
                          <p className="text-xs m-0 leading-relaxed">
                            {edgePrediction
                              ? `Hasil Edge AI firmware: ${edgePrediction}${edgeConfidence !== null ? ` (Confidence: ${(edgeConfidence * 100).toFixed(0)}%)` : ''}. Jalankan Analisis Karhutla untuk inferensi cloud.`
                              : 'Distribusi probabilitas visual ditampilkan dari model inferensi citra be-binus Railway.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* 4. KAGGLE DATASET INFORMATION & BENCHMARKS SECTION */}
                <FloraKaggleSection />
              </>
            )}

            {/* 5. CAMERA STREAM CAPTURE SECTION (#cameraCapture) */}
            {(currentTab === 'overview' || currentTab === 'all' || currentTab === 'model_vision') && (
              <section id="cameraCapture" className="scroll-mt-6 sm:scroll-mt-8 flora-card border-t-[3px] border-t-sky-500 p-5 sm:p-6">
                {/* Header Bar with Title and Engine Pill */}
                <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                  <div>
                    <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider block">
                      Camera Subsystem · Edge &amp; Cloud AI Vision
                    </span>
                    <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display mt-0.5">
                      Pemindaian Kanopi &amp; Verifikasi Visual Titik Api (Karhutla)
                    </h2>
                  </div>

                  {/* Vision Model & Optical State Indicator Badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-gradient-to-r from-[#0F766E] to-[#0284C7] text-white shadow-xs flex items-center gap-1.5">
                      <Flame size={13} className="text-amber-300" />
                      <span>be-binus · MobileNetV2 TFLite</span>
                    </span>

                    {/* Optical State Indicator Badge */}
                    <span className="text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 bg-[#F2F8F5] text-[#102A24] border-[#CFE2D9]">
                      <span
                        className={`w-2 h-2 rounded-full ${cameraStatus === 'streaming'
                            ? isVideoReady
                              ? 'bg-emerald-500 animate-pulse'
                              : 'bg-amber-500 animate-pulse'
                            : cameraStatus === 'captured'
                              ? 'bg-sky-500'
                              : cameraStatus === 'permission_denied' || cameraStatus === 'device_error'
                                ? 'bg-rose-500'
                                : 'bg-slate-400'
                          }`}
                      />
                      <span>
                        {cameraStatus === 'streaming'
                          ? isVideoReady
                            ? 'Kamera Live Aktif'
                            : 'Memuat Stream Kamera...'
                          : cameraStatus === 'captured'
                            ? 'Frame Siap Dianalisis'
                            : cameraStatus === 'permission_denied'
                              ? 'Izin Kamera Ditolak'
                              : cameraStatus === 'device_error'
                                ? 'Kamera Tidak Tersedia'
                                : 'Kamera Siap'}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Action Toolbar */}
                <div className="flex flex-wrap justify-between items-center gap-2 mb-4 p-3 rounded-xl bg-[#F2F8F5] border border-[#CFE2D9]">
                  <div className="flex items-center gap-2 flex-wrap">
                    {cameraStatus === 'streaming' ? (
                      <>
                        <button
                          type="button"
                          onClick={handleCaptureFromVideo}
                          disabled={!isVideoReady}
                          className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Camera size={14} />
                          <span>{isVideoReady ? 'Ambil Foto Frame' : 'Menyiapkan Kamera...'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleStopCamera}
                          className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#102A24] border border-[#CFE2D9] flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <VideoOff size={14} />
                          <span>Tutup Kamera</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleStartCamera}
                          className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0D5D57] text-white flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                        >
                          <Video size={14} />
                          <span>Buka Kamera Laptop/HP</span>
                        </button>

                        <label className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-50 text-[#102A24] border border-[#CFE2D9] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs">
                          <Upload size={14} className="text-sky-600" />
                          <span>Unggah Foto</span>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => handleFetchGatewayFrame(true)}
                          disabled={isFetchingGatewayFrame}
                          className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-white hover:bg-sky-50 text-[#102A24] border border-[#CFE2D9] flex items-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                          title="Ambil frame JPEG terbaru dari cache gateway (/api/vision/latest-frame.jpg)"
                        >
                          <Camera size={14} className="text-emerald-600" />
                          <span>{isFetchingGatewayFrame ? 'Memuat Gateway...' : 'Frame ESP32-CAM'}</span>
                        </button>
                      </>
                    )}

                    {capturedBlob && (
                      <button
                        type="button"
                        onClick={handleRetake}
                        disabled={isCapturing}
                        className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                        <span>Ulangi / Ganti Foto</span>
                      </button>
                    )}
                  </div>

                  {/* Main Analyze Button */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAnalyzeImage}
                      disabled={!capturedBlob || isCapturing}
                      aria-busy={isCapturing}
                      className="text-xs font-bold px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isCapturing ? (
                        <>
                          <span className="inline-block animate-spin">⏳</span>
                          <span>Menganalisis...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} className="text-amber-300" />
                          <span>Analisis Karhutla (be-binus Railway)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Error Banner */}
                {inferenceError && (
                  <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
                    <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-600" />
                    <div className="flex-1">
                      <span className="font-bold block">Pemberitahuan Sistem:</span>
                      <p className="mt-0.5 leading-relaxed m-0">{inferenceError}</p>
                    </div>
                  </div>
                )}

                {/* Main 2-Column Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
                  {/* Left: Video / Image Viewport */}
                  <div className="lg:col-span-2 relative min-h-85 xl:min-h-95 bg-gradient-to-br from-[#0D2E27] via-[#124B47] to-[#0E5E6F] border border-emerald-400/30 rounded-2xl overflow-hidden flex flex-col items-center justify-center text-center shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-black/[0.15] pointer-events-none" />
                    {cameraStatus === 'streaming' ? (
                      <>
                        <video
                          ref={setVideoElement}
                          autoPlay
                          playsInline
                          muted
                          onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            if (v.videoWidth > 0 && v.videoHeight > 0) {
                              setIsVideoReady(true);
                            }
                            v.play().catch((playErr: unknown) => {
                              if (playErr instanceof DOMException && playErr.name === 'AbortError') return;
                              const msg = playErr instanceof Error ? playErr.message : 'Browser memblokir pemutaran otomatis.';
                              setInferenceError(`Gagal memutar preview kamera: ${msg}`);
                            });
                          }}
                          onPlaying={(e) => {
                            const v = e.currentTarget;
                            if (v.videoWidth > 0 && v.videoHeight > 0) {
                              setIsVideoReady(true);
                            }
                          }}
                          onError={() => {
                            setIsVideoReady(false);
                            setCameraStatus('device_error');
                            setInferenceError('Terjadi kesalahan pada decoding stream video kamera.');
                          }}
                          className="w-full h-full object-cover absolute inset-0"
                        />
                        <div className="absolute top-3 left-3 z-10 px-3 py-1 rounded-lg bg-black/60 backdrop-blur-md text-emerald-100 text-xs font-mono border border-white/15 flex items-center gap-1.5 shadow-xs">
                          <span className={`w-2 h-2 rounded-full ${isVideoReady ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                          <span>{isVideoReady ? 'LIVE DEVICE CAMERA · MEDIASTREAM' : 'MEMUAT FEED KAMERA...'}</span>
                        </div>
                      </>
                    ) : previewUrl ? (
                      <>
                        <img
                          src={previewUrl}
                          alt="Captured frame ready for analysis"
                          className="w-full h-full object-cover absolute inset-0"
                        />
                        <div className="absolute top-3 left-3 z-10 px-3 py-1 rounded-lg bg-black/60 backdrop-blur-md text-emerald-100 text-xs font-mono border border-white/15 flex items-center gap-1.5 shadow-xs">
                          <CheckCircle2 size={13} className="text-emerald-400" />
                          <span>
                            {captureSource === 'camera'
                              ? 'FRAME FOTO KAMERA'
                              : captureSource === 'gateway'
                                ? `FRAME GATEWAY ESP32-CAM${gatewayFrameMeta ? ` · ${(gatewayFrameMeta.byteLength / 1024).toFixed(1)} KB${gatewayFrameMeta.isStale ? ' (STALE)' : ''}` : ''}`
                                : 'UNGGAHAN GAMBAR'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="relative z-10 p-6 max-w-md flex flex-col items-center gap-3.5">
                          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-emerald-300/35 flex items-center justify-center text-emerald-200 shadow-lg">
                            <Camera size={28} />
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white font-display">
                              Kamera Pemantau Kanopi Hutan &amp; Titik Api
                            </h3>
                            <p className="text-xs sm:text-[13px] text-emerald-100/90 mt-1.5 leading-relaxed">
                              Buka kamera laptop/smartphone, muat frame dari ESP32-CAM, atau unggah foto untuk inferensi karhutla via be-binus Railway.
                            </p>
                          </div>
                          <div className="flex gap-2.5 mt-1 flex-wrap justify-center">
                            <button
                              type="button"
                              onClick={handleStartCamera}
                              className="text-xs font-bold px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0D2E27] flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                            >
                              <Video size={14} />
                              <span>Buka Kamera</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFetchGatewayFrame(true)}
                              disabled={isFetchingGatewayFrame}
                              className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <Camera size={14} />
                              <span>Frame Gateway</span>
                            </button>
                            <label className="text-xs font-semibold px-3.5 py-2 rounded-xl bg-amber-300 hover:bg-amber-200 text-[#0D2E27] flex items-center gap-1.5 transition-all cursor-pointer shadow-sm">
                              <Upload size={14} />
                              <span>Unggah Foto</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleFileChange}
                              />
                            </label>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Bottom Viewport Overlay Telemetry */}
                    <div className="absolute inset-x-3 bottom-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 z-10 pointer-events-none">
                      <div className="px-3 py-1.5 rounded-lg bg-black/55 text-emerald-100 text-[11px] font-medium backdrop-blur-md border border-white/15 max-w-full truncate">
                        {`Mode: Karhutla · Rel: ${railPositionMm ?? '--'} mm · Source: ${captureSource === 'camera' ? 'Webcam' : captureSource === 'upload' ? 'Upload' : captureSource === 'gateway' ? 'Gateway ESP32-CAM' : 'Standby'}`}
                      </div>

                      <div className="flex flex-wrap items-center justify-start sm:justify-end gap-1.5">
                        {wildfireResult ? (
                          <>
                            <span className="px-2.5 py-1 rounded-lg bg-black/55 text-emerald-200 text-[11px] font-bold backdrop-blur-md border border-emerald-400/30 flex items-center gap-1.5 whitespace-nowrap">
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              Non-Fire: {visionProbs.healthy.toFixed(1)}%
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-black/55 text-amber-200 text-[11px] font-bold backdrop-blur-md border border-amber-400/30 flex items-center gap-1.5 whitespace-nowrap">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              Smoke: {visionProbs.smoke.toFixed(1)}%
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-black/55 text-rose-200 text-[11px] font-bold backdrop-blur-md border border-rose-400/30 flex items-center gap-1.5 whitespace-nowrap">
                              <span className="w-2 h-2 rounded-full bg-rose-400" />
                              Fire: {visionProbs.fire.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className="px-3 py-1 rounded-lg bg-black/55 text-emerald-100 text-[11px] font-mono border border-white/15">
                            {edgePrediction ? `Edge AI: ${edgePrediction}${edgeConfidence !== null ? ` (${(edgeConfidence * 100).toFixed(0)}%)` : ''} · Cloud: Standby` : 'Inferensi Cloud Siap (be-binus)'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Telemetry & Classification Meters */}
                  <div className="flex flex-col justify-between gap-3">
                    <div className="space-y-2.5">
                      <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wider block">
                            Waktu Pemindaian Optik
                          </span>
                          {wildfireResult && (
                            <span className="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              {wildfireResult.inference_time_ms.toFixed(1)} ms
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-[#102A24] font-tabular block mt-1">
                          {lastCaptureTime
                            ? new Date(lastCaptureTime).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                            : '--:--:--'}{' '}
                          <span className="text-xs font-normal text-[#46655D]">
                            ({captureSource === 'camera' ? 'Kamera' : captureSource === 'upload' ? 'Upload' : captureSource === 'gateway' ? 'Gateway ESP32-CAM' : 'Standby'})
                          </span>
                        </span>
                        <span className="text-[11px] text-[#46655D] block mt-1 font-mono">
                          {`Engine: ${wildfireResult?.model_name || 'MobileNetV2 (be-binus Railway)'}`}
                        </span>
                      </div>

                      <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3.5 flex justify-between items-center">
                        <div>
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wider block">
                            Pola Citra Terdeteksi
                          </span>
                          <span className="text-sm font-bold text-[#102A24] block mt-0.5 font-display">
                            {visionPrediction}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wider block">
                            Confidence
                          </span>
                          <span className="text-base font-extrabold text-[#0F766E] font-tabular block mt-0.5">
                            {wildfireResult ? `${wildfireResult.confidence_percentage.toFixed(1)}%` : '-'}
                          </span>
                        </div>
                      </div>

                      <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3.5 space-y-2.5">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wider block">
                            Klasifikasi Karhutla (3-Kelas)
                          </span>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-sky-50 text-sky-800 border-sky-200">
                            {inferenceStatus === 'analyzing'
                              ? 'Memproses...'
                              : inferenceStatus === 'success'
                                ? 'Server Terverifikasi'
                                : 'Siap Analisis'}
                          </span>
                        </div>

                        {wildfireResult ? (
                          <>
                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#102A24] mb-1">
                                <span>Healthy Canopy (Non-Fire)</span>
                                <span className="font-tabular text-emerald-700 font-bold">
                                  {visionProbs.healthy.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-white border border-[#CFE2D9] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500 flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.healthy))}%` }}
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#102A24] mb-1">
                                <span>Smoke Plume (Smoke)</span>
                                <span className="font-tabular text-amber-700 font-bold">
                                  {visionProbs.smoke.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-white border border-[#CFE2D9] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-amber-500 flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.smoke))}%` }}
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between text-xs font-semibold text-[#102A24] mb-1">
                                <span>Surface Fire (Fire)</span>
                                <span className="font-tabular text-rose-700 font-bold">
                                  {visionProbs.fire.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-white border border-[#CFE2D9] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-rose-600 flora-meter-bar transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(0, visionProbs.fire))}%` }}
                                />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="py-4 px-3 text-center text-xs text-[#46655D] bg-white rounded-xl border border-[#CFE2D9]">
                            <p className="font-bold text-[#102A24] mb-1">Belum Ada Hasil Inferensi Citra</p>
                            <p className="text-xs m-0 leading-relaxed">Muat frame dari kamera atau unggah foto lalu klik &quot;Analisis Karhutla&quot;.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-sky-50/70 border border-sky-200 p-3 rounded-xl flex items-start gap-2 text-xs text-sky-900 leading-relaxed">
                      <Info size={15} className="shrink-0 mt-0.5 text-sky-600" />
                      <p className="m-0">
                        Endpoint aktif: <code className="font-mono font-semibold text-[#102A24]">be-binus-production.up.railway.app</code> (<code className="font-mono">/api/v1/predict</code> &amp; <code className="font-mono">/predict/fire</code>).
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 6. 4-DOF ROBOT ARM, SLIDER & EMQX WSS CONTROL (#device-control) */}
            {(currentTab === 'overview' || currentTab === 'all') && (
              <>
                <section id="device-control" className="scroll-mt-6 sm:scroll-mt-8 flora-card border-t-[3px] border-t-teal-600 p-5 sm:p-6">
                  <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                    <div>
                      <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                        Actuator &amp; Robotic Subsystem · L298N + 4-DoF Arm + 5-Ch Flame
                      </span>
                      <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display mt-0.5">
                        Kontrol Lengan Robot 4-DoF &amp; Scanner Rel — {railPositionMm !== null ? `${railPositionMm} / 1200 mm` : 'Standby'}
                      </h2>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full border flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                      isLiveTelemetry && !isTelemetryStale
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${isLiveTelemetry && !isTelemetryStale ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                      {systemState
                        ? `${systemState} · ${movementStatus === 'idle' ? 'READY' : movementStatus.replace(/_/g, ' ').toUpperCase()}`
                        : movementStatus === 'idle'
                          ? `${motorDriverInfo} STANDBY`
                          : `${motorDriverInfo} · ${movementStatus.replace(/_/g, ' ').toUpperCase()}`}
                    </span>
                  </div>

                  {/* Visual Rail Track Progress Bar */}
                  <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-4 mb-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 text-xs font-bold text-[#102A24] mb-2 font-tabular">
                      <span className={limitLeft ? 'text-rose-600' : 'text-emerald-700'}>
                        SW1 Left (Z1): {limitLeft ? 'ACTIVE (0mm)' : 'CLEAR'}
                      </span>
                      <span className="text-[#0F766E]">
                        Zona: {zone ?? '--'} · Posisi Rel: {railPositionMm !== null ? `${railPositionMm} mm (${((railPositionMm / 1200) * 100).toFixed(0)}%)` : 'Indeterminate (Standby)'}
                      </span>
                      <span className={limitRight ? 'text-rose-600' : 'text-emerald-700'}>
                        SW2 Right (Z3): {limitRight ? 'ACTIVE (1200mm)' : 'CLEAR'}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-white border border-[#CFE2D9] relative overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-300"
                        style={{ width: `${railPositionMm !== null ? (railPositionMm / 1200) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Direct EMQX WSS (Port 8084) Connection & Fail-Closed Safety Gate */}
                  <div className="bg-gradient-to-r from-[#F2F8F5] to-[#EFF7FA] border border-[#CFE2D9] rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${actuatorArmed ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
                          <ShieldCheck size={18} />
                        </div>
                        <div>
                          <span className="text-xs sm:text-[13px] font-bold text-[#102A24] block">
                            EMQX Cloud Direct WSS (Port 8084) &amp; Fail-Closed Safety Gate
                          </span>
                          <span className="text-xs text-[#46655D]">
                            Status WSS: <strong className={`uppercase ${mqttWssStatus === 'connected' ? 'text-emerald-700' : 'text-amber-700'}`}>{mqttWssStatus}</strong> · Koneksi otomatis aktif (subscribe read-only sampai di-arm).
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActuatorArmed((prev) => !prev)}
                        disabled={mqttWssStatus !== 'connected'}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          actuatorArmed
                            ? 'bg-rose-600 text-white border-rose-700 shadow-sm'
                            : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        {actuatorArmed ? '🔓 ARMED · SIAP EKSEKUSI' : '🔒 TERKUNCI (ARM AKTUATOR)'}
                      </button>
                    </div>

                    <form onSubmit={handleConnectMqttWss} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        value={mqttHostInput}
                        onChange={(e) => setMqttHostInput(e.target.value)}
                        placeholder="Host EMQX (emqxsl.com)"
                        aria-label="Host Broker EMQX WSS"
                        className="px-3 py-2 rounded-xl bg-white border border-[#CFE2D9] text-xs font-mono text-[#102A24]"
                      />
                      <input
                        type="text"
                        value={mqttUserInput}
                        onChange={(e) => setMqttUserInput(e.target.value)}
                        placeholder="Username EMQX"
                        aria-label="Username Broker EMQX"
                        className="px-3 py-2 rounded-xl bg-white border border-[#CFE2D9] text-xs font-mono text-[#102A24]"
                      />
                      <input
                        type="password"
                        value={mqttPassInput}
                        onChange={(e) => setMqttPassInput(e.target.value)}
                        placeholder="Password EMQX"
                        aria-label="Password Broker EMQX"
                        className="px-3 py-2 rounded-xl bg-white border border-[#CFE2D9] text-xs font-mono text-[#102A24]"
                      />
                      {mqttWssStatus === 'connected' ? (
                        <button
                          type="button"
                          onClick={handleDisconnectMqttWss}
                          className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer hover:bg-rose-100"
                        >
                          Putuskan WSS :8084
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={mqttWssStatus === 'connecting'}
                          className="px-3 py-2 rounded-xl bg-[#0F766E] hover:bg-[#0D5D57] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          {mqttWssStatus === 'connecting' ? 'Menghubungkan...' : 'Hubungkan EMQX WSS :8084'}
                        </button>
                      )}
                    </form>

                    {mqttWssError && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                        {mqttWssError}
                      </div>
                    )}
                  </div>

                  {/* Live 4-DoF Arm Servo, Rail Relay & 5-Ch Flame Array */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
                    <div className="bg-violet-50/50 border border-violet-200 rounded-xl p-3.5">
                      <span className="text-[11px] font-bold text-violet-800 uppercase tracking-wider block mb-2">
                        4-DoF Arm Servos (GPIO 13, 14, 15, 5)
                      </span>
                      <div className="grid grid-cols-4 gap-1.5 text-center font-tabular">
                        {['Base J1', 'Shld J2', 'Elbw J3', 'Nozl J4'].map((label, idx) => (
                          <div key={label} className="bg-white border border-violet-200 rounded-lg p-2">
                            <span className="text-[11px] text-[#46655D] block">{label}</span>
                            <span className="text-xs font-extrabold text-violet-900">
                              {isLiveTelemetry && !isTelemetryStale && servoAngles && typeof servoAngles[idx] === 'number'
                                ? `${servoAngles[idx]}°`
                                : '--'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-3.5">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">
                          5-Ch Flame Array (Kiri → Kanan)
                        </span>
                        <span
                          className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border ${
                            flameInfo.isFireActive
                              ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                              : isLiveTelemetry && !isTelemetryStale
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {isLiveTelemetry && !isTelemetryStale
                            ? flameInfo.isFireActive
                              ? flameInfo.sectorSummary
                              : 'AMAN'
                            : 'STANDBY'}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-[10px]">
                        {FLAME_CHANNEL_SPECS.map((spec, idx) => {
                          const hasLive = isLiveTelemetry && !isTelemetryStale && Boolean(flameChannels);
                          const val = hasLive && flameChannels ? flameChannels[idx] : undefined;
                          const isFire = typeof val === 'number' && val > 0;
                          return (
                            <div
                              key={spec.key}
                              title={`${spec.key} · ${spec.label} · GPIO ${spec.gpio} · Yaw ${spec.angleDeg}°`}
                              className={`rounded-lg p-1.5 border font-bold ${
                                val === undefined
                                  ? 'bg-white border-slate-200 text-slate-500'
                                  : isFire
                                    ? 'bg-rose-600 border-rose-700 text-white animate-pulse shadow-xs'
                                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              }`}
                            >
                              <div>{spec.key}</div>
                              <div className="text-[9px] font-sans font-semibold leading-tight truncate">{spec.shortLabel}</div>
                              <div className="text-[9px] opacity-85">{val === undefined ? `${spec.angleDeg}°` : isFire ? `API · ${spec.angleDeg}°` : 'OK'}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[11px] font-medium text-rose-900/90 flex items-center justify-between gap-2 flex-wrap">
                        <span>{isLiveTelemetry && !isTelemetryStale ? flameInfo.detailLabel : 'GPIO 25 (CH1) s.d. GPIO 33 (CH5)'}</span>
                      </div>
                    </div>

                    <div className="bg-teal-50/50 border border-teal-200 rounded-xl p-3.5 flex flex-col justify-between">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-[#46655D] font-semibold">BMKG Sawah Besar:</span>
                        <span className="font-bold font-tabular text-[#102A24]">
                          {bmkgStep
                            ? `${bmkgStep.temperatureC}°C · ${bmkgStep.windSpeedKmh}km/h`
                            : 'Menyinkron'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs mt-2">
                        <span className="text-[#46655D] font-semibold">Pompa (GPIO 23):</span>
                        <span className={`font-bold ${pumpLockout ? 'text-amber-700' : pumpStatus ? 'text-emerald-700' : 'text-[#102A24]'}`}>
                          {!isLiveTelemetry || isTelemetryStale || pumpStatus === null
                            ? 'Standby'
                            : pumpLockout
                              ? 'LOCKOUT (BASAH)'
                              : pumpStatus
                                ? 'AKTIF (ON)'
                                : 'MATI (OFF)'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs mt-2">
                        <span className="text-[#46655D] font-semibold">Kondisi Onboard:</span>
                        <span className="font-bold text-[#102A24]">
                          {isLiveTelemetry && !isTelemetryStale
                            ? envCondition || systemState || 'NORMAL'
                            : 'Standby'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Kontrol Manual Derajat 4-DoF Arm (Seperti L298N) */}
                  <div className="bg-gradient-to-br from-violet-50/60 to-white border border-violet-200 rounded-2xl p-4 sm:p-5 mb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-violet-200/80">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-violet-100 border border-violet-200 text-violet-700 flex items-center justify-center shrink-0">
                          <Sliders size={16} />
                        </div>
                        <div>
                          <span className="text-xs sm:text-[13px] font-bold text-[#102A24] block">
                            Kontrol Manual Sudut Derajat Lengan Robot 4-DoF (0°–180°)
                          </span>
                          <span className="text-[11px] text-[#46655D] block">
                            Mode default saat ESP32 nyala: <strong className="text-violet-800">{armManualMode === false ? 'AUTO SCAN' : 'MANUAL ARM'}</strong> — atur sudut tiap servo seperti kontrol L298N (aktifkan ARM AKTUATOR di atas).
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => dispatchRobotCommand('CMD_SET_ARM_MODE', 'Aktifkan Mode Manual Arm', { manual: true })}
                          disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                          className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            armManualMode !== false
                              ? 'bg-violet-600 text-white border-violet-700 shadow-xs'
                              : 'bg-white text-violet-800 border-violet-200 hover:bg-violet-50'
                          }`}
                        >
                          Mode Manual (Default)
                        </button>
                        <button
                          type="button"
                          onClick={() => dispatchRobotCommand('CMD_SET_ARM_MODE', 'Aktifkan Mode Auto Scan', { manual: false })}
                          disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                          className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            armManualMode === false
                              ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                              : 'bg-white text-[#46655D] border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          Mode Auto Scan
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (servoAngles && servoAngles.length >= 4) {
                              setManualServoAngles([
                                Math.max(0, Math.min(180, Math.round(servoAngles[0]))),
                                Math.max(0, Math.min(180, Math.round(servoAngles[1]))),
                                Math.max(0, Math.min(180, Math.round(servoAngles[2]))),
                                Math.max(0, Math.min(180, Math.round(servoAngles[3]))),
                              ]);
                              showToast('Slider disamakan ke sudut aktual ESP32.');
                            }
                          }}
                          disabled={!isLiveTelemetry || isTelemetryStale || !servoAngles || servoAngles.length < 4}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold border bg-white text-[#102A24] border-[#CFE2D9] hover:bg-[#F2F8F5] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Sync Aktual
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetAllServoAngles([90, 45, 45, 90])}
                          disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold border bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Reset Netral (90/45/45/90°)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetAllServoAngles()}
                          disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                          className="px-3.5 py-1.5 rounded-xl text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Kirim Semua 4 Sudut
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {SERVO_JOINT_SPECS.map((spec) => {
                        const targetVal = manualServoAngles[spec.idx];
                        const liveVal =
                          isLiveTelemetry && !isTelemetryStale && servoAngles && typeof servoAngles[spec.idx] === 'number'
                            ? Math.round(servoAngles[spec.idx])
                            : null;
                        return (
                          <div key={spec.key} className="bg-white border border-violet-200/80 rounded-xl p-3.5 flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <span className="text-xs font-extrabold text-[#102A24] block">
                                  {spec.label} <span className="font-mono text-[10px] text-violet-700">· GPIO {spec.gpio}</span>
                                </span>
                                <span className="text-[11px] text-[#46655D]">{spec.desc}</span>
                              </div>
                              <div className="text-right font-tabular shrink-0">
                                <span className="block text-[10px] text-[#46655D] uppercase">Aktual ESP32</span>
                                <span className="text-xs font-extrabold text-violet-800">
                                  {liveVal !== null ? `${liveVal}°` : '--'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2.5">
                              <input
                                type="range"
                                min={spec.min}
                                max={spec.max}
                                step={1}
                                value={targetVal}
                                aria-label={`Slider derajat ${spec.label}`}
                                onChange={(e) => {
                                  const nextDeg = Number(e.target.value);
                                  setManualServoAngles((prev) => {
                                    const copy = [...prev] as [number, number, number, number];
                                    copy[spec.idx] = nextDeg;
                                    return copy;
                                  });
                                }}
                                onPointerUp={() => {
                                  if (mqttWssStatus === 'connected' && actuatorArmed) {
                                    handleSetSingleServoAngle(spec.idx, targetVal);
                                  }
                                }}
                                className="flex-1 accent-violet-600 cursor-pointer"
                              />
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number"
                                  min={spec.min}
                                  max={spec.max}
                                  value={targetVal}
                                  aria-label={`Input derajat ${spec.label}`}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value);
                                    if (!Number.isFinite(raw)) return;
                                    const clamped = Math.max(0, Math.min(180, Math.round(raw)));
                                    setManualServoAngles((prev) => {
                                      const copy = [...prev] as [number, number, number, number];
                                      copy[spec.idx] = clamped;
                                      return copy;
                                    });
                                  }}
                                  className="w-14 px-2 py-1 rounded-lg border border-violet-200 text-xs font-bold font-mono text-center text-[#102A24]"
                                />
                                <span className="text-xs font-bold text-[#46655D]">°</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-1.5 flex-wrap">
                              <div className="flex items-center gap-1">
                                {[-15, -5, 5, 15].map((delta) => (
                                  <button
                                    key={delta}
                                    type="button"
                                    onClick={() => handleSetSingleServoAngle(spec.idx, targetVal + delta)}
                                    disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                                    className="px-2 py-1 rounded-lg bg-[#F2F8F5] hover:bg-violet-50 border border-[#CFE2D9] text-[11px] font-bold font-mono text-[#102A24] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {delta > 0 ? `+${delta}°` : `${delta}°`}
                                  </button>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSetSingleServoAngle(spec.idx, targetVal)}
                                disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                                className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold font-mono cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Terapkan {targetVal}°
                              </button>
                            </div>

                            {spec.idx === 0 && (
                              <div className="pt-2 border-t border-violet-100 flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] font-bold text-[#46655D] mr-1">Arah Sektor:</span>
                                {FLAME_CHANNEL_SPECS.map((ch) => (
                                  <button
                                    key={ch.key}
                                    type="button"
                                    onClick={() => handleSetSingleServoAngle(0, ch.angleDeg)}
                                    disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                                    title={`Arahkan Base J1 ke ${ch.key} (${ch.label} ${ch.angleDeg}°)`}
                                    className="px-2 py-0.5 rounded-md bg-violet-50 hover:bg-violet-100 border border-violet-200 text-[10px] font-bold font-mono text-violet-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {ch.angleDeg}° {ch.shortLabel}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rail L298N, Pompa Manual & Camera Trigger Controls */}
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5"
                    role="group"
                    aria-label="Kontrol Manual Motor Rel L298N, Pompa & Kamera"
                  >
                    <button
                      type="button"
                      onClick={() => handleRailCommand('L')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border shadow-xs bg-[#F2F8F5] hover:bg-emerald-50 text-[#102A24] border-[#CFE2D9] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ArrowLeft size={14} />
                      <span>Rel Kiri (L)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRailCommand('S')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border shadow-xs bg-[#F2F8F5] hover:bg-amber-50 text-[#102A24] border-[#CFE2D9] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Square size={14} />
                      <span>Stop Rel (S)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRailCommand('R')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border shadow-xs bg-[#F2F8F5] hover:bg-emerald-50 text-[#102A24] border-[#CFE2D9] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>Rel Kanan (R)</span>
                      <ArrowRight size={14} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRailCommand('C')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 bg-[#0F766E] hover:bg-[#0D5D57] text-white shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Camera size={14} />
                      <span>Foto CAM (C)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_START_IRRIGATION', 'Nyalakan Pompa Manual', { duration: 4000 })}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed || Boolean(pumpLockout)}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Droplet size={14} />
                      <span>Pompa ON (4s)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_STOP_PUMP', 'Matikan Pompa Manual')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-11 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border bg-white hover:bg-rose-50 text-rose-800 border-rose-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Square size={14} />
                      <span>Matikan Pompa</span>
                    </button>
                  </div>

                  {/* Arm Park & Emergency Stop Controls */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_RETRACT_ARM', 'Tarik Lengan ke Posisi Parkir')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border bg-white hover:bg-[#F2F8F5] text-[#102A24] border-[#CFE2D9] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Crosshair size={14} className="text-sky-600" />
                      <span>Retract Arm (Park)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_PARK_SAFE_ZONE', 'Parkir di Safe Zone')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border bg-white hover:bg-[#F2F8F5] text-[#102A24] border-[#CFE2D9] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ShieldCheck size={14} className="text-emerald-600" />
                      <span>Park Safe Zone</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_EMERGENCY_STOP', 'EMERGENCY STOP DARURAT')}
                      disabled={mqttWssStatus !== 'connected'}
                      className="min-h-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AlertOctagon size={14} />
                      <span>EMERGENCY STOP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dispatchRobotCommand('CMD_RESET_EMERGENCY', 'Reset Emergency Stop')}
                      disabled={mqttWssStatus !== 'connected' || !actuatorArmed}
                      className="min-h-10 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCcw size={14} />
                      <span>Reset E-STOP</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#46655D] uppercase tracking-wider">
                        Command Dispatch
                      </span>
                      <span className="text-xs font-bold text-[#102A24] capitalize">
                        {movementStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#46655D] uppercase tracking-wider">
                        Last Command Sent
                      </span>
                      <span className="text-xs font-bold font-tabular text-[#102A24]">
                        {lastCommand ? `Cmd '${lastCommand}'` : 'None'}
                      </span>
                    </div>
                    <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#46655D] uppercase tracking-wider">
                        Limit Switches
                      </span>
                      <div className="flex items-center gap-2 text-xs font-bold font-tabular">
                        <span className={limitLeft ? 'text-rose-600' : 'text-emerald-700'}>
                          L: {limitLeft ? 'ACTIVE' : 'CLEAR'}
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className={limitRight ? 'text-rose-600' : 'text-emerald-700'}>
                          R: {limitRight ? 'ACTIVE' : 'CLEAR'}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 7. REAL-TIME CONDITION NOTIFICATIONS & ADVISORIES (#treatment) */}
                <section className="scroll-mt-6 sm:scroll-mt-8 flora-card border-t-[3px] border-t-emerald-500 p-5 sm:p-6" id="treatment">
                  <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                    <div>
                      <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                        Real-Time Condition Notifications · Sensor Onboard, BMKG &amp; Vision AI
                      </span>
                      <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display mt-0.5 flex items-center gap-2">
                        <Bell size={18} className="text-[#0F766E] shrink-0" />
                        <span>Pusat Notifikasi &amp; Pemberitahuan Kondisi (Kering · Basah · Kebakaran · Asap Visual)</span>
                      </h2>
                    </div>
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full border ${
                        !isLiveTelemetry || isTelemetryStale || !envCondition
                          ? 'bg-slate-100 text-slate-600 border-slate-200'
                          : envCondition === 'KEBAKARAN' || envCondition === 'ASAP_VISUAL'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : envCondition === 'KERING' || envCondition === 'BASAH' || envCondition === 'FAULT'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}
                    >
                      Status Pemberitahuan: {isLiveTelemetry && !isTelemetryStale && envCondition ? envCondition : 'STANDBY'}
                    </span>
                  </div>

                  {/* Notification Summary Banner (Information Only) */}
                  <div className="bg-gradient-to-r from-[#F2F8F5] to-[#F4F9FC] border border-[#CFE2D9] rounded-xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                        Pemberitahuan Sensor Lapangan Real-Time (Read-Only · Arm Mode Manual)
                      </span>
                      <div className="text-sm sm:text-[15px] font-bold text-[#102A24] mt-0.5 truncate">
                        {isLiveTelemetry && !isTelemetryStale && (commandLabel || envCondition)
                          ? `${envCondition || 'NORMAL'} — ${flameInfo.isFireActive ? flameInfo.detailLabel : commandLabel || 'Kondisi terpantau aman'}`
                          : 'Menunggu pemberitahuan kondisi sensor dari ESP32 Main...'}
                      </div>
                      <span className="text-xs text-[#46655D] block mt-0.5">
                        Kartu ini bersifat informasi notifikasi. Pergerakan derajat Arm 4-DoF &amp; motor rel L298N diatur manual melalui panel kontrol di atas.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => scrollToSection('device-control')}
                      className="shrink-0 px-4 py-2 rounded-xl bg-white hover:bg-[#F2F8F5] text-[#0F766E] border border-[#CFE2D9] font-bold text-xs flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <Sliders size={14} />
                      <span>Ke Kontrol Manual Arm &amp; L298N</span>
                    </button>
                  </div>

                  {/* 4 Notification Cards (Pure Advisories - No Action Buttons) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-2">
                    <div className={`rounded-xl p-4 border border-t-[3px] border-t-amber-500 ${envCondition === 'KERING' && isLiveTelemetry && !isTelemetryStale ? 'bg-amber-50 border-amber-300 shadow-xs' : 'bg-[#FFFDF7] border-amber-200/80'}`}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[13px] font-bold text-[#102A24] flex items-center gap-1.5">
                          <Droplet size={15} className="text-amber-500" />
                          1. KERING (Soil &lt; 35% / Heat Stress)
                        </span>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-bold ${
                          isLiveTelemetry && !isTelemetryStale && (envCondition === 'KERING' || (typeof soilMoisture === 'number' && soilMoisture < 35))
                            ? 'bg-amber-500 text-white animate-pulse'
                            : 'text-amber-800 bg-amber-100/70'
                        }`}>
                          {isLiveTelemetry && !isTelemetryStale && (envCondition === 'KERING' || (typeof soilMoisture === 'number' && soilMoisture < 35))
                            ? 'NOTIFIKASI TERPICU'
                            : bmkgCorrelation.hasRainForecast ? 'BMKG: Potensi Hujan' : 'SIAGA AMAN'}
                        </span>
                      </div>
                      <p className="text-xs text-[#46655D] mb-2.5 m-0 leading-relaxed">
                        Pemberitahuan bila kelembapan tanah turun di bawah 35% atau terjadi heat stress. Pertimbangkan penyiraman manual apabila prakiraan BMKG Sawah Besar tidak menunjukkan hujan.
                      </p>
                      <div className="text-[11px] font-mono bg-white/90 border border-amber-200/80 rounded-lg px-2.5 py-1.5 text-[#102A24] flex items-center justify-between gap-2 flex-wrap">
                        <span>Soil: {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : '--'} · Suhu: {isLiveTelemetry && !isTelemetryStale && typeof temp === 'number' ? `${temp.toFixed(1)}°C` : '--'}</span>
                        <span className="text-amber-800">{bmkgCorrelation.hasRainForecast ? 'BMKG: Hujan diprakirakan' : 'BMKG: Kering'}</span>
                      </div>
                    </div>

                    <div className={`rounded-xl p-4 border border-t-[3px] border-t-emerald-500 ${envCondition === 'BASAH' && isLiveTelemetry && !isTelemetryStale ? 'bg-emerald-50 border-emerald-300 shadow-xs' : 'bg-[#F5FBF8] border-emerald-200/80'}`}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[13px] font-bold text-[#102A24] flex items-center gap-1.5">
                          <ShieldCheck size={15} className="text-emerald-600" />
                          2. BASAH (Soil &gt; 80% / Jenuh Air)
                        </span>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-bold ${
                          isLiveTelemetry && !isTelemetryStale && (envCondition === 'BASAH' || (typeof soilMoisture === 'number' && soilMoisture > 80))
                            ? 'bg-emerald-600 text-white animate-pulse'
                            : 'text-emerald-800 bg-emerald-100/70'
                        }`}>
                          {isLiveTelemetry && !isTelemetryStale && (envCondition === 'BASAH' || (typeof soilMoisture === 'number' && soilMoisture > 80))
                            ? 'NOTIFIKASI TERPICU'
                            : 'SIAGA AMAN'}
                        </span>
                      </div>
                      <p className="text-xs text-[#46655D] mb-2.5 m-0 leading-relaxed">
                        Pemberitahuan kejenuhan air media tanam (&gt;80%). Interlock pompa mengunci irigasi berlebih sementara posisi lengan tetap dalam kendali manual operator.
                      </p>
                      <div className="text-[11px] font-mono bg-white/90 border border-emerald-200/80 rounded-lg px-2.5 py-1.5 text-[#102A24] flex items-center justify-between gap-2 flex-wrap">
                        <span>Soil: {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : '--'} · RH: {isLiveTelemetry && !isTelemetryStale && typeof rh === 'number' ? `${rh.toFixed(0)}%` : '--'}</span>
                        <span className="text-emerald-800">Lockout: {pumpLockout ? 'AKTIF' : 'NONAKTIF'}</span>
                      </div>
                    </div>

                    <div className={`rounded-xl p-4 border border-t-[3px] border-t-rose-500 ${envCondition === 'KEBAKARAN' || flameInfo.isFireActive ? 'bg-rose-50 border-rose-300 shadow-xs' : 'bg-[#FFF8F9] border-rose-200/80'}`}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[13px] font-bold text-[#102A24] flex items-center gap-1.5">
                          <Flame size={15} className="text-rose-600" />
                          3. KEBAKARAN (Flame 5-Ch / Vision Fire)
                        </span>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-bold ${
                          flameInfo.isFireActive || envCondition === 'KEBAKARAN'
                            ? 'bg-rose-600 text-white animate-pulse'
                            : 'text-rose-800 bg-rose-100/70'
                        }`}>
                          {flameInfo.isFireActive ? flameInfo.sectorSummary : envCondition === 'KEBAKARAN' ? 'API TERDETEKSI' : 'SIAGA AMAN'}
                        </span>
                      </div>
                      <p className="text-xs text-[#46655D] mb-2.5 m-0 leading-relaxed">
                        {flameInfo.isFireActive
                          ? `PEMBERITAHUAN DARURAT: ${flameInfo.detailLabel}. Atur derajat Base J1 ke ${flameInfo.targetYawDeg ?? 90}° dan nyalakan pompa manual di panel kontrol bila diperlukan.`
                          : 'Pemberitahuan deteksi nyala api 5 sektor (CH1 P.Kiri s.d. CH5 P.Kanan) dan konfirmasi visual MobileNetV2.'}
                      </p>
                      <div className="text-[11px] font-mono bg-white/90 border border-rose-200/80 rounded-lg px-2.5 py-1.5 text-[#102A24] flex items-center justify-between gap-2 flex-wrap">
                        <span>Arah Flame: {isLiveTelemetry && !isTelemetryStale ? flameInfo.sectorSummary : '--'}</span>
                        <span className="text-rose-800">Angin BMKG: {bmkgStep ? `${bmkgStep.windSpeedKmh} km/h` : '--'}</span>
                      </div>
                    </div>

                    <div className={`rounded-xl p-4 border border-t-[3px] border-t-indigo-500 ${envCondition === 'ASAP_VISUAL' && isLiveTelemetry && !isTelemetryStale ? 'bg-indigo-50 border-indigo-300 shadow-xs' : 'bg-[#F6F8FF] border-indigo-200/80'}`}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[13px] font-bold text-[#102A24] flex items-center gap-1.5">
                          <Wind size={15} className="text-indigo-600" />
                          4. ASAP_VISUAL (Vision Smoke / Angin BMKG)
                        </span>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-bold ${
                          isLiveTelemetry && !isTelemetryStale && envCondition === 'ASAP_VISUAL'
                            ? 'bg-indigo-600 text-white animate-pulse'
                            : 'text-indigo-800 bg-indigo-100/70'
                        }`}>
                          {isLiveTelemetry && !isTelemetryStale && envCondition === 'ASAP_VISUAL' ? 'NOTIFIKASI TERPICU' : 'SIAGA AMAN'}
                        </span>
                      </div>
                      <p className="text-xs text-[#46655D] mb-2.5 m-0 leading-relaxed">
                        Pemberitahuan deteksi asap dari ESP32-CAM MobileNetV2. Operator dapat mengarahkan nozzle kamera secara manual menggunakan slider derajat di panel kontrol atas.
                      </p>
                      <div className="text-[11px] font-mono bg-white/90 border border-indigo-200/80 rounded-lg px-2.5 py-1.5 text-[#102A24] flex items-center justify-between gap-2 flex-wrap">
                        <span>Vision: {wildfireResult ? wildfireResult.predicted_label : edgePrediction || 'Standby'}</span>
                        <span className="text-indigo-800">BMKG Sawah Besar: {bmkgStep ? bmkgStep.weatherDesc : '--'}</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 7B. TREATMENT & IRRIGATION / SUPPRESSION GUIDANCE */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
                  {/* Left: Treatment & Action Guidance */}
                  <section className="flora-card p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-3 gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                            Agronomic &amp; BMKG Decision Support
                          </span>
                          <h2 className="text-base sm:text-lg font-bold text-[#102A24] font-display mt-0.5">
                            Mitigation &amp; Action Guidance (SOP)
                          </h2>
                        </div>
                        <span
                          className={`text-xs font-bold px-3 py-1 rounded-full border shrink-0 ${!isLiveTelemetry || isTelemetryStale || !floraResult
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : floraResult.sensorRisk === 'High'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : floraResult.sensorRisk === 'Moderate'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                        >
                          {isLiveTelemetry && !isTelemetryStale && floraResult ? `${floraResult.sensorRisk} Priority` : 'STANDBY'}
                        </span>
                      </div>

                      <div className="my-3">
                        <span className="text-xs font-bold text-[#102A24] block mb-2 font-display uppercase tracking-wider">
                          Recommended Action Checklist:
                        </span>
                        <ul className="text-xs sm:text-[13px] text-[#102A24] space-y-2 pl-4 list-disc font-medium">
                          {bmkgCorrelation.hasJakartaAlert && (
                            <li className="leading-relaxed text-rose-800">
                              <strong>BMKG Nowcast CAP Aktif (DKI Jakarta):</strong> Pantau peringatan dini cuaca dan amankan perangkat apabila curah hujan lebat berlangsung.
                            </li>
                          )}
                          {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' && soilMoisture < 35 && (
                            <li className="leading-relaxed">
                              <strong>Defisit Kelembapan Tanah ({soilMoisture.toFixed(1)}%):</strong>{' '}
                              {bmkgCorrelation.hasRainForecast
                                ? `BMKG Sawah Besar memprakirakan hujan (${bmkgStep?.precipitationMm ?? 0} mm) — lakukan irigasi singkat secukupnya.`
                                : 'Jalankan CMD_START_IRRIGATION bertahap untuk memulihkan kelembapan perakaran hingga 60%.'}
                            </li>
                          )}
                          {bmkgStep && bmkgStep.windSpeedKmh >= 15 && (
                            <li className="leading-relaxed">
                              <strong>Angin BMKG Sawah Besar ({bmkgStep.windSpeedKmh} km/h):</strong> Sesuaikan arah penyemprotan nozzle terhadap arah angin ({bmkgStep.windDirectionCardinal || 'stabil'}).
                            </li>
                          )}
                          {(!isLiveTelemetry || isTelemetryStale) && (
                            <li className="leading-relaxed text-[#46655D]">
                              Menunggu stream telemetri aktif EMQX WSS (:8084) untuk mengevaluasi sensor lapangan DHT22, Soil v1.2, dan Flame 5-Ch secara live.
                            </li>
                          )}
                          <li className="leading-relaxed">
                            Verifikasi visual berkala menggunakan carriage kamera ESP32-CAM sepanjang rel 1200 mm.
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#D8E7E0]">
                      <p className="text-xs text-[#46655D] leading-relaxed m-0">
                        Rekomendasi disusun otomatis dari output <code className="font-mono text-[#0F766E]">grenvis_sensor_model.h</code>, MobileNetV2 Vision, dan BMKG Sawah Besar.
                      </p>
                    </div>
                  </section>

                  {/* Right: Irrigation & Canopy Cooling Log */}
                  <section className="flora-card p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                          <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                            Irrigation &amp; Soil Hydration Log
                          </span>
                          <span className="text-xs font-tabular text-[#46655D]">
                            Soil: <strong className="text-[#102A24]">{isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number' ? `${soilMoisture.toFixed(1)}%` : 'Unavailable'}</strong> · BMKG:{' '}
                            <strong className="text-[#102A24]">{bmkgStep ? `${bmkgStep.precipitationMm ?? 0} mm` : 'Unavailable'}</strong>
                          </span>
                        </div>
                        <h2 className="text-lg font-bold text-[#102A24] font-display">
                          {isLiveTelemetry && !isTelemetryStale && typeof soilMoisture === 'number'
                            ? (soilMoisture < 35
                              ? 'Attention Needed: Irigasi Direkomendasikan'
                              : soilMoisture > 80
                                ? 'Soil Jenuh Air: Pump Lockout Aktif'
                                : 'Kelembapan Tanah Optimal (35%–80%)')
                            : 'Mitigation Status: Standby Menunggu Telemetri'}
                        </h2>
                        <p className="text-xs sm:text-[13px] text-[#46655D] mt-1 leading-relaxed m-0">
                          Catat tindakan penyiraman atau pendinginan kanopi untuk memperbarui riwayat hidrasi dan log operasional lapangan.
                        </p>
                      </div>

                      {wateringEvents[0] ? (
                        <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3.5 my-3.5">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#46655D]">
                              Last Recorded Wetting Event
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              Recorded
                            </span>
                          </div>
                          <div className="text-sm font-bold font-display text-[#102A24]">
                            {new Date(wateringEvents[0].timestamp).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#46655D] mt-1 font-tabular">
                            <span>Soil Before: {typeof wateringEvents[0].soilBefore === 'number' ? `${wateringEvents[0].soilBefore.toFixed(1)}%` : '--'}</span>
                            <span className="text-slate-300">·</span>
                            <span className="truncate">{wateringEvents[0].note}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-[#F2F8F5] border border-[#CFE2D9] rounded-xl p-3.5 my-3.5 text-center text-xs text-[#46655D]">
                          Belum ada tindakan penyiraman tercatat pada sesi ini.
                        </div>
                      )}

                      <button
                        onClick={handleRecordWatering}
                        aria-label="Catat tindakan penyiraman dan pendinginan kanopi hutan"
                        className="w-full min-h-11 py-2.5 px-4 rounded-xl bg-[#0F766E] hover:bg-[#0D5D57] text-white font-bold text-xs transition-all shadow-xs cursor-pointer active:scale-95 mt-2"
                      >
                        + Catat Penyiraman &amp; Pendinginan Kanopi
                      </button>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[#D8E7E0] text-xs text-[#46655D]">
                      Total kejadian penyiraman tercatat sesi ini: <strong className="text-[#102A24]">{wateringEvents.length}</strong>
                    </div>
                  </section>
                </div>

                {/* 8. HISTORICAL TRENDS CANVAS & SUMMARY */}
                <FloraHistoryCanvas
                  history={history}
                  liveTemp={temp}
                  liveRh={rh}
                  liveSoil={soilMoisture}
                  liveRisk={floraResult?.sensorRisk ?? null}
                  liveVisionPrediction={visionPrediction}
                  liveFlameDetected={flameDetected}
                  liveFlameChannels={flameChannels}
                  liveFlameDirection={flameDirection}
                  liveFlameAngle={flameAngle}
                  bmkgWindKmh={bmkgStep?.windSpeedKmh ?? null}
                  bmkgPrecipMm={bmkgStep?.precipitationMm ?? null}
                  isLive={isLiveTelemetry && !isTelemetryStale}
                />

                {/* 9. SYSTEM & HARDWARE HEALTH TOPOLOGY (#devices) */}
                <section id="devices" className="scroll-mt-6 sm:scroll-mt-8">
                  <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
                    <div>
                      <span className="text-[11px] font-bold text-[#0F766E] uppercase tracking-wider block">
                        Infrastructure Status
                      </span>
                      <h2 className="text-lg sm:text-xl font-extrabold text-[#102A24] font-display">
                        System &amp; Hardware Health Topology
                      </h2>
                    </div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200">
                      Hardware, Cloud &amp; BMKG Topology
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 lg:gap-4">
                    {[
                      {
                        label: 'NodeMCU ESP32-S Main',
                        status: isLiveTelemetry && !isTelemetryStale ? 'ONLINE LIVE' : 'OFFLINE',
                        accent: 'border-t-emerald-500',
                        badge: isLiveTelemetry && !isTelemetryStale ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200',
                        detail: `Direct GPIO · Node: ${activeNodeId || 'ESP32-MAIN'} · ${mqttWssStatus === 'connected' ? 'WSS :8084' : 'SSE Gateway'}`,
                      },
                      {
                        label: 'ESP32-CAM Node',
                        status: gatewayFrameStatus === 'ready' && !gatewayFrameMeta?.isStale ? 'FRAME READY' : 'STANDBY',
                        accent: 'border-t-sky-500',
                        badge: 'bg-sky-50 text-sky-800 border-sky-200',
                        detail: `MAC: F8:B3:B7:A6:F3:9C · POST be-binus-production.up.railway.app/predict/fire`,
                      },
                      {
                        label: 'Railway Vision AI',
                        status: 'ACTIVE (HTTPS)',
                        accent: 'border-t-indigo-500',
                        badge: 'bg-indigo-50 text-indigo-800 border-indigo-200',
                        detail: 'be-binus-production.up.railway.app (MobileNetV2 TFLite · 3-Class)',
                      },
                      {
                        label: 'BMKG Sawah Besar (CAP)',
                        status: bmkgStep ? 'TERHUBUNG' : 'MEMUAT',
                        accent: 'border-t-cyan-500',
                        badge: bmkgStep ? 'bg-cyan-50 text-cyan-800 border-cyan-200' : 'bg-slate-100 text-slate-600 border-slate-200',
                        detail: `adm4: ${bmkgState?.selectedRegion.adm4 || '31.71.02.1001'} · /alerts/nowcast/{id|en}`,
                      },
                      {
                        label: 'EMQX Cloud Broker',
                        status: mqttWssStatus === 'connected' ? 'WSS CONNECTED' : gatewayHealth?.mqttConnected ? 'TLS CONNECTED' : 'STANDBY',
                        accent: 'border-t-teal-500',
                        badge: mqttWssStatus === 'connected' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-teal-50 text-teal-800 border-teal-200',
                        detail: 'q2277711.ala.asia-southeast1.emqxsl.com · MQTTS :8883 & WSS :8084',
                      },
                      {
                        label: 'Lengan Robot 4-DoF Arm',
                        status: systemState || 'STANDBY',
                        accent: 'border-t-violet-500',
                        badge: 'bg-violet-50 text-violet-800 border-violet-200',
                        detail: '4x Servo PWM GPIO 13, 14, 15, 5 (Staged Flame Sweep)',
                      },
                      {
                        label: 'Sensor Onboard Aktif',
                        status: isLiveTelemetry && !isTelemetryStale ? 'STREAMING' : 'OFFLINE',
                        accent: 'border-t-orange-500',
                        badge: isLiveTelemetry && !isTelemetryStale ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-slate-100 text-slate-600 border-slate-200',
                        detail: 'DHT22 (4) · Soil ADC (34) · Flame 5-Ch (25,26,27,32,33)',
                      },
                      {
                        label: 'Fail-Closed Gate & Rel',
                        status: mqttWssStatus === 'connected' && actuatorArmed ? 'ARMED' : 'LOCKED',
                        accent: 'border-t-rose-500',
                        badge: mqttWssStatus === 'connected' && actuatorArmed ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200',
                        detail: 'L298N (16,17) · Limit (18,19) · Pompa Relay (23) · Zona 1-3',
                      },
                    ].map((dev) => (
                      <article
                        key={dev.label}
                        className={`flora-card flora-card-interactive border-t-[3px] ${dev.accent} p-4 flex flex-col justify-between min-h-26`}
                      >
                        <div className="flex justify-between items-center mb-1.5 gap-2">
                          <span className="text-[11px] font-bold text-[#46655D] uppercase tracking-wide truncate">
                            {dev.label}
                          </span>
                          <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${dev.badge}`}>
                            {dev.status}
                          </span>
                        </div>
                        <span className="text-xs sm:text-[13px] font-bold text-[#102A24] block font-display mt-0.5">{dev.label}</span>
                        <span className="text-[11px] font-mono text-[#46655D] block mt-1 truncate" title={dev.detail}>
                          {dev.detail}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* 10. FOOTER */}
            <footer className="mt-12 py-8 border-t border-[#CDE0D7] text-center text-xs text-[#46655D]">
              <div className="flex items-center justify-center gap-2 mb-1.5 flex-wrap">
                <span className="font-bold text-[#102A24] font-display flex items-center gap-1.5">
                  <img src="/agrapatha-logo.png" alt="Logo AGRAPATHA" className="w-4 h-4 object-contain inline-block drop-shadow-xs" />
                  <span>AGRAPATHA</span>
                </span>
                <span>·</span>
                <span>Smart Botanical, Fire Vision &amp; BMKG Meteorology</span>
                <span>·</span>
                <span className="text-[#0F766E] font-semibold">
                  grenvis_sensor_model.h · MobileNetV2 TFLite · BMKG Sawah Besar
                </span>
              </div>
              <p className="text-xs text-[#46655D]/90 max-w-2xl mx-auto leading-relaxed m-0">
                Sistem pendukung keputusan berbasis model neural network botani (<code className="font-mono">grenvis_sensor_model.h</code>), deteksi optik ESP32-CAM (<code className="font-mono">be-binus</code>), serta prakiraan &amp; peringatan dini CAP BMKG Kecamatan Sawah Besar, Jakarta Pusat.
              </p>
            </footer>
          </div>
        </main>

        {/* Toast Notification */}
        <div
          className={`fixed right-6 bottom-6 bg-[#17483B] text-[#DCECE5] border border-[#235849] px-4 py-3 rounded-xl text-xs font-semibold shadow-xl transition-all duration-300 ease-out z-50 pointer-events-none flex items-center gap-2.5 ${toast.visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
            }`}
        >
          <span className="w-2 h-2 rounded-full bg-[#8FBEA8] animate-pulse" />
          <span>{toast.message}</span>
        </div>
      </div>
    </div>
  );
};

export default App;
