/**
 * ==============================================================================
 * AGRAPATHA — STANDALONE KONSOL UJI COBA 4-DOF ARM & L298N (SERIAL ONLY)
 * Khusus untuk test langsung lewat Arduino Serial Monitor (115200 baud)
 * tanpa Wi-Fi, MQTT, Kamera, atau Sensor Onboard.
 *
 * Pinout Hardware:
 * - Servo 1 Base (Yaw)     : GPIO 13
 * - Servo 2 Shoulder       : GPIO 14
 * - Servo 3 Elbow          : GPIO 15
 * - Servo 4 Nozzle         : GPIO 5
 * - L298N IN3 (-> OUT3)    : GPIO 2
 * - L298N IN4 (-> OUT4)    : GPIO 16
 * - Jumper ENB L298N       : Terpasang ke 5V
 * - Limit Switch L / R     : GPIO 18 / GPIO 19 (INPUT_PULLUP, aktif LOW)
 * ==============================================================================
 */

#include <Arduino.h>
#include <ESP32Servo.h>

// 4-DoF Arm Pins
#define SERVO_BASE_PIN       13
#define SERVO_SHOULDER_PIN   14
#define SERVO_ELBOW_PIN      15
#define SERVO_NOZZLE_PIN     5

// L298N OUT3 & OUT4 Pins
#define MOTOR_IN3            2    // Kiri (IN3 -> OUT3)
#define MOTOR_IN4            16   // Kanan (IN4 -> OUT4)
#define LIMIT_SW_LEFT        18
#define LIMIT_SW_RIGHT       19

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoNozzle;

int angleBase = 90;
int angleShoulder = 45;
int angleElbow = 45;
int angleNozzle = 90;

bool motorActive = false;
bool motorIgnoreLimit = false;
bool globalBypassLimit = false;
char motorDir[12] = "STOPPED";
unsigned long motorEndTime = 0;

void printHelp() {
  Serial.println("==========================================================");
  Serial.println("=== KONSOL TEST 4-DOF ARM & L298N (OUT3/OUT4) AGRAPATHA ===");
  Serial.println("Servo Arm (0-180 deg, lazy-attach 500-2400us):");
  Serial.println("  1 <deg> ... 4 <deg> : Contoh '1 90', '2 110', '3 60', '4 90'");
  Serial.println("  servo b s e n       : Set 4 servo sekaligus (cth: servo 90 45 45 90)");
  Serial.println("  home                : Set netral 90 / 45 / 45 / 90 deg");
  Serial.println("  0 0  atau detach    : Lepas sinyal PWM semua servo");
  Serial.println("Motor Rel L298N OUT3 & OUT4 (IN3=GPIO2, IN4=GPIO16, ENB=5V):");
  Serial.println("  L [ms] [bypass]     : Geser kiri (default 2000 ms), cth: 'L' / 'L 3000'");
  Serial.println("  R [ms] [bypass]     : Geser kanan (default 2000 ms), cth: 'R' / 'R 1500 bypass'");
  Serial.println("  S  atau stop        : Hentikan motor L298N seketika");
  Serial.println("  bypass on / off     : Abaikan limit switch GPIO 18/19 saat uji motor");
  Serial.println("Lainnya: status | help");
  Serial.println("==========================================================");
}

void stopMotor() {
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, LOW);
  strncpy(motorDir, "STOPPED", sizeof(motorDir));
  motorActive = false;
  motorIgnoreLimit = false;
}

bool startMotorLeft(unsigned long durMs, bool bypassLimit) {
  if (!bypassLimit && digitalRead(LIMIT_SW_LEFT) == LOW) {
    stopMotor();
    Serial.println("[BLOCKED] LIMIT_SW_LEFT (GPIO 18) terbaca LOW. Ketik 'L 2000 bypass' atau 'bypass on' untuk uji tanpa limit.");
    return false;
  }
  durMs = constrain(durMs, 100UL, 15000UL);
  digitalWrite(MOTOR_IN3, HIGH);
  digitalWrite(MOTOR_IN4, LOW);
  strncpy(motorDir, "LEFT", sizeof(motorDir));
  motorIgnoreLimit = bypassLimit;
  motorActive = true;
  motorEndTime = millis() + durMs;
  Serial.printf("[OK] L298N OUT3/4 KIRI selama %lu ms (IN3=GPIO2 HIGH, IN4=GPIO16 LOW, bypass=%d)\n",
                durMs, bypassLimit ? 1 : 0);
  return true;
}

bool startMotorRight(unsigned long durMs, bool bypassLimit) {
  if (!bypassLimit && digitalRead(LIMIT_SW_RIGHT) == LOW) {
    stopMotor();
    Serial.println("[BLOCKED] LIMIT_SW_RIGHT (GPIO 19) terbaca LOW. Ketik 'R 2000 bypass' atau 'bypass on' untuk uji tanpa limit.");
    return false;
  }
  durMs = constrain(durMs, 100UL, 15000UL);
  digitalWrite(MOTOR_IN3, LOW);
  digitalWrite(MOTOR_IN4, HIGH);
  strncpy(motorDir, "RIGHT", sizeof(motorDir));
  motorIgnoreLimit = bypassLimit;
  motorActive = true;
  motorEndTime = millis() + durMs;
  Serial.printf("[OK] L298N OUT3/4 KANAN selama %lu ms (IN3=GPIO2 LOW, IN4=GPIO16 HIGH, bypass=%d)\n",
                durMs, bypassLimit ? 1 : 0);
  return true;
}

void setSingleServo(int nomorServo, int targetSudut) {
  if (nomorServo == 0) {
    servoBase.detach();
    servoShoulder.detach();
    servoElbow.detach();
    servoNozzle.detach();
    Serial.println("[STOP] Semua servo di-detach (bebas / tidak menahan beban).");
    return;
  }

  targetSudut = constrain(targetSudut, 0, 180);
  switch (nomorServo) {
    case 1:
      if (!servoBase.attached()) servoBase.attach(SERVO_BASE_PIN, 500, 2400);
      angleBase = targetSudut;
      servoBase.write(targetSudut);
      Serial.printf("[OK] Servo 1 (BASE - GPIO 13) -> %d derajat\n", targetSudut);
      break;
    case 2:
      if (!servoShoulder.attached()) servoShoulder.attach(SERVO_SHOULDER_PIN, 500, 2400);
      angleShoulder = targetSudut;
      servoShoulder.write(targetSudut);
      Serial.printf("[OK] Servo 2 (SHOULDER - GPIO 14) -> %d derajat\n", targetSudut);
      break;
    case 3:
      if (!servoElbow.attached()) servoElbow.attach(SERVO_ELBOW_PIN, 500, 2400);
      angleElbow = targetSudut;
      servoElbow.write(targetSudut);
      Serial.printf("[OK] Servo 3 (ELBOW - GPIO 15) -> %d derajat\n", targetSudut);
      break;
    case 4:
      if (!servoNozzle.attached()) servoNozzle.attach(SERVO_NOZZLE_PIN, 500, 2400);
      angleNozzle = targetSudut;
      servoNozzle.write(targetSudut);
      Serial.printf("[OK] Servo 4 (NOZZLE - GPIO 5) -> %d derajat\n", targetSudut);
      break;
    default:
      Serial.println("[ERROR] Nomor servo harus 1..4 atau 0 untuk detach.");
      break;
  }
}

void handleConsoleLine(const char* rawLine) {
  while (*rawLine == ' ' || *rawLine == '\t') rawLine++;
  if (strlen(rawLine) == 0) return;

  if (strcasecmp(rawLine, "help") == 0 || strcmp(rawLine, "?") == 0) {
    printHelp();
    return;
  }
  if (strcasecmp(rawLine, "status") == 0) {
    Serial.printf("[STATUS] Motor=%s | Limit(L=%s, R=%s) | Bypass=%s | Servo=[%d, %d, %d, %d]\n",
                  motorDir,
                  digitalRead(LIMIT_SW_LEFT) == LOW ? "ACTIVE(LOW)" : "CLEAR",
                  digitalRead(LIMIT_SW_RIGHT) == LOW ? "ACTIVE(LOW)" : "CLEAR",
                  globalBypassLimit ? "ON" : "OFF",
                  angleBase, angleShoulder, angleElbow, angleNozzle);
    return;
  }
  if (strcasecmp(rawLine, "detach") == 0 || strcasecmp(rawLine, "release") == 0 || strcmp(rawLine, "0") == 0) {
    setSingleServo(0, 0);
    return;
  }
  if (strcasecmp(rawLine, "home") == 0) {
    setSingleServo(1, 90);
    setSingleServo(2, 45);
    setSingleServo(3, 45);
    setSingleServo(4, 90);
    return;
  }
  if (strcasecmp(rawLine, "s") == 0 || strcasecmp(rawLine, "stop") == 0) {
    stopMotor();
    Serial.println("[OK] L298N berhenti (IN3=LOW, IN4=LOW).");
    return;
  }

  int b = 0, s = 0, e = 0, n = 0;
  if (sscanf(rawLine, "servo %d %d %d %d", &b, &s, &e, &n) == 4 ||
      sscanf(rawLine, "arm %d %d %d %d", &b, &s, &e, &n) == 4) {
    setSingleServo(1, b);
    setSingleServo(2, s);
    setSingleServo(3, e);
    setSingleServo(4, n);
    return;
  }

  int num = 0, deg = 0;
  if (sscanf(rawLine, "%d %d", &num, &deg) == 2) {
    setSingleServo(num, deg);
    return;
  }

  char tok1[24] = "", tok2[24] = "", tok3[24] = "";
  int nTok = sscanf(rawLine, "%23s %23s %23s", tok1, tok2, tok3);
  if (nTok >= 1) {
    if (strcasecmp(tok1, "bypass") == 0) {
      if (nTok >= 2 && (strcasecmp(tok2, "on") == 0 || strcmp(tok2, "1") == 0)) globalBypassLimit = true;
      else if (nTok >= 2 && (strcasecmp(tok2, "off") == 0 || strcmp(tok2, "0") == 0)) globalBypassLimit = false;
      else globalBypassLimit = !globalBypassLimit;
      Serial.printf("[OK] Bypass Limit Switch default: %s\n", globalBypassLimit ? "ON" : "OFF");
      return;
    }
    if (strcasecmp(tok1, "l") == 0 || strcasecmp(tok1, "left") == 0 || strcasecmp(tok1, "kiri") == 0 ||
        strcasecmp(tok1, "r") == 0 || strcasecmp(tok1, "right") == 0 || strcasecmp(tok1, "kanan") == 0) {
      bool isLeft = (strcasecmp(tok1, "l") == 0 || strcasecmp(tok1, "left") == 0 || strcasecmp(tok1, "kiri") == 0);
      unsigned long dur = 2000;
      bool bypass = globalBypassLimit;
      if (nTok >= 2 && isdigit((unsigned char)tok2[0])) dur = (unsigned long)atol(tok2);
      if ((nTok >= 2 && strcasecmp(tok2, "bypass") == 0) || (nTok >= 3 && strcasecmp(tok3, "bypass") == 0)) {
        bypass = true;
      }
      if (isLeft) startMotorLeft(dur, bypass);
      else startMotorRight(dur, bypass);
      return;
    }
  }

  Serial.printf("[ERROR] Perintah '%s' tidak dikenal. Ketik 'help'.\n", rawLine);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(LIMIT_SW_LEFT, INPUT_PULLUP);
  pinMode(LIMIT_SW_RIGHT, INPUT_PULLUP);
  pinMode(MOTOR_IN3, OUTPUT);
  pinMode(MOTOR_IN4, OUTPUT);
  stopMotor();

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  servoBase.setPeriodHertz(50);
  servoShoulder.setPeriodHertz(50);
  servoElbow.setPeriodHertz(50);
  servoNozzle.setPeriodHertz(50);

  // Servo belum di-attach di setup agar tidak langsung menyentak ke posisi default
  printHelp();
}

void loop() {
  unsigned long now = millis();

  // Watchdog non-blocking untuk L298N
  if (motorActive) {
    if (!motorIgnoreLimit &&
        ((strcmp(motorDir, "LEFT") == 0 && digitalRead(LIMIT_SW_LEFT) == LOW) ||
         (strcmp(motorDir, "RIGHT") == 0 && digitalRead(LIMIT_SW_RIGHT) == LOW))) {
      stopMotor();
      Serial.println("[WATCHDOG] Limit switch tercapai -> Motor L298N berhenti.");
    } else if (now >= motorEndTime) {
      stopMotor();
      Serial.println("[WATCHDOG] Durasi motor L298N selesai -> Stop.");
    }
  }

  // Non-blocking Serial input
  static char lineBuf[128];
  static size_t lineLen = 0;
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (lineLen > 0) {
        lineBuf[lineLen] = '\0';
        Serial.printf("> %s\n", lineBuf);
        handleConsoleLine(lineBuf);
        lineLen = 0;
      }
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    }
  }
}
