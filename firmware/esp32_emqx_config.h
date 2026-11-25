/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — HARDWARE & CLOUD CONFIGURATION HEADER
 * Target: ESP32 DevKit V1 & AI-Thinker ESP32-CAM
 * ==============================================================================
 * PORT MAPPING SPECIFICATION:
 * - ESP32 Hardware (MQTTS Native TCP over TLS): PORT 8883
 * - Web Browser Dashboard (WSS over TLS): PORT 8084
 * ==============================================================================
 */

#ifndef AGRAPATHA_HARDWARE_CONFIG_H
#define AGRAPATHA_HARDWARE_CONFIG_H

// --- 1. Wi-Fi Network Credentials (Decoupled) ---
// NOTE: Wi-Fi credentials must be supplied via sketch-local credentials.h
// (e.g., firmware/esp32_sensor_main/credentials.h or firmware/esp32_cam_node/credentials.h).
// Do not hardcode or commit Wi-Fi credentials here.

// --- 2. EMQX Cloud Settings (Port 8883 Native TLS & Port 8084 WSS) ---
#define MQTT_BROKER_HOST        "q2277711.ala.asia-southeast1.emqxsl.com"
#define MQTT_TLS_PORT           8883
#define MQTT_WS_PORT            8084
#define MQTT_DEFAULT_USER       "agrapatha"
#define MQTT_DEFAULT_PASS       "agrapatha123"
// NOTE: MQTT authentication credentials (SECRET_MQTT_USERNAME & SECRET_MQTT_PASSWORD)
// must be supplied via sketch-local credentials.h. Do not commit credentials here.

// --- 3. MQTT Topic Namespaces ---
#define TOPIC_TELEMETRY_DATA    "grenvis/sensor/data"
#define TOPIC_TELEMETRY_AGRA    "agrapatha/telemetry"
#define TOPIC_STATUS            "grenvis/sensor/status"
#define TOPIC_VISION_DATA       "grenvis/vision/data"
#define TOPIC_VISION_IMAGE      "grenvis/vision/image"
#define TOPIC_CONTROL_GRENVIS   "grenvis/device/control"
#define TOPIC_CONTROL_AGRA      "agrapatha/commands"

// --- 4. ESP32 Main Node Sensor Pins (Confirmed Hardware) ---
#define PIN_DHT                 19 // DHT22 (Air Temp & RH) - Confirmed
#define PIN_SOIL                34 // Capacitive Soil Moisture v1.2 (ADC1_CH6) - Confirmed

// NOTE: Flame Sensor GPIO assignments (sensor MQ-135 & VL53L0X telah dinonaktifkan).
// Hardware aktif pada esp32_sensor_main.ino menggunakan Array Flame 5-Channel (LM393 Active-LOW):
// - CH1 (Paling Kiri  ·  30°): GPIO 25
// - CH2 (Kiri         ·  60°): GPIO 26
// - CH3 (Tengah       ·  90°): GPIO 27
// - CH4 (Kanan        · 120°): GPIO 32
// - CH5 (Paling Kanan · 150°): GPIO 33
#ifndef FLAME_SENSOR_USE_ANALOG
  #define FLAME_SENSOR_USE_ANALOG 0
#endif

#ifndef PIN_FLAME_CH1
  #define PIN_FLAME_CH1         25 // Paling Kiri
  #define PIN_FLAME_CH2         26 // Kiri
  #define PIN_FLAME_CH3         27 // Tengah
  #define PIN_FLAME_CH4         32 // Kanan
  #define PIN_FLAME_CH5         33 // Paling Kanan
#endif

#ifndef PIN_FLAME_DO
  #define PIN_FLAME_DO          PIN_FLAME_CH3 // Kanal tengah default
#endif

#define PIN_FLAME               PIN_FLAME_DO // Default alias

// Flame Sensor Polarity: 1 if active-LOW (typical LM393 DO module: LOW when flame detected), 0 if active-HIGH
#ifndef FLAME_ACTIVE_LOW
  #define FLAME_ACTIVE_LOW      1
#endif

// --- 5. ESP32 Main Node Actuator & Limit Pins (L298N OUT3 & OUT4) ---
#define PIN_MOTOR_IN3           16 // L298N IN1/IN3 (Arah Kiri Rel)
#define PIN_MOTOR_IN4           17 // L298N IN2/IN4 (Arah Kanan Rel)
#define PIN_MOTOR_IN1           PIN_MOTOR_IN3 // Legacy alias
#define PIN_MOTOR_IN2           PIN_MOTOR_IN4 // Legacy alias
#define PIN_LIMIT_LEFT          18 // Limit Switch Left (INPUT_PULLUP, Active LOW)
#define PIN_LIMIT_RIGHT         19 // Limit Switch Right (INPUT_PULLUP, Active LOW)

// --- 6. Railway Cloud AI Inference API ---
#define RAILWAY_AI_HOST         "be-binus-production.up.railway.app"
#define RAILWAY_AI_PATH         "/predict/fire"

// --- 7. ESP-NOW Hardware MAC Addresses ---
#define MAC_ESP32_MAIN          { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 }
#define MAC_ESP32_CAM           { 0xF8, 0xB3, 0xB7, 0xA6, 0xF3, 0x9C }
#define DEFAULT_WIFI_CHANNEL    6

#endif // AGRAPATHA_HARDWARE_CONFIG_H
