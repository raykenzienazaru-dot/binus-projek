/**
 * ==============================================================================
 * AGRAPATHA & GRENVIS — ESP32-CAM AI VISION NODE (ARM END-EFFECTOR MOUNT)
 * Board: AI-Thinker ESP32-CAM (OV2640 Sensor)
 * ==============================================================================
 * FITUR:
 * 1. Capture Citra Hardware OV2640 (QVGA / 320x240 @ JPEG Quality 12).
 * 2. Transmisi ke Railway Cloud Backend via HTTPS POST multipart/form-data (/predict/fire).
 *    Host: be-binus-production.up.railway.app
 * 3. Model Computer Vision: MobileNetV2 3-Kelas ("FIRE", "SMOKE", "SAFE").
 * 4. Transmisi Hasil AI ke NodeMCU ESP32-S Main Controller via ESP-NOW.
 * 5. HTTP/1.1 Chunked Decoding & DynamicJsonDocument(2048) untuk parsing stabil.
 * 6. Target MAC Main Controller: 8C:AA:B5:37:71:18.
 * ==============================================================================
 */

#include "esp_camera.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <ArduinoJson.h>

// ======================================================
// 1. PIN DEFINITIONS AI-THINKER ESP32-CAM
// ======================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4

// ======================================================
// 2. KREDENSIAL & KONFIGURASI RAILWAY
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
#else
  const char* WIFI_SSID     = ".";
  const char* WIFI_PASSWORD = "01020304";
#endif

// Endpoint Railway FastAPI MobileNetV2 (be-binus)
const char* AI_HOST = "be-binus-production.up.railway.app";
const char* AI_PATH = "/predict/fire";

// MAC Address NodeMCU ESP32-S Main Controller
const uint8_t TARGET_MAIN_MAC[6] = { 0x8C, 0xAA, 0xB5, 0x37, 0x71, 0x18 };

// ======================================================
// 3. STRUKTUR PROTOKOL ESP-NOW (SINKRON DENGAN MAIN ESP32)
// ======================================================
#define PACKET_VISION_RESULT   1
#define PACKET_IMAGE_START     2
#define PACKET_IMAGE_CHUNK     3
#define PACKET_IMAGE_END       4
#define PACKET_CAPTURE_REQUEST 5

#define IMAGE_CHUNK_SIZE       200

typedef struct __attribute__((packed)) {
  uint8_t  packetType;        // 1 = Result
  uint32_t scanNumber;
  char     visionClass[16];   // "FIRE", "SMOKE", "SAFE", "Unknown"
  float    confidence;        // 0.0 - 1.0
  float    fireScore;
  float    smokeScore;
  float    safeScore;
  uint32_t timestampMs;
} CameraAiPacket;

// Global Variables
bool cameraHardwareReady = false;
volatile bool captureRequested = false;
uint32_t scanCounter = 0;
unsigned long lastInferenceTime = 0;
unsigned long lastWifiAttemptTime = 0;
const unsigned long AUTO_INFERENCE_INTERVAL_MS = 2500;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 15000;

// ======================================================
// 4. INISIALISASI KAMERA OV2640
// ======================================================
bool initCamera() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Nonaktifkan brownout detector saat inisialisasi RF/Cam

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Resolusi QVGA (320x240) - ukuran optimal & cepat untuk inferensi MobileNetV2 224x224
  config.frame_size   = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;

  if (psramFound()) {
    config.fb_count    = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode   = CAMERA_GRAB_LATEST;
  } else {
    config.fb_count    = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode   = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM ERROR] Gagal inisialisasi OV2640 (0x%x)\n", err);
    cameraHardwareReady = false;
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s != nullptr) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
  }

  // Warm-up 2 frame awal agar Auto Exposure & AWB stabil
  for (int i = 0; i < 2; i++) {
    camera_fb_t *warm = esp_camera_fb_get();
    if (warm) esp_camera_fb_return(warm);
    delay(50);
  }

  cameraHardwareReady = true;
  Serial.println("[CAM OK] Sensor Kamera OV2640 Siap.");
  return true;
}

// ======================================================
// 5. HELPER DECODING HTTP CHUNKED & WIFI RECONNECT
// ======================================================
String decodeHttpChunked(const String &rawBody) {
  String decoded;
  int pos = 0;
  const int len = rawBody.length();

  while (pos < len) {
    int lineEnd = rawBody.indexOf('\n', pos);
    if (lineEnd == -1) break;

    String sizeLine = rawBody.substring(pos, lineEnd);
    sizeLine.trim();
    pos = lineEnd + 1;

    if (sizeLine.length() == 0) continue;

    // Strip optional chunk extensions (;...)
    int semi = sizeLine.indexOf(';');
    if (semi != -1) sizeLine = sizeLine.substring(0, semi);

    long chunkSize = strtol(sizeLine.c_str(), nullptr, 16);
    if (chunkSize <= 0) break;

    int copyEnd = pos + (int)chunkSize;
    if (copyEnd > len) copyEnd = len;
    decoded += rawBody.substring(pos, copyEnd);
    pos = copyEnd;

    // Lewati CRLF setelah chunk
    if (pos < len && rawBody[pos] == '\r') pos++;
    if (pos < len && rawBody[pos] == '\n') pos++;
  }

  return decoded;
}

String extractCleanJson(const String &rawBody, bool isChunked) {
  String body = isChunked ? decodeHttpChunked(rawBody) : rawBody;
  if (body.length() == 0 && rawBody.length() > 0) {
    body = rawBody;
  }
  int firstBrace = body.indexOf('{');
  int lastBrace  = body.lastIndexOf('}');
  if (firstBrace != -1 && lastBrace > firstBrace) {
    return body.substring(firstBrace, lastBrace + 1);
  }
  return body;
}

const char* wifiStatusToText(wl_status_t st) {
  switch (st) {
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL (Cek band 2.4GHz vs 5GHz)";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED (Password/WPA3 ditolak)";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED";
    default:                 return "CONNECTING/OTHER";
  }
}

void printWifiScanDiagnostics() {
  Serial.printf("[WiFi DIAG] Status=%d (%s)\n", (int)WiFi.status(), wifiStatusToText(WiFi.status()));
  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("[WiFi DIAG] Tidak ada AP 2.4 GHz terdeteksi!");
  } else {
    for (int i = 0; i < n; i++) {
      Serial.printf("  [%d] '%s' (len=%d, RSSI=%d dBm, Ch=%d, Auth=%d)\n",
                    i + 1, WiFi.SSID(i).c_str(), WiFi.SSID(i).length(),
                    WiFi.RSSI(i), WiFi.channel(i), (int)WiFi.encryptionType(i));
    }
  }
  WiFi.scanDelete();
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttemptTime < WIFI_RECONNECT_INTERVAL_MS) return;
  lastWifiAttemptTime = now;

  Serial.printf("[WiFi] Reconnecting ke SSID '%s' (status=%d: %s)...\n",
                WIFI_SSID, (int)WiFi.status(), wifiStatusToText(WiFi.status()));
  WiFi.disconnect(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ======================================================
// 6. QUERY INFERENSI KE RAILWAY CLOUD BACKEND
// ======================================================
bool queryCloudAiVision(const uint8_t *jpegBuf, size_t jpegLen, CameraAiPacket *outResult) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[AI-CLOUD] WiFi tidak terhubung.");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // SSL ke Railway (*.up.railway.app)
  client.setTimeout(12000);

  Serial.printf("[AI-CLOUD] Mengirim citra (%u byte) ke https://%s%s...\n", jpegLen, AI_HOST, AI_PATH);

  if (!client.connect(AI_HOST, 443)) {
    Serial.println("[AI-CLOUD] Gagal membuka soket HTTPS ke Railway.");
    return false;
  }

  const String boundary = "----ESP32CAMBoundary" + String(millis());
  const String head = "--" + boundary + "\r\n" +
                      "Content-Disposition: form-data; name=\"file\"; filename=\"frame.jpg\"\r\n" +
                      "Content-Type: image/jpeg\r\n\r\n";
  const String tail = "\r\n--" + boundary + "--\r\n";
  const size_t totalLen = head.length() + jpegLen + tail.length();

  const String reqPath = String(AI_PATH) + "?source=esp32cam&scan=" + String(outResult->scanNumber);

  // Kirim Header HTTP POST
  client.println("POST " + reqPath + " HTTP/1.1");
  client.println("Host: " + String(AI_HOST));
  client.println("Content-Type: multipart/form-data; boundary=" + boundary);
  client.println("Content-Length: " + String(totalLen));
  client.println("User-Agent: ESP32-CAM-AI-ARM/2.2");
  client.println("X-Camera-Device: esp32cam");
  client.println("Accept: application/json");
  client.println("Connection: close");
  client.println();

  // Streaming body gambar per 1024 byte agar aman di buffer RAM
  client.print(head);
  const size_t chunkSize = 1024;
  for (size_t offset = 0; offset < jpegLen; offset += chunkSize) {
    size_t toWrite = (jpegLen - offset > chunkSize) ? chunkSize : (jpegLen - offset);
    client.write(jpegBuf + offset, toWrite);
  }
  client.print(tail);
  client.flush();

  // Tunggu respon Railway (maksimal 10 detik)
  unsigned long startWait = millis();
  while (!client.available() && client.connected() && (millis() - startWait < 10000)) {
    delay(25);
  }

  if (!client.available()) {
    Serial.println("[AI-CLOUD] Timeout menunggu respon server.");
    client.stop();
    return false;
  }

  String statusLine = client.readStringUntil('\n');
  statusLine.trim();
  Serial.printf("[AI-CLOUD] HTTP Status: %s\n", statusLine.c_str());

  if (statusLine.indexOf(" 200 ") == -1) {
    client.stop();
    return false;
  }

  // Baca & deteksi Transfer-Encoding: chunked pada HTTP Header
  bool isChunked = false;
  unsigned long hdrWaitStart = millis();
  while (millis() - hdrWaitStart < 3000) {
    if (!client.available()) {
      if (!client.connected()) break;
      delay(5);
      continue;
    }
    String line = client.readStringUntil('\n');
    String lowerLine = line;
    lowerLine.toLowerCase();
    if (lowerLine.indexOf("transfer-encoding:") != -1 && lowerLine.indexOf("chunked") != -1) {
      isChunked = true;
    }
    if (line == "\r" || line.length() == 0) break;
  }

  // Baca seluruh body respon secara stabil
  String rawPayload;
  rawPayload.reserve(1024);
  unsigned long bodyReadStart = millis();
  while ((client.connected() || client.available()) && (millis() - bodyReadStart < 5000)) {
    while (client.available()) {
      rawPayload += (char)client.read();
    }
    if (!client.connected()) break;
    delay(5);
  }
  client.stop();

  String jsonPayload = extractCleanJson(rawPayload, isChunked);
  if (jsonPayload.length() == 0) {
    Serial.println("[AI-CLOUD] Payload JSON kosong dari server.");
    return false;
  }

  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, jsonPayload);
  if (err) {
    Serial.printf("[AI-CLOUD ERROR] Deserialisasi JSON gagal (%s) | Len: %u\n", err.c_str(), jsonPayload.length());
    return false;
  }

  bool okStatus = (doc["success"] == true) || (strcmp(doc["status"] | "", "success") == 0);
  if (!okStatus) {
    Serial.println("[AI-CLOUD ERROR] Server mengembalikan status gagal.");
    return false;
  }

  // Prioritaskan field top-level ESP32, fallback ke doc["data"]
  const char* rawClass = doc["class"] | doc["data"]["predicted_label"] | doc["predicted_label"] | "SAFE";
  char normalizedClass[16] = "SAFE";
  if (strcasecmp(rawClass, "FIRE") == 0 || strcasecmp(rawClass, "Fire") == 0) {
    strncpy(normalizedClass, "FIRE", sizeof(normalizedClass));
  } else if (strcasecmp(rawClass, "SMOKE") == 0 || strcasecmp(rawClass, "Smoke") == 0) {
    strncpy(normalizedClass, "SMOKE", sizeof(normalizedClass));
  } else {
    strncpy(normalizedClass, "SAFE", sizeof(normalizedClass));
  }

  strncpy(outResult->visionClass, normalizedClass, sizeof(outResult->visionClass) - 1);
  outResult->visionClass[sizeof(outResult->visionClass) - 1] = '\0';

  outResult->confidence = doc["confidence"] | doc["data"]["confidence"] | 0.0f;
  outResult->fireScore  = doc["scores"]["FIRE"]  | doc["scores"]["Fire"]     | doc["data"]["scores"]["Fire"]     | 0.0f;
  outResult->smokeScore = doc["scores"]["SMOKE"] | doc["scores"]["Smoke"]    | doc["data"]["scores"]["Smoke"]    | 0.0f;
  outResult->safeScore  = doc["scores"]["SAFE"]  | doc["scores"]["Non-Fire"] | doc["data"]["scores"]["Non-Fire"] | 0.0f;
  outResult->timestampMs = millis();

  if (doc["capture_requested"] == true) {
    captureRequested = true;
  }

  Serial.printf("[AI-CLOUD HASIL] Kelas: %s (%.1f%%) | Cache Foto Dashboard: %s\n",
                outResult->visionClass, outResult->confidence * 100.0,
                (doc["frame_cached"] == true) ? "TERSIMPAN" : "TIDAK");
  return true;
}

// ======================================================
// 7. ESP-NOW WIRELESS TRANSMITTER KE ESP32 MAIN
// ======================================================
void onEspNowReceive(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  if (incomingData != nullptr && len > 0) {
    if (incomingData[0] == PACKET_CAPTURE_REQUEST) {
      captureRequested = true;
      Serial.println("[ESP-NOW] Permintaan capture diterima dari ESP32 Main.");
    }
  }
}

bool initESPNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW ERROR] Gagal inisialisasi.");
    return false;
  }

  esp_now_register_recv_cb(onEspNowReceive);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, TARGET_MAIN_MAC, 6);
  peerInfo.channel = 0; // Otomatis mengikuti channel Wi-Fi aktif
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    Serial.println("[ESP-NOW OK] Peer ESP32 Main terdaftar.");
    return true;
  }
  Serial.println("[ESP-NOW ERROR] Gagal mendaftarkan peer ESP32 Main.");
  return false;
}

// ======================================================
// 8. SETUP & MAIN LOOP
// ======================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[AGRAPATHA] Inisialisasi ESP32-CAM AI Vision Node...");

  initCamera();

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(100);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke '%s' (len=%d)", WIFI_SSID, strlen(WIFI_SSID));

  uint32_t startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 12000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi OK] IP: %s | Channel: %d | RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel(), WiFi.RSSI());
  } else {
    Serial.println("[WiFi WARN] Belum terhubung saat boot, diagnosa scan 2.4 GHz:");
    printWifiScanDiagnostics();
  }
  lastWifiAttemptTime = millis();

  initESPNow();
}

void loop() {
  ensureWiFiConnected();

  unsigned long now = millis();

  // Eksekusi inferensi otomatis berkala atau sesuai permintaan foto dari Dashboard / ESP32 Main
  if ((now - lastInferenceTime >= AUTO_INFERENCE_INTERVAL_MS) || captureRequested) {
    bool isManualReq = captureRequested;
    lastInferenceTime = now;
    captureRequested = false;

    if (!cameraHardwareReady) return;

    // Saat foto diminta manual, buang 1 frame lama di PSRAM buffer agar frame benar-benar terkini
    if (isManualReq && psramFound()) {
      camera_fb_t *staleFb = esp_camera_fb_get();
      if (staleFb) {
        esp_camera_fb_return(staleFb);
        delay(30);
      }
    }

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[CAM ERROR] Gagal mengambil buffer gambar.");
      return;
    }

    CameraAiPacket packet = {};
    packet.packetType = PACKET_VISION_RESULT;
    packet.scanNumber = ++scanCounter;

    // 1. Query Inferensi + Simpan Frame JPEG Terbaru ke Railway API (be-binus-production.up.railway.app)
    bool success = queryCloudAiVision(fb->buf, fb->len, &packet);
    if (!success) {
      // Fallback aman jika Railway offline / timeout (fail-safe: jangan klaim SAFE palsu)
      strncpy(packet.visionClass, "Unknown", sizeof(packet.visionClass) - 1);
      packet.confidence = 0.0f;
      packet.fireScore = 0.0f;
      packet.smokeScore = 0.0f;
      packet.safeScore = 0.0f;
      packet.timestampMs = millis();
    }

    // 2. Transmisikan Hasil ke NodeMCU ESP32-S Main Controller via ESP-NOW
    esp_err_t sendErr = esp_now_send(TARGET_MAIN_MAC, (uint8_t *)&packet, sizeof(packet));
    if (sendErr == ESP_OK) {
      Serial.printf("[ESP-NOW OK] Hasil AI terkirim ke Main: %s (%.2f%%)\n",
                    packet.visionClass, packet.confidence * 100.0);
    } else {
      Serial.printf("[ESP-NOW ERROR] Gagal kirim ke Main (0x%x)\n", sendErr);
    }

    esp_camera_fb_return(fb);
  }
}
