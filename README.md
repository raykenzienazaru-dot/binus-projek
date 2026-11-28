# binus-projek

## AGRAPATHA — Autonomous Forest Fire & Microclimate Robotic System

AGRAPATHA is an intelligent environmental monitoring, wildfire detection, and robotic mitigation system combining Edge-AI C neural network inference (`grenvis_sensor_model.h`), BMKG Sawah Besar weather & CAP XML early-warning fusion, EMQX Cloud MQTT over TLS (`8883`) & WebSocket (`8084`), a 4-DoF robotic arm + L298N (`OUT3 & OUT4`) linear slider with terminal & Teach-and-Repeat control, and MobileNetV2 TFLite visual fire/smoke inference.

---

## 1. System Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                AGRAPATHA Web Dashboard                 │
                    │     (React 19 + TypeScript + Vite + Terminal + WSS)    │
                    └───────┬──────────────────────────┬─────────────────────┘
                            │                          │
             ┌──────────────┘                          └──────────────┐
             ▼                                                        ▼
┌──────────────────────────────┐                        ┌──────────────────────────────┐
│   Vision & BMKG Gateways     │                        │   EMQX Cloud Serverless      │
│   Railway MobileNetV2 TFLite │                        │   MQTTS :8883 / WSS :8084    │
│   + BMKG Sawah Besar (CAP)   │                        │   2-Way Telemetry & Commands │
└──────────────▲───────────────┘                        └──────────────┬───────────────┘
               │                                                       │
               │                                                       ▼
┌──────────────┴───────────────┐   ESP-NOW             ┌──────────────────────────────┐
│   ESP32-CAM Node             │◄─────────────────────►│   NodeMCU ESP32-S Main Node  │
│   AI-Thinker OV2640          │                       │   DHT22, Soil ADC, 5-Ch Flame│
│   POST /predict/fire         │                       │   4-DoF Arm, L298N & Pump    │
└──────────────────────────────┘                       └──────────────────────────────┘
```

1. **Dashboard Frontend (`agrapatha-dashboard/`)**: Single-page application providing real-time sensor & 5-channel flame direction monitoring, Botanical ANN analysis, BMKG Sawah Besar forecast & CAP alerts, ESP32-CAM vision inspection, and a Terminal Control console (plus Record / Auto-Loop / Return-to-Origin & Sandbox Test Mode).
2. **Wildfire Vision API (`be-binus`)**: FastAPI + `ai-edge-litert` MobileNetV2 TFLite service serving both the web dashboard and `ESP32-CAM`.
3. **NodeMCU ESP32-S Main Firmware (`firmware/esp32_sensor_main/`)**: Direct-GPIO robotic controller managing DHT22, Capacitive Soil Moisture, 5-channel directional flame array, L298N `OUT3 & OUT4` linear slider (`IN3=2, IN4=16`), pump relay with agricultural lockout/watchdog, 4-DoF servo arm (lazy-attach `500–2400 us`), and bidirectional EMQX MQTTS + Serial terminal commands.
4. **Botanical Neural Kernel (`grenvis_sensor_model.h`)**: Embedded feed-forward ANN (`High` / `Moderate` / `Low`) trained on 9,000 samples of the FLORA Environmental Risk Dataset.

---

## 2. Wildfire Vision Subsystem

The `#cameraCapture` section and `ESP32-CAM` node connect to the inference service:

### Wildfire Classification (`Non-Fire` / `Smoke` / `Fire`)
- **Health Endpoints:** `GET /health` & `GET /api/v1/health`
- **Prediction Endpoints:** `POST /api/v1/predict` (Dashboard) & `POST /predict/fire` / `POST /predict` (ESP32-CAM)
- **Model Architecture:** MobileNetV2 with custom dense classifier head (`agrapatha_vision_mobilenetv2.tflite`)
- **Runtime:** `ai-edge-litert` (Python 3.11)
- **Input Dimensions:** `[1, 224, 224, 3]`, Float32, normalized `[-1.0, 1.0]`
- **Verified Classes:**
  1. `Non-Fire` / `SAFE` (Healthy canopy)
  2. `Smoke` / `SMOKE` (Smoke plume)
  3. `Fire` / `FIRE` (Surface fire)

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

## 4. Hardware Telemetry & MQTT Architecture

- **Protocol Adaptation:**
  - **Browser Dashboard (WSS):** Port `8084` (`wss://<EMQX_HOST>:8084/mqtt`) for browser WebSocket over TLS/SSL.
  - **ESP32 Hardware & Node.js CLI (Native TLS):** Port `8883` (`mqtts://<EMQX_HOST>:8883`).
- **Topic Namespaces:**
  - Telemetry Stream: `agrapatha/telemetry`
  - Interlock, Arm & Slider Commands: `agrapatha/commands`
  - Health & Node Status: `agrapatha/status`

---

## 5. Private Credentials & Configuration Policy

- **No Secrets in Documentation:** Never store `.env` secrets, broker hostnames, Wi-Fi passwords, or MQTT usernames/passwords in `README.md` or public commits.
- **Local Firmware Setup:** Copy `credentials.example.h` to `credentials.h` (git-ignored) inside `firmware/esp32_sensor_main/` and `firmware/esp32_cam_node/` with your own private Wi-Fi, MQTT, and Root CA credentials before flashing.
- **Web & Gateway Runtime:** Supply private environment variables via your hosting dashboard (e.g., Vercel / Railway) or local git-ignored `.env` files (`.env.example` contains placeholders only).

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
