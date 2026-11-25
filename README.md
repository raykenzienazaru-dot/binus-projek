# binus-projek

## AGRAPATHA — Autonomous Forest Fire & Microclimate Robotic System

AGRAPATHA is an intelligent environmental monitoring, wildfire detection, and autonomous robotic mitigation system combining Edge-AI C kernels (`model_hazard.h`, `grenvis_sensor_model.h`), Canadian Forest Fire Weather Index (FWI) telemetry, direct EMQX Cloud MQTT over TLS (`8883`) & WebSocket (`8084`), a 4-DoF robotic arm + linear carriage with VL53L0X ToF ranging, and MobileNetV2 TFLite visual fire/smoke inference hosted on Railway.

---

## 1. System Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                AGRAPATHA Web Dashboard                 │
                    │        (React 19 + TypeScript + Vite + WSS :8084)      │
                    └───────┬──────────────────────────┬─────────────────────┘
                            │                          │
             ┌──────────────┘                          └──────────────┐
             ▼                                                        ▼
┌──────────────────────────────┐                        ┌──────────────────────────────┐
│   Wildfire Vision API        │                        │   EMQX Cloud Serverless      │
│   (FastAPI on Railway)       │                        │   MQTTS :8883 / WSS :8084    │
│   be-binus-production        │                        │   2-Way Telemetry & Commands │
│   MobileNetV2 TFLite         │                        └──────────────┬───────────────┘
└──────────────▲───────────────┘                                       │
               │                                                       ▼
┌──────────────┴───────────────┐   ESP-NOW (CH 0)      ┌──────────────────────────────┐
│   ESP32-CAM Node             │◄─────────────────────►│   NodeMCU ESP32-S Main Node  │
│   AI-Thinker OV2640          │                       │   DHT22, Soil, MQ-135,       │
│   POST /predict/fire         │                       │   5-Ch Flame, VL53L0X ToF,   │
└──────────────────────────────┘                       │   4-DoF Arm, Slider & Pump   │
                                                       └──────────────────────────────┘
```

1. **Dashboard Frontend (`agrapatha-dashboard/`)**: Single-page application providing real-time telemetry gauges, Edge AI C-header analysis, camera capture/gateway frame diagnostics, live EMQX WSS (`:8084`) robot arm & slider control (Fail-Closed Safety Gate), and executable 4-condition mitigation actions (`KERING`, `BASAH`, `KEBAKARAN`, `GAS_BERACUN`).
2. **Wildfire Vision API (`be-binus` on Railway)**: FastAPI + `ai-edge-litert` MobileNetV2 TFLite service deployed at `https://be-binus-production.up.railway.app`, serving both the web dashboard and `ESP32-CAM`.
3. **NodeMCU ESP32-S Main Firmware (`firmware/esp32_sensor_main/`)**: Direct-GPIO robotic controller managing DHT22, Capacitive Soil Moisture, MQ-135 Gas, 5-channel flame array, VL53L0X ToF sensor, L298N 3-zone linear slider, pump relay with agricultural lockout/watchdog, 4-DoF servo arm, and bidirectional EMQX MQTTS (`8883`) telemetry/commands.
4. **Edge AI Kernels**: C-header machine learning models (`model_hazard.h` Random Forest and `grenvis_sensor_model.h` Neural Network) executed directly in memory for instant decision support.

---

## 2. Wildfire Vision Subsystem

The `#cameraCapture` section and `ESP32-CAM` node connect directly to the deployed Railway inference backend:

### Wildfire Classification (`Non-Fire` / `Smoke` / `Fire`)
- **Deployed Backend:** `https://be-binus-production.up.railway.app`
- **Health Endpoints:** `GET /health` & `GET /api/v1/health`
- **Prediction Endpoints:** `POST /api/v1/predict` (Dashboard) & `POST /predict/fire` / `POST /predict` (ESP32-CAM)
- **Model Architecture:** MobileNetV2 with custom dense classifier head (`agrapatha_vision_mobilenetv2.tflite`, 2.68 MB)
- **Runtime:** `ai-edge-litert` (Python 3.11)
- **Input Dimensions:** `[1, 224, 224, 3]`, Float32, normalized `[-1.0, 1.0]`
- **Verified Classes:**
  1. `Non-Fire` / `SAFE` (Healthy canopy)
  2. `Smoke` / `SMOKE` (Smoke plume)
  3. `Fire` / `FIRE` (Surface fire)
- **Frontend Configuration:** Configurable via `VITE_VISION_API_BASE_URL` (defaults to `https://be-binus-production.up.railway.app`).

---

## 3. Manual Camera Fallback Workflow

When an ESP32-CAM hardware stream is unavailable or unverified, the browser-based camera fallback provides immediate manual operation:

1. **Browser Camera Capture:** Uses `navigator.mediaDevices.getUserMedia` with video-only constraints (`audio: false`).
2. **Lifecycle Safety:** Utilizes a callback ref (`setVideoElement`) and reactive state synchronization to guarantee `srcObject` attachment to the mounted `<video>` element, eliminating blank preview screens.
3. **Readiness Check:** Video preview is considered active only when genuine dimensions (`videoWidth > 0 && videoHeight > 0`) are confirmed via metadata listeners before enabling frame capture.
4. **Frame Capture:** Draws the current video frame to an offscreen `<canvas>` and exports a clean JPEG `Blob`. Active camera tracks are terminated immediately upon capture to conserve hardware power.
5. **Image Upload Alternative:** Allows selecting any local image (`accept="image/*"`) with automated MIME type validation and a 10 MB file-size limit.
6. **Memory Hygiene:** Browser object URLs (`URL.createObjectURL`) are systematically revoked upon retake, replacement, or component unmount.

---

## 4. Hardware Telemetry & EMQX MQTT Infrastructure

- **EMQX Broker Host:** `q2277711.ala.asia-southeast1.emqxsl.com` (EMQX Cloud Serverless Cluster)
- **Port Adaptation:**
  - **Browser Dashboard (WSS):** Port `8084` (`wss://q2277711.ala.asia-southeast1.emqxsl.com:8084/mqtt`). Web browsers cannot establish direct TCP connections to port 8883 due to sandbox restrictions, so WebSocket over TLS/SSL is required.
  - **ESP32 Hardware & Node.js CLI (Native TLS):** Port `8883` (`mqtts://q2277711.ala.asia-southeast1.emqxsl.com:8883`). Microcontrollers use native TCP with TLS encryption (configured via `firmware/esp32_emqx_config.h`).
- **Topic Namespaces:**
  - Telemetry Stream: `agrapatha/telemetry` (JSON sensor payload)
  - Interlock & Carriage Commands: `agrapatha/commands`
  - Health & Node Status: `agrapatha/status`
- **Authentication:** EMQX Cloud requires Username/Password authentication (Password-Based Auth created in the EMQX Cloud Console).

---

## 5. Zero-Config Configuration Architecture (No .env Required)

Proyek ini menggunakan arsitektur **Single Source of Truth (`src/config/iotConfig.ts`)** yang dirancang khusus untuk IoT:
- **Zero-Config (Plug & Play):** Tidak membutuhkan file `.env` untuk berjalan. Saat repo di-clone dan dijalankan dengan `npm run dev`, dashboard langsung terhubung ke EMQX Cloud dan Railway API.
- **Hardware Parity:** Konfigurasi web selaras 100% dengan firmware ESP32 (`firmware/esp32_emqx_config.h`).
- **Runtime Persistence (LocalStorage):** Parameter broker atau kredensial dapat diedit langsung melalui modal UI di dashboard tanpa perlu restart server atau edit kode.
- **Optional Env Fallback:** Jika variabel environment (`.env`) ada (misal di pipeline CI/CD), sistem tetap dapat membacanya sebagai prioritas.

| Parameter | Default (Out-of-the-Box) | Deskripsi |
| :--- | :--- | :--- |
| `Broker Host` | `q2277711.ala.asia-southeast1.emqxsl.com` | Host EMQX Cloud Serverless |
| `Browser Port (WSS)` | `8084` | Port WebSocket aman untuk Web Dashboard |
| `Hardware Port (TLS)` | `8883` | Port MQTTS TCP aman untuk ESP32 |
| `Username / Password` | `agrapatha` / `agrapatha123` | Kredensial autentikasi EMQX Cloud |
| `Wildfire API URL` | `https://be-binus-production.up.railway.app` | Backend FastAPI MobileNetV2 (be-binus) |
| `Topic Telemetry` | `agrapatha/telemetry` & `grenvis/sensor/data` | Topik stream data sensor |
| `Topic Control` | `agrapatha/commands` & `grenvis/device/control` | Topik kendali motor rel & trigger foto |

---

## 6. Testing & Build Instructions

### Frontend (`agrapatha-dashboard/`)

```bash
cd agrapatha-dashboard

# Install dependencies
npm install

# Run automated unit tests (BMKG parser + Vision + EMQX MQTT)
npm test

# Run EMQX Broker Diagnostics (Tests Port 8883 TLS & Port 8084 WSS)
npm run test:mqtt

# Run static linter
npm run lint

# Compile TypeScript & production bundle
npm run build

# Start local development server
npm run dev
```

### Backend BMKG Gateway (`backend/`)

```bash
cd backend

# Run gateway automated tests
npm test

# Start local gateway server (port 3000)
npm start
```

---

## 7. License

- AGRAPATHA Core Codebase: MIT License
- PlanTech-AI Model Candidate: MIT License (Copyright 2024 Ahmed Ashraf Helmi)
