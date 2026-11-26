/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — SISTEM ROBOT PERTANIAN CERDAS & PEMADAM KEBAKARAN
 * Unit: NodeMCU ESP32-S (Direct GPIO Servo - 100% SENSOR FISIK ROBOT)
 * ==============================================================================
 * SISTEM PENGAMBIL KEPUTUSAN 4 KONDISI MURNI SENSOR ONBOARD ROBOT:
 * 1. KERING      : Soil < 35% (& Suhu > 32°C) -> PERINTAH: Siram Akar & Semprot Misting.
 * 2. BASAH       : Soil > 80% (Jenuh Air)      -> PERINTAH: Kunci Mati Pompa & Parkir Arm.
 * 3. KEBAKARAN   : Flame 5-Ch / Vision FIRE    -> PERINTAH: Semprot Pemadam & Evakuasi Rel.
 * 4. ASAP VISUAL : ESP32-CAM Vision SMOKE      -> PERINTAH: Arahkan Arm & Verifikasi Ulang.
 *
 * KOMUNIKASI, KEAMANAN & AKTUATOR:
 * - Wi-Fi Auto-Connect + Watchdog (SSID: "." | Pass: "01020304").
 * - EMQX Cloud TLS Port 8883 (q2277711.ala.asia-southeast1.emqxsl.com).
 * - 4 Servo Langsung ke GPIO (13, 14, 15, 5) via ESP32Servo (Catu Daya Eksternal 5V-6V 3A).
 * - Moving Average Filter 5-Sample pada Soil Moisture + DHT22 Interval >= 2000ms.
 * - Linear Slider 3-Zona L298N OUT3 & OUT4 (IN3: GPIO 16, IN4: GPIO 17, ENB: 5V) + Limit SW (18, 19).
 * - Pompa Air Relay (GPIO 23, Active LOW, Glitch-Free Init + Watchdog Timer).
 * - Dual-Way MQTT (`agrapatha/telemetry` & `agrapatha/commands`) + ESP-NOW ke ESP32-CAM.
 * ==============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>

// ======================================================
// 1. PIN DEFINITIONS (NODEMCU ESP32-S / WROOM-32)
// ======================================================
#define DHT_PIN              4    // DHT22 Data
#define DHT_TYPE             DHT22

#define SOIL_ANALOG_PIN      34   // ADC1_CH6 (Capacitive Soil Moisture v1.2, Input Only)

// 4-DoF Robot Arm Servos (Langsung ke Pin GPIO ESP32)
#define SERVO_BASE_PIN       13   // Servo 1: Rotasi Basis (Yaw)
#define SERVO_SHOULDER_PIN   14   // Servo 2: Elevasi Arm (Pitch Bawah)
#define SERVO_ELBOW_PIN      15   // Servo 3: Jangkauan Arm (Pitch Atas / Reach)
#define SERVO_NOZZLE_PIN     5    // Servo 4: Arah Nozzle & Kamera

// Flame Sensor 5-Channel Digital (Active LOW pada modul LM393)
#define FLAME_CH1_PIN        25   // Paling Kiri
#define FLAME_CH2_PIN        26   // Kiri
#define FLAME_CH3_PIN        27   // Tengah
#define FLAME_CH4_PIN        32   // Kanan
#define FLAME_CH5_PIN        33   // Paling Kanan
#define FLAME_ACTIVE_STATE   LOW

// Linear Slider (L298N Driver OUT3 & OUT4 via IN3/IN4 & Limit Switches)
#ifndef MOTOR_IN3
  #define MOTOR_IN3          16   // L298N IN3 -> OUT3 (Arah Kiri)
#endif
#ifndef MOTOR_IN4
  #define MOTOR_IN4          17   // L298N IN4 -> OUT4 (Arah Kanan)
#endif
#ifndef MOTOR_IN1
  #define MOTOR_IN1          MOTOR_IN3
#endif
#ifndef MOTOR_IN2
  #define MOTOR_IN2          MOTOR_IN4
#endif
#define LIMIT_SW_LEFT        18   // Limit Kiri (INPUT_PULLUP, Aktif LOW)
#define LIMIT_SW_RIGHT       19   // Limit Kanan (INPUT_PULLUP, Aktif LOW)

// Pompa Air Relay
#define PUMP_RELAY_PIN       23   // Relay Pompa (Aktif LOW)
#define RELAY_ACTIVE         LOW
#define RELAY_DEACTIVE       HIGH

// ======================================================
// 2. KREDENSIAL JARINGAN & MQTT EMQX CLOUD
// ======================================================
#if __has_include("credentials.h")
  #include "credentials.h"
  #ifdef SECRET_WIFI_SSID
    const char* WIFI_SSID     = SECRET_WIFI_SSID;
    const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
  #else
    const char* WIFI_SSID     = ".";
    const char* WIFI_PASSWORD = "01020304";
  #endif
  #ifdef SECRET_MQTT_USERNAME
    const char* MQTT_USER     = SECRET_MQTT_USERNAME;
    const char* MQTT_PASS     = SECRET_MQTT_PASSWORD;
  #else
    const char* MQTT_USER     = "agrapatha";
    const char* MQTT_PASS     = "agrapatha123";
  #endif
#else
  const char* WIFI_SSID     = ".";
  const char* WIFI_PASSWORD = "01020304";
  const char* MQTT_USER     = "agrapatha";
  const char* MQTT_PASS     = "agrapatha123";
#endif

// EMQX Cloud TLS Broker Connection Information
// Address              : q2277711.ala.asia-southeast1.emqxsl.com
// MQTT over TLS/SSL    : Port 8883 (Digunakan ESP32 via WiFiClientSecure)
// WebSocket over TLS   : Port 8084 (Digunakan Browser Dashboard: wss://...:8084/mqtt)
const char* MQTT_HOST       = "q2277711.ala.asia-southeast1.emqxsl.com";
const uint16_t MQTT_PORT    = 8883;
const uint16_t MQTT_WS_PORT = 8084;

const char* TOPIC_TELEMETRY = "agrapatha/telemetry";
const char* TOPIC_COMMANDS  = "agrapatha/commands"; // Jalur Menerima Perintah dari Dashboard

// ======================================================
// 3. AMBANG BATAS 4 KONDISI SENSOR ONBOARD & WATCHDOG
// ======================================================
#define SOIL_CALIB_DRY          3200
#define SOIL_CALIB_WET          1400

#define THRESH_SOIL_DRY         35.0   // < 35%: KONDISI KERING
#define THRESH_SOIL_WET         80.0   // > 80%: KONDISI BASAH (Jenuh Air)
#define THRESH_SOIL_TARGET      60.0   // Target Ideal Kelembapan Tanah

#define SUPPRESSION_DURATION_MS 4000   // Durasi semprot pemadam per siklus

#define IRRIG_MAX_DURATION_MS   12000  // Maksimal pompa siram aktif (watchdog fail-safe)
#define IRRIG_COOLDOWN_MS       60000  // Cooldown antar penyiraman otomatis
#define SLIDER_MAX_TRAVEL_MS    10000  // Watchdog maksimal waktu tempuh rel

#define DHT_READ_INTERVAL_MS    2200   // Minimum 2 detik sesuai spesifikasi sensor DHT22
#define WIFI_RETRY_INTERVAL_MS  15000
#define MQTT_RETRY_INTERVAL_MS  4000

// ======================================================
// 4. PROTOKOL ESP-NOW DARI/KE ESP32-CAM
// ======================================================
const uint8_t ESP32_CAM_MAC[]  = { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C };
const uint8_t ESP32_MAIN_MAC[] = { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 };

#define PACKET_VISION_RESULT   1
#define PACKET_CAPTURE_REQUEST 5

typedef struct __attribute__((packed)) {
  uint8_t  packetType;
  uint32_t scanNumber;
  char     visionClass[16];   // "FIRE", "SMOKE", "SAFE", "Unknown"
  float    confidence;
  float    fireScore;
  float    smokeScore;
  float    safeScore;
  uint32_t timestampMs;
} CameraAiPacket;

// ======================================================
// 5. OBJEK & STATE MACHINE
// ======================================================
DHT dht(DHT_PIN, DHT_TYPE);

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoNozzle;

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

enum SystemState {
  STATE_INIT,
  STATE_MANUAL,             // Default saat boot: arm & rel diam menunggu kendali derajat/arah manual dari web
  STATE_HOMING,
  STATE_SCANNING_ZONES,
  STATE_IRRIGATING,
  STATE_FIRE_MODE_STAGED,
  STATE_SUPPRESSION_ACTIVE,
  STATE_ALARM_FAULT,
  STATE_EMERGENCY_STOP
};

enum FireSearchStage {
  STAGE_SERVO1_YAW,       // Tahap 1: Orientasi basis kiri/tengah/kanan
  STAGE_SERVO2_PITCH,     // Tahap 2: Ketinggian arm
  STAGE_SERVO3_REACH,     // Tahap 3: Jangkauan maju arm
  STAGE_SERVO4_NOZZLE,    // Tahap 4: Arah presisi nozzle & kamera
  STAGE_VERIFY_FIRE,      // Verifikasi nyala api/visual sebelum pompa aktif
  STAGE_READY_SUPPRESS    // Pompa pemadam aktif
};

SystemState currentState = STATE_INIT;
FireSearchStage currentFireStage = STAGE_SERVO1_YAW;

// Sensor Readings
float currentTemp = 0.0;
float currentHumidity = 0.0;
bool dhtHasValidReading = false;
int rawSoil = 0;
float soilMoisturePct = 0.0;
bool flameCh[5] = {false, false, false, false, false};
int activeFlameCount = 0;
int flameTargetYaw = -1;
char flameDirectionLabel[48] = "AMAN";

// AI Vision
char aiVisionClass[16] = "SAFE";
float aiConfidence = 0.0;
float aiFireScore = 0.0;
float aiSmokeScore = 0.0;
float aiSafeScore = 1.0;
uint32_t aiScanNumber = 0;
unsigned long lastAiResultTime = 0;
bool cameraOnline = false;
volatile bool visionNewFramePending = false;

// Slider Non-Blocking Tracking
int currentZone = 1;
int zoneScanCycles = 0;
bool sliderTransitionActive = false;
bool sliderManualActive = false;
char motorStateStr[16] = "STOPPED";
unsigned long sliderMoveStartTime = 0;
unsigned long sliderManualEndTime = 0;
const unsigned long SLIDER_ZONE2_TRAVEL_MS = 2500;

// Servo Angles & Non-Blocking Scan Step
int angleBase = 90;
int angleShoulder = 45;
int angleElbow = 45;
int angleNozzle = 90;
unsigned long lastFireStageStepTime = 0;

// Timers & Flags
unsigned long lastSensorReadTime = 0;
unsigned long lastDhtReadTime = 0;
unsigned long lastMqttPubTime = 0;
unsigned long lastMqttConnAttempt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long pumpStartTime = 0;
unsigned long commandPumpEndTime = 0;
unsigned long lastIrrigEndTime = 0;
bool pumpActive = false;
bool pumpLockout = false;
bool emergencyStopTriggered = false;
bool armManualMode = true; // Default MANUAL: 4-DoF Arm & Rel tidak bergerak otomatis tanpa perintah web

// ======================================================
// STRUKTUR PERINTAH OPERASIONAL (MURNI SENSOR ROBOT)
// ======================================================
char envCondition[24]        = "NORMAL";       // "KERING", "BASAH", "KEBAKARAN", "ASAP_VISUAL", "NORMAL", "FAULT"
char actionCommand[32]       = "CMD_IDLE";
char commandButtonLabel[80]  = "Sistem Siap";
char commandPayload[96]      = "{\"cmd\":\"NONE\"}";

// ======================================================
// 6. HELPER KENDALI FISIK & SAFETY INTERLOCK
// ======================================================
const char* getSystemStateLabel(SystemState st) {
  switch (st) {
    case STATE_INIT:               return "INIT";
    case STATE_MANUAL:             return "MANUAL";
    case STATE_HOMING:             return "HOMING";
    case STATE_SCANNING_ZONES:     return "SCANNING";
    case STATE_IRRIGATING:         return "IRRIGATING";
    case STATE_FIRE_MODE_STAGED:   return "FIRE_STAGED";
    case STATE_SUPPRESSION_ACTIVE: return "SUPPRESSING";
    case STATE_ALARM_FAULT:        return "ALARM_FAULT";
    case STATE_EMERGENCY_STOP:     return "E_STOP";
    default:                       return "UNKNOWN";
  }
}

int readFilteredAdc(uint8_t pin, uint8_t samples = 5) {
  long sum = 0;
  for (uint8_t i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delayMicroseconds(200);
  }
  return (int)(sum / samples);
}

void moveServoSmooth(Servo &srv, int &currentAngle, int targetAngle, int stepDelay = 6) {
  targetAngle = constrain(targetAngle, 0, 180);
  if (currentAngle == targetAngle) return;
  int step = (targetAngle > currentAngle) ? 1 : -1;
  uint8_t tick = 0;
  while (currentAngle != targetAngle) {
    if (emergencyStopTriggered) break;
    currentAngle += step;
    srv.write(currentAngle);
    delay(stepDelay);
    tick++;
    if ((tick % 10) == 0 && mqttClient.connected()) {
      mqttClient.loop();
    }
  }
}

bool sliderManualIgnoreLimit = false;

void stopSlider() {
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, LOW);
  strncpy(motorStateStr, "STOPPED", sizeof(motorStateStr));
  sliderManualActive = false;
  sliderManualIgnoreLimit = false;
}

bool moveSliderLeft(bool ignoreLimit = false) {
  if (emergencyStopTriggered) {
    stopSlider();
    Serial.println("[SLIDER BLOCKED] E-STOP aktif. Kirim CMD_RESET_EMERGENCY dahulu.");
    return false;
  }
  if (!ignoreLimit && digitalRead(LIMIT_SW_LEFT) == LOW) {
    stopSlider();
    Serial.println("[SLIDER BLOCKED] LIMIT_SW_LEFT (GPIO 18) aktif LOW.");
    return false;
  }
  digitalWrite(MOTOR_IN1, HIGH);
  digitalWrite(MOTOR_IN2, LOW);
  strncpy(motorStateStr, "LEFT", sizeof(motorStateStr));
  return true;
}

bool moveSliderRight(bool ignoreLimit = false) {
  if (emergencyStopTriggered) {
    stopSlider();
    Serial.println("[SLIDER BLOCKED] E-STOP aktif. Kirim CMD_RESET_EMERGENCY dahulu.");
    return false;
  }
  if (!ignoreLimit && digitalRead(LIMIT_SW_RIGHT) == LOW) {
    stopSlider();
    Serial.println("[SLIDER BLOCKED] LIMIT_SW_RIGHT (GPIO 19) aktif LOW.");
    return false;
  }
  digitalWrite(MOTOR_IN1, LOW);
  digitalWrite(MOTOR_IN2, HIGH);
  strncpy(motorStateStr, "RIGHT", sizeof(motorStateStr));
  return true;
}

void setPump(bool state, bool bypassLockoutForFire = false) {
  if (state) {
    if (!emergencyStopTriggered && (!pumpLockout || bypassLockoutForFire)) {
      digitalWrite(PUMP_RELAY_PIN, RELAY_ACTIVE);
      if (!pumpActive) {
        pumpStartTime = millis();
      }
      pumpActive = true;
    } else {
      digitalWrite(PUMP_RELAY_PIN, RELAY_DEACTIVE);
      pumpActive = false;
    }
  } else {
    digitalWrite(PUMP_RELAY_PIN, RELAY_DEACTIVE);
    pumpActive = false;
    commandPumpEndTime = 0;
  }
}

void setEnvironmentalCommand(const char* cond, const char* cmdCode, const char* btnLabel, const char* payload) {
  strncpy(envCondition, cond, sizeof(envCondition) - 1);
  envCondition[sizeof(envCondition) - 1] = '\0';
  strncpy(actionCommand, cmdCode, sizeof(actionCommand) - 1);
  actionCommand[sizeof(actionCommand) - 1] = '\0';
  strncpy(commandButtonLabel, btnLabel, sizeof(commandButtonLabel) - 1);
  commandButtonLabel[sizeof(commandButtonLabel) - 1] = '\0';
  strncpy(commandPayload, payload, sizeof(commandPayload) - 1);
  commandPayload[sizeof(commandPayload) - 1] = '\0';
}

void requestCameraCapture() {
  uint8_t req = PACKET_CAPTURE_REQUEST;
  esp_err_t err = esp_now_send(ESP32_CAM_MAC, &req, 1);
  if (err == ESP_OK) {
    Serial.println("[ESP-NOW] Permintaan capture frame dikirim ke ESP32-CAM.");
  }
}

// ======================================================
// 7. EKSEKUTOR PERINTAH (DITERIMA DARI DASHBOARD)
// ======================================================
void executeDashboardCommand(const char* cmdName, JsonObject& params) {
  Serial.printf("[DASHBOARD PERINTAH] Mengeksekusi: %s\n", cmdName);

  // 0. Reset Darurat (Pemulihan dari Emergency Stop / Alarm Fault)
  if (strcmp(cmdName, "CMD_RESET_EMERGENCY") == 0) {
    emergencyStopTriggered = false;
    pumpLockout = false;
    setPump(false);
    stopSlider();
    currentState = armManualMode ? STATE_MANUAL : STATE_HOMING;
    sliderMoveStartTime = millis();
    Serial.printf("[EKSEKUSI] Emergency Stop & Lockout direset -> Mode %s.\n", armManualMode ? "MANUAL" : "AUTO HOMING");
    return;
  }

  // 0b. Emergency Stop — Prioritas Tertinggi (Selalu dieksekusi instan)
  if (strcmp(cmdName, "CMD_EMERGENCY_STOP") == 0) {
    emergencyStopTriggered = true;
    stopSlider();
    setPump(false);
    sliderTransitionActive = false;
    currentState = STATE_EMERGENCY_STOP;
    Serial.println("[EKSEKUSI] DARURAT: Semua aktuator dihentikan.");
    return;
  }

  // 0c. Ambil Foto ESP32-CAM — Selalu diizinkan untuk pemantauan visual (bahkan saat E-STOP/Lockout)
  if (strcmp(cmdName, "CMD_TRIGGER_CAPTURE") == 0 || strcmp(cmdName, "C") == 0) {
    requestCameraCapture();
    return;
  }

  if (emergencyStopTriggered) {
    Serial.println("[INTERLOCK] Perintah ditolak karena sistem dalam status E-STOP. Kirim CMD_RESET_EMERGENCY dahulu.");
    return;
  }

  // 1. Perintah Terkait Kondisi KERING
  if (strcmp(cmdName, "CMD_START_IRRIGATION") == 0) {
    if (pumpLockout) {
      Serial.println("[INTERLOCK] Pompa sedang terkunci (BASAH). Kirim CMD_UNLOCK_PUMP terlebih dahulu.");
      return;
    }
    unsigned long dur = params["duration"] | IRRIG_MAX_DURATION_MS;
    if (dur > IRRIG_MAX_DURATION_MS) dur = IRRIG_MAX_DURATION_MS;
    setPump(true);
    commandPumpEndTime = millis() + dur;
    currentState = STATE_IRRIGATING;
    Serial.printf("[EKSEKUSI] Pompa irigasi dinyalakan (%lu ms).\n", dur);
  }
  else if (strcmp(cmdName, "CMD_START_MISTING") == 0) {
    if (pumpLockout) {
      Serial.println("[INTERLOCK] Pompa terkunci (BASAH). Misting dibatalkan.");
      return;
    }
    unsigned long dur = params["duration"] | 2500;
    if (dur > 5000) dur = 5000;
    setPump(true);
    commandPumpEndTime = millis() + dur;
    Serial.printf("[EKSEKUSI] Semprotan misting kanopi (%lu ms).\n", dur);
  }

  // 2. Perintah Terkait Kondisi BASAH
  else if (strcmp(cmdName, "CMD_PUMP_LOCKOUT") == 0) {
    pumpLockout = true;
    setPump(false);
    Serial.println("[EKSEKUSI] Pompa DIKUNCI MATI (PUMP LOCKOUT).");
  }
  else if (strcmp(cmdName, "CMD_UNLOCK_PUMP") == 0) {
    pumpLockout = false;
    Serial.println("[EKSEKUSI] Kunci pompa (LOCKOUT) dibuka.");
  }
  else if (strcmp(cmdName, "CMD_PARK_SAFE_ZONE") == 0) {
    stopSlider();
    setPump(false);
    moveServoSmooth(servoBase, angleBase, 90, 6);
    moveServoSmooth(servoShoulder, angleShoulder, 45, 6);
    moveServoSmooth(servoElbow, angleElbow, 45, 6);
    moveServoSmooth(servoNozzle, angleNozzle, 90, 6);
    currentState = armManualMode ? STATE_MANUAL : STATE_HOMING;
    sliderMoveStartTime = millis();
    Serial.println("[EKSEKUSI] Arm diparkir ke sudut netral aman (90/45/45/90 deg).");
  }

  // 3. Perintah Terkait Kondisi KEBAKARAN
  else if (strcmp(cmdName, "CMD_FIRE_SUPPRESSION") == 0) {
    pumpLockout = false;
    unsigned long dur = params["duration"] | SUPPRESSION_DURATION_MS;
    if (dur > 8000) dur = 8000;
    setPump(true, true); // Bypass lockout pertanian khusus keadaan darurat api
    commandPumpEndTime = millis() + dur;
    currentState = STATE_SUPPRESSION_ACTIVE;
    Serial.printf("[EKSEKUSI] Semprotan pemadaman api (%lu ms) diaktifkan.\n", dur);
  }
  else if (strcmp(cmdName, "CMD_FIRE_SCAN_START") == 0) {
    stopSlider();
    requestCameraCapture();
    currentState = STATE_FIRE_MODE_STAGED;
    currentFireStage = STAGE_SERVO1_YAW;
    Serial.println("[EKSEKUSI] Pemindaian bertahap 4-DoF Arm menuju sumber api dimulai.");
  }
  else if (strcmp(cmdName, "CMD_EVACUATE_OPPOSITE") == 0) {
    setPump(false);
    sliderTransitionActive = false;
    sliderManualIgnoreLimit = false;
    if (moveSliderLeft()) {
      sliderManualActive = true;
      sliderManualEndTime = millis() + 2500;
      Serial.println("[EKSEKUSI] Kereta rel dievakuasi ke kiri menjauhi titik panas.");
    }
    lastMqttPubTime = 0;
  }

  // 4. Perintah Verifikasi Asap Visual (ESP32-CAM MobileNetV2 SMOKE)
  else if (strcmp(cmdName, "CMD_VERIFY_SMOKE") == 0) {
    stopSlider();
    requestCameraCapture();
    Serial.println("[EKSEKUSI] Verifikasi ulang citra asap visual via ESP32-CAM.");
  }

  // 5. Kontrol Robot Arm, Slider Manual, & Trigger Kamera
  else if (strcmp(cmdName, "CMD_RETRACT_ARM") == 0) {
    int step = params["step"] | 15;
    int targetElbow = constrain(angleElbow - step, 20, 120);
    int targetShoulder = constrain(angleShoulder - step, 20, 120);
    moveServoSmooth(servoElbow, angleElbow, targetElbow, 6);
    moveServoSmooth(servoShoulder, angleShoulder, targetShoulder, 6);
  }
  else if (strcmp(cmdName, "CMD_SET_ARM_MODE") == 0) {
    bool reqManual = params.containsKey("manual") ? (bool)params["manual"] : true;
    armManualMode = reqManual;
    stopSlider();
    sliderTransitionActive = false;
    if (armManualMode) {
      setPump(false);
      currentState = STATE_MANUAL;
      Serial.println("[EKSEKUSI] Lengan & Rel dialihkan ke MODE MANUAL.");
    } else {
      currentState = STATE_HOMING;
      sliderMoveStartTime = millis();
      Serial.println("[EKSEKUSI] Lengan & Rel dialihkan ke MODE OTOMATIS (Scanning).");
    }
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_ARM_HOME") == 0) {
    stopSlider();
    moveServoSmooth(servoBase, angleBase, 90, 6);
    moveServoSmooth(servoShoulder, angleShoulder, 45, 6);
    moveServoSmooth(servoElbow, angleElbow, 45, 6);
    moveServoSmooth(servoNozzle, angleNozzle, 90, 6);
    Serial.println("[EKSEKUSI] 4-DoF Arm diset ke posisi Home Manual (90/45/45/90 deg).");
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_SET_SERVO") == 0) {
    if (params.containsKey("base"))     moveServoSmooth(servoBase, angleBase, params["base"], 5);
    if (params.containsKey("shoulder")) moveServoSmooth(servoShoulder, angleShoulder, params["shoulder"], 5);
    if (params.containsKey("elbow"))    moveServoSmooth(servoElbow, angleElbow, params["elbow"], 5);
    if (params.containsKey("nozzle"))   moveServoSmooth(servoNozzle, angleNozzle, params["nozzle"], 5);
    Serial.printf("[EKSEKUSI] Sudut Servo Manual -> Base:%d Sh:%d El:%d Noz:%d\n",
                  angleBase, angleShoulder, angleElbow, angleNozzle);
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_STOP_PUMP") == 0) {
    setPump(false);
    if (armManualMode) currentState = STATE_MANUAL;
    Serial.println("[EKSEKUSI] Pompa dimatikan manual.");
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_SLIDER_LEFT") == 0 || strcmp(cmdName, "L") == 0) {
    unsigned long dur = params["duration"] | 3000;
    if (dur < 100) dur = 100;
    if (dur > 15000) dur = 15000;
    bool ignoreLim = params["ignore_limit"] | false;
    sliderTransitionActive = false;
    if (currentState == STATE_ALARM_FAULT) {
      currentState = armManualMode ? STATE_MANUAL : STATE_SCANNING_ZONES;
    }
    if (moveSliderLeft(ignoreLim)) {
      sliderManualIgnoreLimit = ignoreLim;
      sliderManualActive = true;
      sliderManualEndTime = millis() + dur;
      Serial.printf("[EKSEKUSI] L298N Slider KIRI (%lu ms, bypass_limit=%d, GPIO16=HIGH, GPIO17=LOW).\n",
                    dur, ignoreLim ? 1 : 0);
    } else {
      sliderManualActive = false;
      sliderManualIgnoreLimit = false;
    }
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_SLIDER_RIGHT") == 0 || strcmp(cmdName, "R") == 0) {
    unsigned long dur = params["duration"] | 3000;
    if (dur < 100) dur = 100;
    if (dur > 15000) dur = 15000;
    bool ignoreLim = params["ignore_limit"] | false;
    sliderTransitionActive = false;
    if (currentState == STATE_ALARM_FAULT) {
      currentState = armManualMode ? STATE_MANUAL : STATE_SCANNING_ZONES;
    }
    if (moveSliderRight(ignoreLim)) {
      sliderManualIgnoreLimit = ignoreLim;
      sliderManualActive = true;
      sliderManualEndTime = millis() + dur;
      Serial.printf("[EKSEKUSI] L298N Slider KANAN (%lu ms, bypass_limit=%d, GPIO16=LOW, GPIO17=HIGH).\n",
                    dur, ignoreLim ? 1 : 0);
    } else {
      sliderManualActive = false;
      sliderManualIgnoreLimit = false;
    }
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_SLIDER_STOP") == 0 || strcmp(cmdName, "S") == 0) {
    sliderTransitionActive = false;
    stopSlider();
    if (currentState == STATE_ALARM_FAULT && armManualMode) {
      currentState = STATE_MANUAL;
    }
    Serial.println("[EKSEKUSI] L298N Slider BERHENTI (GPIO16=LOW, GPIO17=LOW).");
    lastMqttPubTime = 0;
  }
  else if (strcmp(cmdName, "CMD_TRIGGER_CAPTURE") == 0 || strcmp(cmdName, "C") == 0) {
    requestCameraCapture();
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  char msgBuf[384];
  if (length >= sizeof(msgBuf)) length = sizeof(msgBuf) - 1;
  memcpy(msgBuf, payload, length);
  msgBuf[length] = '\0';
  Serial.printf("[MQTT CMD] Topik=%s Payload=%s\n", topic, msgBuf);

  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, msgBuf);
  if (!err) {
    const char* cmd = doc["cmd"] | doc["command"] | doc["action"] | "";
    JsonObject params = doc["params"].as<JsonObject>();
    if (strlen(cmd) > 0) {
      executeDashboardCommand(cmd, params);
    }
  } else {
    // Fallback untuk perintah teks mentah tunggal L/R/S/C
    if (length == 1) {
      char single[2] = { (char)payload[0], '\0' };
      StaticJsonDocument<64> emptyDoc;
      JsonObject emptyParams = emptyDoc.as<JsonObject>();
      executeDashboardCommand(single, emptyParams);
    }
  }
}

// ======================================================
// 8. SENSOR READING & LOGIKA 4 KONDISI SENSOR ONBOARD
// ======================================================
void readAllSensors() {
  unsigned long now = millis();

  // DHT22 wajib jeda minimal 2 detik agar tidak mengembalikan NaN dan mengganggu PWM servo
  if (now - lastDhtReadTime >= DHT_READ_INTERVAL_MS || !dhtHasValidReading) {
    lastDhtReadTime = now;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h) && t > -40.0 && t < 85.0 && h >= 0.0 && h <= 100.0) {
      currentTemp = t;
      currentHumidity = h;
      dhtHasValidReading = true;
    }
  }

  // Moving Average 5-Sample untuk kestabilan ADC ESP32
  rawSoil = readFilteredAdc(SOIL_ANALOG_PIN, 5);
  float pct = ((float)(SOIL_CALIB_DRY - rawSoil) / (float)(SOIL_CALIB_DRY - SOIL_CALIB_WET)) * 100.0;
  soilMoisturePct = constrain(pct, 0.0, 100.0);

  flameCh[0] = (digitalRead(FLAME_CH1_PIN) == FLAME_ACTIVE_STATE);
  flameCh[1] = (digitalRead(FLAME_CH2_PIN) == FLAME_ACTIVE_STATE);
  flameCh[2] = (digitalRead(FLAME_CH3_PIN) == FLAME_ACTIVE_STATE);
  flameCh[3] = (digitalRead(FLAME_CH4_PIN) == FLAME_ACTIVE_STATE);
  flameCh[4] = (digitalRead(FLAME_CH5_PIN) == FLAME_ACTIVE_STATE);

  const int chAngles[5] = { 30, 60, 90, 120, 150 };
  const char* chNames[5] = { "Paling Kiri", "Kiri", "Tengah", "Kanan", "Paling Kanan" };
  activeFlameCount = 0;
  int yawSum = 0;
  int singleIdx = -1;
  char activeChTag[24] = "";

  for (int i = 0; i < 5; i++) {
    if (flameCh[i]) {
      activeFlameCount++;
      yawSum += chAngles[i];
      singleIdx = i;
      char tag[6];
      snprintf(tag, sizeof(tag), "%sCH%d", (strlen(activeChTag) > 0 ? "+" : ""), i + 1);
      strncat(activeChTag, tag, sizeof(activeChTag) - strlen(activeChTag) - 1);
    }
  }

  cameraOnline = (lastAiResultTime > 0 && (now - lastAiResultTime < 12000));

  // ====================================================
  // MESIN PENENTU PERINTAH MURNI SENSOR ONBOARD & VISION AI
  // ====================================================
  bool aiFire  = (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0  && aiConfidence >= 0.70);
  bool aiSmoke = (cameraOnline && strcmp(aiVisionClass, "SMOKE") == 0 && aiConfidence >= 0.70);

  if (activeFlameCount == 1 && singleIdx >= 0) {
    flameTargetYaw = chAngles[singleIdx];
    snprintf(flameDirectionLabel, sizeof(flameDirectionLabel), "%s (CH%d)", chNames[singleIdx], singleIdx + 1);
  } else if (activeFlameCount > 1) {
    flameTargetYaw = yawSum / activeFlameCount;
    const char* sector = (flameTargetYaw < 78) ? "Sektor Kiri" : (flameTargetYaw > 102) ? "Sektor Kanan" : "Sektor Tengah";
    snprintf(flameDirectionLabel, sizeof(flameDirectionLabel), "%s (%s)", sector, activeChTag);
  } else if (aiFire) {
    flameTargetYaw = angleBase;
    strncpy(flameDirectionLabel, "Api Visual (ESP32-CAM)", sizeof(flameDirectionLabel) - 1);
    flameDirectionLabel[sizeof(flameDirectionLabel) - 1] = '\0';
  } else {
    flameTargetYaw = -1;
    strncpy(flameDirectionLabel, "AMAN", sizeof(flameDirectionLabel) - 1);
    flameDirectionLabel[sizeof(flameDirectionLabel) - 1] = '\0';
  }

  bool isFire  = (activeFlameCount > 0 || aiFire);
  bool isSmoke = (aiSmoke && !isFire);
  bool isWet   = (soilMoisturePct > THRESH_SOIL_WET);
  bool isDry   = (soilMoisturePct < THRESH_SOIL_DRY);

  if (currentState == STATE_ALARM_FAULT || currentState == STATE_EMERGENCY_STOP) {
    // Pertahankan status fault sampai reset operator
    return;
  }

  if (isFire) {
    // 1. KONDISI KEBAKARAN (Flame 5-Ch / Vision FIRE) + Arah Sumber Api
    char fireBtnLabel[80];
    if (flameTargetYaw >= 0) {
      snprintf(fireBtnLabel, sizeof(fireBtnLabel), "PERINTAH: SEMPROT %s (%d deg)", flameDirectionLabel, flameTargetYaw);
    } else {
      strncpy(fireBtnLabel, "PERINTAH: SEMPROT PEMADAMAN DARURAT", sizeof(fireBtnLabel) - 1);
      fireBtnLabel[sizeof(fireBtnLabel) - 1] = '\0';
    }
    setEnvironmentalCommand(
      "KEBAKARAN",
      "CMD_FIRE_SUPPRESSION",
      fireBtnLabel,
      "{\"cmd\":\"CMD_FIRE_SUPPRESSION\",\"params\":{\"duration\":4000}}"
    );
  }
  else if (isSmoke) {
    // 2. KONDISI ASAP VISUAL (ESP32-CAM Vision SMOKE)
    setEnvironmentalCommand(
      "ASAP_VISUAL",
      "CMD_FIRE_SCAN_START",
      "PERINTAH: ARAHKAN ARM & VERIFIKASI ASAP",
      "{\"cmd\":\"CMD_FIRE_SCAN_START\"}"
    );
  }
  else if (isWet) {
    // 3. KONDISI BASAH (Jenuh Air)
    pumpLockout = true;
    setEnvironmentalCommand(
      "BASAH",
      "CMD_PUMP_LOCKOUT",
      "PERINTAH: KUNCI MATI POMPA AIR (LOCKOUT)",
      "{\"cmd\":\"CMD_PUMP_LOCKOUT\"}"
    );
  }
  else if (isDry) {
    // 4. KONDISI KERING
    setEnvironmentalCommand(
      "KERING",
      "CMD_START_IRRIGATION",
      "PERINTAH: EKSEKUSI SIRAM AKAR & KANOPI",
      "{\"cmd\":\"CMD_START_IRRIGATION\"}"
    );
  }
  else {
    if (pumpLockout && soilMoisturePct <= (THRESH_SOIL_WET - 5.0)) {
      pumpLockout = false; // Hysteresis 5% agar tidak berosilasi
    }
    setEnvironmentalCommand(
      "NORMAL",
      "CMD_IDLE",
      "Sistem Normal (Monitoring)",
      "{\"cmd\":\"NONE\"}"
    );
  }
}

// ======================================================
// 9. ESP-NOW WIRELESS RECEIVER
// ======================================================
void onEspNowDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  if (len == sizeof(CameraAiPacket)) {
    CameraAiPacket packet;
    memcpy(&packet, incomingData, sizeof(CameraAiPacket));
    if (packet.packetType == PACKET_VISION_RESULT) {
      strncpy(aiVisionClass, packet.visionClass, sizeof(aiVisionClass) - 1);
      aiVisionClass[sizeof(aiVisionClass) - 1] = '\0';
      aiConfidence = packet.confidence;
      aiFireScore  = packet.fireScore;
      aiSmokeScore = packet.smokeScore;
      aiSafeScore  = packet.safeScore;
      aiScanNumber = packet.scanNumber;
      lastAiResultTime = millis();
      visionNewFramePending = true;
    }
  }
}

// ======================================================
// 10. FIRE MODE STAGED (NON-BLOCKING 4-DOF SERVO REACH)
// ======================================================
void handleFireModeStaged() {
  if (pumpActive && currentState != STATE_SUPPRESSION_ACTIVE) {
    setPump(false);
  }
  stopSlider();

  unsigned long now = millis();
  if (now - lastFireStageStepTime < 25) return;
  lastFireStageStepTime = now;

  switch (currentFireStage) {
    case STAGE_SERVO1_YAW: {
      int targetYaw = (flameTargetYaw >= 0) ? constrain(flameTargetYaw, 30, 150) : 90;

      if (angleBase != targetYaw) {
        angleBase += (targetYaw > angleBase) ? 2 : -2;
        if (abs(targetYaw - angleBase) <= 2) angleBase = targetYaw;
        servoBase.write(constrain(angleBase, 0, 180));
      } else {
        requestCameraCapture(); // Trigger foto saat menghadap sumber api
        currentFireStage = STAGE_SERVO2_PITCH;
      }
      break;
    }

    case STAGE_SERVO2_PITCH: {
      const int targetShoulder = 70;
      if (angleShoulder != targetShoulder) {
        angleShoulder += (targetShoulder > angleShoulder) ? 2 : -2;
        if (abs(targetShoulder - angleShoulder) <= 2) angleShoulder = targetShoulder;
        servoShoulder.write(constrain(angleShoulder, 0, 180));
      } else {
        currentFireStage = STAGE_SERVO3_REACH;
      }
      break;
    }

    case STAGE_SERVO3_REACH: {
      const int targetElbow = 75;
      if (angleElbow < targetElbow) {
        angleElbow += 2;
        if (angleElbow > targetElbow) angleElbow = targetElbow;
        servoElbow.write(constrain(angleElbow, 0, 180));
      } else {
        currentFireStage = STAGE_SERVO4_NOZZLE;
      }
      break;
    }

    case STAGE_SERVO4_NOZZLE: {
      const int targetNozzle = 90;
      if (angleNozzle != targetNozzle) {
        angleNozzle += (targetNozzle > angleNozzle) ? 2 : -2;
        if (abs(targetNozzle - angleNozzle) <= 2) angleNozzle = targetNozzle;
        servoNozzle.write(constrain(angleNozzle, 0, 180));
      } else {
        currentFireStage = STAGE_VERIFY_FIRE;
      }
      break;
    }

    case STAGE_VERIFY_FIRE: {
      bool visualConfirmed = (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0 && aiConfidence >= 0.70);
      bool flameConfirmed  = (activeFlameCount > 0);

      if (visualConfirmed || flameConfirmed) {
        currentFireStage = STAGE_READY_SUPPRESS;
        currentState = STATE_SUPPRESSION_ACTIVE;
        setPump(true, true); // Bypass agricultural lockout saat api terverifikasi
      } else {
        requestCameraCapture();
        currentState = STATE_SCANNING_ZONES;
      }
      break;
    }

    default:
      break;
  }
}

// ======================================================
// 11. KONEKSI WIFI & SETUP
// ======================================================
const char* wifiStatusToText(wl_status_t st) {
  switch (st) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL (SSID '.' tidak terlihat - cek 2.4GHz vs 5GHz)";
    case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED (Password salah / ditolak WPA3/PMF)";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED (Handshake gagal / Timeout)";
    default:                 return "UNKNOWN";
  }
}

void printWifiScanDiagnostics() {
  Serial.printf("[WiFi DIAG] Status=%d (%s)\n", (int)WiFi.status(), wifiStatusToText(WiFi.status()));
  Serial.println("[WiFi DIAG] Memindai jaringan Wi-Fi 2.4 GHz di sekitar...");
  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("[WiFi DIAG] Tidak ada Wi-Fi 2.4 GHz yang terdeteksi! (Pastikan Hotspot HP aktif di band 2.4 GHz, bukan 5 GHz).");
  } else {
    bool foundTarget = false;
    for (int i = 0; i < n; i++) {
      String foundSsid = WiFi.SSID(i);
      if (foundSsid == WIFI_SSID) foundTarget = true;
      Serial.printf("  [%d] '%s' (len=%d, RSSI=%d dBm, Ch=%d, Auth=%d)\n",
                    i + 1, foundSsid.c_str(), foundSsid.length(),
                    WiFi.RSSI(i), WiFi.channel(i), (int)WiFi.encryptionType(i));
    }
    if (!foundTarget) {
      Serial.printf("[WiFi DIAG] Target SSID '%s' (len=%d) TIDAK ADA di hasil scan 2.4 GHz! Cek band 2.4 GHz atau spasi tersembunyi di nama SSID.\n",
                    WIFI_SSID, strlen(WIFI_SSID));
    }
  }
  WiFi.scanDelete();
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttempt < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttempt = now;

  Serial.printf("[WiFi] Menghubungkan ulang ke SSID '%s' (status=%d: %s)...\n",
                WIFI_SSID, (int)WiFi.status(), wifiStatusToText(WiFi.status()));
  WiFi.disconnect(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[AGRAPATHA] Inisialisasi Robot Cerdas (Murni Sensor Onboard)...");

  // Glitch-free Relay Initialization (Write DEACTIVE before setting OUTPUT)
  digitalWrite(PUMP_RELAY_PIN, RELAY_DEACTIVE);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pumpActive = false;

  pinMode(LIMIT_SW_LEFT, INPUT_PULLUP);
  pinMode(LIMIT_SW_RIGHT, INPUT_PULLUP);
  pinMode(MOTOR_IN1, OUTPUT);
  pinMode(MOTOR_IN2, OUTPUT);
  stopSlider();

  pinMode(FLAME_CH1_PIN, INPUT);
  pinMode(FLAME_CH2_PIN, INPUT);
  pinMode(FLAME_CH3_PIN, INPUT);
  pinMode(FLAME_CH4_PIN, INPUT);
  pinMode(FLAME_CH5_PIN, INPUT);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  servoBase.setPeriodHertz(50);
  servoShoulder.setPeriodHertz(50);
  servoElbow.setPeriodHertz(50);
  servoNozzle.setPeriodHertz(50);

  servoBase.attach(SERVO_BASE_PIN, 500, 2500);
  servoShoulder.attach(SERVO_SHOULDER_PIN, 500, 2500);
  servoElbow.attach(SERVO_ELBOW_PIN, 500, 2500);
  servoNozzle.attach(SERVO_NOZZLE_PIN, 500, 2500);

  servoBase.write(angleBase);
  servoShoulder.write(angleShoulder);
  servoElbow.write(angleElbow);
  servoNozzle.write(angleNozzle);

  dht.begin();

  // Wi-Fi Station Mode murni agar asosiasi & scan 2.4 GHz stabil (ESP-NOW aktif bersama AP)
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(100);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke '%s' (len=%d)", WIFI_SSID, strlen(WIFI_SSID));

  unsigned long wifiWaitStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiWaitStart < 12000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi OK] IP: %s | Channel: %d | RSSI: %d dBm | MAC: %s\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel(), WiFi.RSSI(), WiFi.macAddress().c_str());
  } else {
    Serial.println("[WiFi WARN] Belum terhubung saat boot, menjalankan diagnosa scan 2.4 GHz...");
    printWifiScanDiagnostics();
  }
  lastWifiAttempt = millis();

  // ESP-NOW Setup & Peer Registration ke ESP32-CAM
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onEspNowDataRecv);
    esp_now_peer_info_t camPeer = {};
    memcpy(camPeer.peer_addr, ESP32_CAM_MAC, 6);
    camPeer.channel = 0; // Mengikuti channel Wi-Fi aktif
    camPeer.encrypt = false;
    if (esp_now_add_peer(&camPeer) == ESP_OK) {
      Serial.println("[ESP-NOW OK] Peer ESP32-CAM terdaftar.");
    }
  } else {
    Serial.println("[ESP-NOW ERROR] Gagal inisialisasi ESP-NOW.");
  }

  secureClient.setInsecure();
  secureClient.setTimeout(5000);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1280); // Alokasi buffer 1280 bytes agar payload JSON + arah flame tidak terpotong
  mqttClient.setKeepAlive(60);
  mqttClient.setCallback(onMqttMessage);

  currentState = armManualMode ? STATE_MANUAL : STATE_HOMING;
  sliderMoveStartTime = millis();
  Serial.printf("[MODE BOOT] Sistem siap dalam mode %s (Servo Idle: Base=%d Sh=%d El=%d Noz=%d deg).\n",
                armManualMode ? "MANUAL ARM" : "AUTO HOMING",
                angleBase, angleShoulder, angleElbow, angleNozzle);
}

// ======================================================
// 12. MAIN LOOP (NON-BLOCKING & FAIL-SAFE)
// ======================================================
void loop() {
  unsigned long now = millis();

  ensureWiFiConnected();

  // 1. Layani MQTT loop sesering mungkin agar E-STOP responsif instan
  if (mqttClient.connected()) {
    mqttClient.loop();
  } else if (WiFi.status() == WL_CONNECTED && (now - lastMqttConnAttempt >= MQTT_RETRY_INTERVAL_MS)) {
    lastMqttConnAttempt = now;
    String clientId = "AgrapathaMainESP32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("[MQTT] Terhubung ke EMQX Cloud TLS Broker (Port 8883)!");
      mqttClient.subscribe(TOPIC_COMMANDS);
      mqttClient.subscribe("grenvis/device/control");
      Serial.printf("[MQTT] Subscribe perintah: %s & grenvis/device/control\n", TOPIC_COMMANDS);
    } else {
      Serial.printf("[MQTT] Gagal terhubung ke broker, rc=%d\n", mqttClient.state());
    }
  }

  // 2. Watchdog Timer Aktuator Manual & Durasi Maksimal Pompa (Anti-Run-Dry)
  if (pumpActive && commandPumpEndTime > 0 && now >= commandPumpEndTime) {
    setPump(false);
    if (currentState == STATE_IRRIGATING || currentState == STATE_SUPPRESSION_ACTIVE) {
      lastIrrigEndTime = now;
      currentState = armManualMode ? STATE_MANUAL : STATE_SCANNING_ZONES;
    }
    Serial.println("[WATCHDOG] Durasi pompa perintah selesai -> Pompa dimatikan otomatis.");
  }
  if (pumpActive && (now - pumpStartTime >= IRRIG_MAX_DURATION_MS)) {
    setPump(false);
    lastIrrigEndTime = now;
    if (currentState == STATE_IRRIGATING || currentState == STATE_SUPPRESSION_ACTIVE) {
      currentState = armManualMode ? STATE_MANUAL : STATE_SCANNING_ZONES;
    }
    Serial.println("[WATCHDOG] Batas maksimum durasi pompa tercapai -> Safety Shutoff.");
  }
  if (sliderManualActive) {
    if (!sliderManualIgnoreLimit &&
        ((strcmp(motorStateStr, "LEFT") == 0 && digitalRead(LIMIT_SW_LEFT) == LOW) ||
         (strcmp(motorStateStr, "RIGHT") == 0 && digitalRead(LIMIT_SW_RIGHT) == LOW))) {
      stopSlider();
      lastMqttPubTime = 0;
      Serial.println("[WATCHDOG] Limit switch tercapai saat gerak manual -> Slider dihentikan.");
    } else if (now >= sliderManualEndTime) {
      stopSlider();
      lastMqttPubTime = 0;
      Serial.println("[WATCHDOG] Gerakan manual slider selesai.");
    }
  }

  // 3. Proteksi Ganda Limit Switch
  if (digitalRead(LIMIT_SW_LEFT) == LOW && digitalRead(LIMIT_SW_RIGHT) == LOW) {
    if (!(sliderManualActive && sliderManualIgnoreLimit)) {
      if (!armManualMode || strcmp(motorStateStr, "STOPPED") != 0) {
        stopSlider();
        setPump(false);
        currentState = STATE_ALARM_FAULT;
        setEnvironmentalCommand(
          "FAULT",
          "CMD_EMERGENCY_STOP",
          "PERINTAH: HENTIKAN MOTOR (LIMIT SWITCH GANDA)",
          "{\"cmd\":\"CMD_EMERGENCY_STOP\"}"
        );
      }
      static unsigned long lastDualLimitWarn = 0;
      if (now - lastDualLimitWarn >= 10000) {
        lastDualLimitWarn = now;
        Serial.println("[WARN] LIMIT_SW_LEFT (GPIO 18) & LIMIT_SW_RIGHT (GPIO 19) keduanya LOW! Cek switch Normally-Open atau aktifkan Bypass Limit di web.");
      }
    }
  }

  // 4. Baca Sensor Rutin & Evaluasi 4 Kondisi Tiap 250ms
  if (now - lastSensorReadTime >= 250) {
    lastSensorReadTime = now;
    readAllSensors();

    bool flameDetected = (activeFlameCount > 0);
    bool aiFire = (cameraOnline && strcmp(aiVisionClass, "FIRE") == 0 && aiConfidence >= 0.70);

    if (!armManualMode &&
        (flameDetected || aiFire) &&
        currentState != STATE_FIRE_MODE_STAGED &&
        currentState != STATE_SUPPRESSION_ACTIVE &&
        currentState != STATE_ALARM_FAULT &&
        currentState != STATE_EMERGENCY_STOP) {

      stopSlider();
      sliderTransitionActive = false;
      requestCameraCapture();
      currentState = STATE_FIRE_MODE_STAGED;
      currentFireStage = STAGE_SERVO1_YAW;
    }
  }

  // 5. State Machine Non-Blocking (STATE_MANUAL diam menunggu kendali web)
  if (!sliderManualActive) {
    switch (currentState) {
      case STATE_MANUAL:
        break;
      case STATE_HOMING:
        if (digitalRead(LIMIT_SW_LEFT) == LOW) {
          stopSlider();
          currentZone = 1;
          zoneScanCycles = 0;
          sliderTransitionActive = false;
          currentState = STATE_SCANNING_ZONES;
        } else if (now - sliderMoveStartTime >= SLIDER_MAX_TRAVEL_MS) {
          stopSlider();
          currentState = STATE_ALARM_FAULT;
          setEnvironmentalCommand("FAULT", "CMD_RESET_EMERGENCY", "TIMEOUT HOMING REL", "{\"cmd\":\"CMD_RESET_EMERGENCY\"}");
        } else {
          moveSliderLeft();
        }
        break;

      case STATE_SCANNING_ZONES:
        if (sliderTransitionActive) {
          if (currentZone == 1) {
            if (now - sliderMoveStartTime >= SLIDER_ZONE2_TRAVEL_MS || digitalRead(LIMIT_SW_RIGHT) == LOW) {
              stopSlider();
              sliderTransitionActive = false;
              currentZone = 2;
            } else {
              moveSliderRight();
            }
          } else if (currentZone == 2) {
            if (digitalRead(LIMIT_SW_RIGHT) == LOW) {
              stopSlider();
              sliderTransitionActive = false;
              currentZone = 3;
            } else if (now - sliderMoveStartTime >= SLIDER_MAX_TRAVEL_MS) {
              stopSlider();
              sliderTransitionActive = false;
              currentState = STATE_HOMING;
              sliderMoveStartTime = now;
            } else {
              moveSliderRight();
            }
          }
        } else {
          if (zoneScanCycles < 3) {
            // Pemindaian halus nozzle tanpa memblokir loop lama
            static unsigned long lastSweepTime = 0;
            static int sweepStep = 0;
            if (now - lastSweepTime >= 350) {
              lastSweepTime = now;
              const int sweepTargets[3] = { 65, 115, 90 };
              angleNozzle = sweepTargets[sweepStep];
              servoNozzle.write(angleNozzle);
              sweepStep++;
              if (sweepStep >= 3) {
                sweepStep = 0;
                zoneScanCycles++;
              }
            }
          } else {
            zoneScanCycles = 0;
            if (currentZone == 1 || currentZone == 2) {
              sliderTransitionActive = true;
              sliderMoveStartTime = now;
            } else {
              currentState = STATE_HOMING;
              sliderMoveStartTime = now;
            }
          }

          // Logika Penyiraman Otomatis (Jika tidak dikunci oleh kondisi basah)
          if (!pumpLockout && soilMoisturePct < THRESH_SOIL_DRY && (now - lastIrrigEndTime > IRRIG_COOLDOWN_MS)) {
            currentState = STATE_IRRIGATING;
            setPump(true);
          }
        }
        break;

      case STATE_IRRIGATING:
        if (pumpLockout || soilMoisturePct >= THRESH_SOIL_TARGET || (now - pumpStartTime >= IRRIG_MAX_DURATION_MS)) {
          setPump(false);
          lastIrrigEndTime = now;
          currentState = armManualMode ? STATE_MANUAL : STATE_SCANNING_ZONES;
        }
        break;

      case STATE_FIRE_MODE_STAGED:
        handleFireModeStaged();
        break;

      case STATE_SUPPRESSION_ACTIVE:
        if (now - pumpStartTime >= SUPPRESSION_DURATION_MS) {
          setPump(false);
          readAllSensors();

          if (activeFlameCount == 0 && strcmp(aiVisionClass, "FIRE") != 0) {
            moveServoSmooth(servoShoulder, angleShoulder, 45, 6);
            moveServoSmooth(servoElbow, angleElbow, 45, 6);
            moveServoSmooth(servoBase, angleBase, 90, 6);
            currentState = armManualMode ? STATE_MANUAL : STATE_HOMING;
            sliderMoveStartTime = millis();
          } else {
            currentState = STATE_ALARM_FAULT;
            setEnvironmentalCommand(
              "KEBAKARAN",
              "CMD_FIRE_SUPPRESSION",
              "API MASIH AKTIF: ULANGI PEMADAMAN",
              "{\"cmd\":\"CMD_FIRE_SUPPRESSION\",\"params\":{\"duration\":4000}}"
            );
          }
        }
        break;

      case STATE_ALARM_FAULT:
      case STATE_EMERGENCY_STOP:
        stopSlider();
        setPump(false);
        break;

      default:
        break;
    }
  }

  // 6. Publikasi Telemetri ke Dashboard Tiap 1 Detik
  if (now - lastMqttPubTime >= 1000) {
    lastMqttPubTime = now;
    if (mqttClient.connected()) {
      char jsonBuf[960];
      int written = snprintf(jsonBuf, sizeof(jsonBuf),
        "{"
        "\"temperature\":%.2f,"
        "\"humidity\":%.2f,"
        "\"soil_moisture\":%.2f,"
        "\"soil_raw\":%d,"
        "\"flame_detected\":%d,"
        "\"flame_ch\":[%d,%d,%d,%d,%d],"
        "\"flame_direction\":\"%s\","
        "\"flame_angle\":%d,"
        "\"zone\":%d,"
        "\"motor_state\":\"%s\","
        "\"motor_driver\":\"L298N_OUT3_OUT4\","
        "\"limit_left\":%s,"
        "\"limit_right\":%s,"
        "\"pump_status\":%s,"
        "\"pump_lockout\":%s,"
        "\"arm_manual_mode\":%s,"
        "\"servo_angles\":[%d,%d,%d,%d],"
        "\"system_state\":\"%s\","
        "\"uptime_seconds\":%lu,"
        "\"vision_prediction\":\"%s\","
        "\"vision_confidence\":%.2f,"
        "\"vision_scan\":%lu,"
        "\"image_ready\":%s,"
        "\"env_condition\":\"%s\","
        "\"action_command\":\"%s\","
        "\"command_label\":\"%s\","
        "\"command_payload\":%s"
        "}",
        currentTemp, currentHumidity, soilMoisturePct, rawSoil,
        (activeFlameCount > 0 ? 1 : 0),
        flameCh[0] ? 1 : 0, flameCh[1] ? 1 : 0, flameCh[2] ? 1 : 0, flameCh[3] ? 1 : 0, flameCh[4] ? 1 : 0,
        flameDirectionLabel, flameTargetYaw,
        currentZone, motorStateStr,
        (digitalRead(LIMIT_SW_LEFT) == LOW) ? "true" : "false",
        (digitalRead(LIMIT_SW_RIGHT) == LOW) ? "true" : "false",
        pumpActive ? "true" : "false",
        pumpLockout ? "true" : "false",
        armManualMode ? "true" : "false",
        angleBase, angleShoulder, angleElbow, angleNozzle,
        getSystemStateLabel(currentState),
        (unsigned long)(now / 1000UL),
        aiVisionClass, aiConfidence * 100.0f,
        (unsigned long)aiScanNumber,
        visionNewFramePending ? "true" : "false",
        envCondition, actionCommand, commandButtonLabel, commandPayload
      );
      if (written > 0 && written < (int)sizeof(jsonBuf)) {
        mqttClient.publish(TOPIC_TELEMETRY, jsonBuf);
        visionNewFramePending = false;
      }
    }
  }
}
