export type RobotTerminalAction =
  | { type: 'help' }
  | { type: 'clear' }
  | { type: 'status' }
  | { type: 'capture_cam' }
  | { type: 'set_limit_bypass'; enabled: boolean }
  | { type: 'set_lock'; locked: boolean }
  | { type: 'rec_start' }
  | { type: 'rec_stop' }
  | { type: 'rec_clear' }
  | { type: 'play'; loop: boolean }
  | { type: 'stop_playback' }
  | { type: 'return_origin' }
  | {
      type: 'mqtt';
      cmd: string;
      humanLabel: string;
      params?: Record<string, unknown>;
      nextServoAngles?: [number, number, number, number];
    }
  | { type: 'error'; message: string };

export const TERMINAL_HELP_LINES: string[] = [
  '=== KONTROL TERMINAL L298N (OUT3/OUT4) & 4-DOF ARM ===',
  'L298N Rel (OUT3/OUT4 · IN3=GPIO2, IN4=GPIO16, ENB=5V):',
  '  L [ms/s] [bypass]  -> Geser kiri (cth: L | L 3000 | L 2s bypass)',
  '  R [ms/s] [bypass]  -> Geser kanan (cth: R | R 5s | kanan 1500)',
  '  S / stop           -> Hentikan motor L298N seketika',
  '  bypass on | off    -> Toggle abaikan limit switch GPIO 18/19',
  '4-DoF Robot Arm (0-180 deg, Lazy Attach 500-2400us):',
  '  1 <deg> / base     -> Base J1 (GPIO 13), cth: 1 90 | base 120',
  '  2 <deg> / sh       -> Shoulder J2 (GPIO 14), cth: 2 60 | sh 45',
  '  3 <deg> / el       -> Elbow J3 (GPIO 15), cth: 3 80',
  '  4 <deg> / noz      -> Nozzle J4 (GPIO 5), cth: 4 90',
  '  servo b s e n      -> Set 4 servo sekaligus (cth: servo 90 45 45 90)',
  '  0 0 / detach       -> Lepas tahanan PWM semua servo (detach)',
  '  home | park | manual | auto | retract',
  'Record & Otomatis Berulang (Teach & Repeat):',
  '  rec / rec start    -> Rekam gerakan rel + arm secara berurutan',
  '  rec stop / save    -> Selesai merekam & simpan gerakan',
  '  play / run         -> Jalankan rekaman 1x + kembali ke posisi awal',
  '  loop               -> Ulang terus menerus (otomatis & balik awal)',
  '  loop stop          -> Hentikan auto-loop | return / semula -> Balik awal',
  'Kamera, Pompa & Safety:',
  '  C / cam / foto     -> Potret ESP32-CAM via MQTT + Railway',
  '  pump on [ms/s]     -> Nyalakan pompa (GPIO 23) | pump off',
  '  estop | reset      -> Emergency Stop / Reset E-STOP & Fault',
  '  status | clear | help | {"cmd":"..."}',
];

function clampAngle(val: number): number {
  return Math.max(0, Math.min(180, Math.round(val)));
}

function parseDurationToken(token: string | undefined, fallbackMs: number, minMs = 100, maxMs = 15000): number | null {
  if (!token) return fallbackMs;
  const lower = token.toLowerCase();
  const secMatch = lower.match(/^(\d+(?:\.\d+)?)s$/);
  if (secMatch) {
    const ms = Math.round(Number(secMatch[1]) * 1000);
    return Number.isFinite(ms) ? Math.max(minMs, Math.min(maxMs, ms)) : null;
  }
  const msMatch = lower.match(/^(\d+)(?:ms)?$/);
  if (msMatch) {
    const ms = Math.round(Number(msMatch[1]));
    return Number.isFinite(ms) ? Math.max(minMs, Math.min(maxMs, ms)) : null;
  }
  return null;
}

const SINGLE_JOINT_ALIASES: Record<string, { idx: 0 | 1 | 2 | 3; key: 'base' | 'shoulder' | 'elbow' | 'nozzle'; label: string }> = {
  '1': { idx: 0, key: 'base', label: 'Base J1' },
  j1: { idx: 0, key: 'base', label: 'Base J1' },
  base: { idx: 0, key: 'base', label: 'Base J1' },
  yaw: { idx: 0, key: 'base', label: 'Base J1' },
  '2': { idx: 1, key: 'shoulder', label: 'Shoulder J2' },
  j2: { idx: 1, key: 'shoulder', label: 'Shoulder J2' },
  sh: { idx: 1, key: 'shoulder', label: 'Shoulder J2' },
  shoulder: { idx: 1, key: 'shoulder', label: 'Shoulder J2' },
  '3': { idx: 2, key: 'elbow', label: 'Elbow J3' },
  j3: { idx: 2, key: 'elbow', label: 'Elbow J3' },
  el: { idx: 2, key: 'elbow', label: 'Elbow J3' },
  elbow: { idx: 2, key: 'elbow', label: 'Elbow J3' },
  '4': { idx: 3, key: 'nozzle', label: 'Nozzle J4' },
  j4: { idx: 3, key: 'nozzle', label: 'Nozzle J4' },
  noz: { idx: 3, key: 'nozzle', label: 'Nozzle J4' },
  nozzle: { idx: 3, key: 'nozzle', label: 'Nozzle J4' },
};

export function parseRobotTerminalCommand(
  rawInput: string,
  currentAngles: [number, number, number, number],
  ignoreRailLimitsDefault: boolean
): RobotTerminalAction | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Raw JSON MQTT command pass-through
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const cmd = typeof parsed.cmd === 'string'
        ? parsed.cmd
        : typeof parsed.command === 'string'
          ? parsed.command
          : typeof parsed.action === 'string'
            ? parsed.action
            : '';
      if (!cmd) {
        return { type: 'error', message: 'JSON tidak memiliki field "cmd". Contoh: {"cmd":"CMD_SLIDER_LEFT","params":{"duration":3000}}' };
      }
      const params = parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
        ? (parsed.params as Record<string, unknown>)
        : undefined;
      return { type: 'mqtt', cmd, humanLabel: `JSON ${cmd}`, params };
    } catch {
      return { type: 'error', message: 'Format JSON tidak valid.' };
    }
  }

  // Normalize separators (`=` or `:` in shorthands like `base=90` or `1:90`)
  const tokens = trimmed.replace(/[=:]/g, ' ').trim().split(/\s+/);
  const head = tokens[0].toLowerCase();
  const restLower = tokens.slice(1).map((t) => t.toLowerCase());

  if (head === 'help' || head === '?') return { type: 'help' };
  if (head === 'clear' || head === 'cls') return { type: 'clear' };
  if (head === 'status' || head === 'stat' || head === 'info') return { type: 'status' };
  if (head === 'c' || head === 'cam' || head === 'foto' || head === 'capture') {
    return { type: 'capture_cam' };
  }
  if (head === 'lock') {
    if (restLower[0] === 'pump' || restLower[0] === 'pompa') {
      return { type: 'mqtt', cmd: 'CMD_PUMP_LOCKOUT', humanLabel: 'Kunci Pompa (Lockout)' };
    }
    return { type: 'set_lock', locked: true };
  }
  if (head === 'unlock' || head === 'arm') {
    if (head === 'unlock' && (restLower[0] === 'pump' || restLower[0] === 'pompa')) {
      return { type: 'mqtt', cmd: 'CMD_UNLOCK_PUMP', humanLabel: 'Buka Kunci Pompa' };
    }
    if (head === 'arm' && tokens.length === 5) {
      // Fall through to 4-servo setter below
    } else if (head === 'unlock') {
      return { type: 'set_lock', locked: false };
    }
  }

  if (head === 'bypass' || head === 'limit') {
    const arg = restLower[0];
    if (head === 'bypass') {
      if (arg === 'on' || arg === 'true' || arg === '1') return { type: 'set_limit_bypass', enabled: true };
      if (arg === 'off' || arg === 'false' || arg === '0') return { type: 'set_limit_bypass', enabled: false };
      return { type: 'set_limit_bypass', enabled: !ignoreRailLimitsDefault };
    }
    if (arg === 'off' || arg === 'false' || arg === '0') return { type: 'set_limit_bypass', enabled: true };
    if (arg === 'on' || arg === 'true' || arg === '1') return { type: 'set_limit_bypass', enabled: false };
  }

  // Record, Playback & Return-to-Origin ("Teach & Repeat")
  if (head === 'rec' || head === 'record' || head === 'rekam') {
    const arg = restLower[0];
    if (arg === 'stop' || arg === 'save' || arg === 'selesai' || arg === 'off') {
      return { type: 'rec_stop' };
    }
    if (arg === 'clear' || arg === 'hapus' || arg === 'del') {
      return { type: 'rec_clear' };
    }
    return { type: 'rec_start' };
  }
  if (head === 'play' || head === 'run' || head === 'putar') {
    const isLoop = restLower[0] === 'loop' || restLower[0] === 'auto';
    return { type: 'play', loop: isLoop };
  }
  if (head === 'loop') {
    if (restLower[0] === 'stop' || restLower[0] === 'off' || restLower[0] === 'berhenti') {
      return { type: 'stop_playback' };
    }
    return { type: 'play', loop: true };
  }
  if (head === 'stop' && (restLower[0] === 'loop' || restLower[0] === 'play' || restLower[0] === 'auto')) {
    return { type: 'stop_playback' };
  }
  if (head === 'return' || head === 'semula' || head === 'asal') {
    return { type: 'return_origin' };
  }

  // Emergency & System presets
  if (head === '0' || head === 'detach' || head === 'release' || head === 'lepas') {
    return { type: 'mqtt', cmd: 'CMD_DETACH_SERVOS', humanLabel: 'Detach PWM Semua Servo (0 0)' };
  }
  if (head === 'estop' || head === 'e-stop' || head === 'emergency' || (head === 'stop' && restLower[0] === 'all')) {
    return { type: 'mqtt', cmd: 'CMD_EMERGENCY_STOP', humanLabel: 'EMERGENCY STOP' };
  }
  if (head === 'reset') {
    return { type: 'mqtt', cmd: 'CMD_RESET_EMERGENCY', humanLabel: 'Reset Emergency Stop / Fault' };
  }
  if (head === 'home' || head === 'netral') {
    return {
      type: 'mqtt',
      cmd: 'CMD_ARM_HOME',
      humanLabel: 'Arm Home (90/45/45/90)',
      nextServoAngles: [90, 45, 45, 90],
    };
  }
  if (head === 'park') {
    return {
      type: 'mqtt',
      cmd: 'CMD_PARK_SAFE_ZONE',
      humanLabel: 'Parkir Safe Zone (90/45/45/90)',
      nextServoAngles: [90, 45, 45, 90],
    };
  }
  if (head === 'retract') {
    return { type: 'mqtt', cmd: 'CMD_RETRACT_ARM', humanLabel: 'Retract Arm' };
  }
  if (head === 'manual' || (head === 'mode' && restLower[0] === 'manual')) {
    return {
      type: 'mqtt',
      cmd: 'CMD_SET_ARM_MODE',
      humanLabel: 'Mode Manual Arm',
      params: { manual: true },
    };
  }
  if (head === 'auto' || head === 'scan' || (head === 'mode' && (restLower[0] === 'auto' || restLower[0] === 'scan'))) {
    return {
      type: 'mqtt',
      cmd: 'CMD_SET_ARM_MODE',
      humanLabel: 'Mode Auto Scan',
      params: { manual: false },
    };
  }

  // L298N Rail Stop
  if (head === 's' || head === 'stop' || head === 'halt' || head === 'berhenti') {
    return { type: 'mqtt', cmd: 'CMD_SLIDER_STOP', humanLabel: 'Stop L298N (OUT3/OUT4)' };
  }

  // L298N Rail Left / Right
  if (head === 'l' || head === 'left' || head === 'kiri' || head === 'r' || head === 'right' || head === 'kanan') {
    const isLeft = head === 'l' || head === 'left' || head === 'kiri';
    const hasBypassFlag = restLower.some((t) => t === 'bypass' || t === 'force' || t === 'nolimit');
    const durToken = restLower.find((t) => t !== 'bypass' && t !== 'force' && t !== 'nolimit');
    const duration = parseDurationToken(durToken, 3000, 100, 15000);
    if (duration === null) {
      return { type: 'error', message: `Durasi tidak valid: "${durToken}". Contoh: ${head} 3000 atau ${head} 2s` };
    }
    const ignoreLimit = hasBypassFlag || ignoreRailLimitsDefault;
    const params: Record<string, unknown> = { duration };
    if (ignoreLimit) params.ignore_limit = true;
    return {
      type: 'mqtt',
      cmd: isLeft ? 'CMD_SLIDER_LEFT' : 'CMD_SLIDER_RIGHT',
      humanLabel: `L298N ${isLeft ? 'Kiri' : 'Kanan'} (${(duration / 1000).toFixed(1)}s${ignoreLimit ? ', Bypass Limit' : ''})`,
      params,
    };
  }

  // Pump Control
  if (head === 'pump' || head === 'pompa' || head === 'siram' || head === 'irrig' || head === 'mist' || head === 'kabut') {
    if (restLower[0] === 'off' || restLower[0] === 'stop' || restLower[0] === 'mati') {
      return { type: 'mqtt', cmd: 'CMD_STOP_PUMP', humanLabel: 'Matikan Pompa' };
    }
    if (restLower[0] === 'lock') {
      return { type: 'mqtt', cmd: 'CMD_PUMP_LOCKOUT', humanLabel: 'Kunci Pompa' };
    }
    if (restLower[0] === 'unlock') {
      return { type: 'mqtt', cmd: 'CMD_UNLOCK_PUMP', humanLabel: 'Buka Kunci Pompa' };
    }
    const isMist = head === 'mist' || head === 'kabut';
    const argTok = restLower[0] === 'on' ? restLower[1] : restLower[0];
    const duration = parseDurationToken(argTok, isMist ? 2500 : 4000, 500, 12000);
    if (duration === null) {
      return { type: 'error', message: `Durasi pompa tidak valid: "${argTok}". Contoh: pump on 4000` };
    }
    return {
      type: 'mqtt',
      cmd: isMist ? 'CMD_START_MISTING' : 'CMD_START_IRRIGATION',
      humanLabel: `${isMist ? 'Misting' : 'Pompa ON'} (${(duration / 1000).toFixed(1)}s)`,
      params: { duration },
    };
  }

  // Multi-joint Servo command: `servo 90 45 45 90` | `arm 90 45 45 90` | `set 90 45 45 90` | bare `90 45 45 90`
  const isBareFourNums = tokens.length === 4 && tokens.every((t) => /^-?\d+$/.test(t));
  if (isBareFourNums || ((head === 'servo' || head === 'arm' || head === 'set') && tokens.length === 5)) {
    const rawVals = (isBareFourNums ? tokens : tokens.slice(1)).map(Number);
    if (rawVals.some((v) => !Number.isFinite(v))) {
      return { type: 'error', message: 'Sudut servo harus angka 0-180. Contoh: servo 90 45 45 90' };
    }
    const nextTuple: [number, number, number, number] = [
      clampAngle(rawVals[0]),
      clampAngle(rawVals[1]),
      clampAngle(rawVals[2]),
      clampAngle(rawVals[3]),
    ];
    return {
      type: 'mqtt',
      cmd: 'CMD_SET_SERVO',
      humanLabel: `Set 4 Servo (${nextTuple.join('°/')}°)`,
      params: {
        base: nextTuple[0],
        shoulder: nextTuple[1],
        elbow: nextTuple[2],
        nozzle: nextTuple[3],
      },
      nextServoAngles: nextTuple,
    };
  }

  // Single-joint Servo command: `1 90`, `base 90`, `j2 45`, `sh 60`, `3 80`, `noz 120`
  const jointSpec = SINGLE_JOINT_ALIASES[head];
  if (jointSpec && tokens.length === 2) {
    const rawDeg = Number(tokens[1].replace(/°$/i, ''));
    if (!Number.isFinite(rawDeg)) {
      return { type: 'error', message: `Derajat tidak valid untuk ${jointSpec.label}: "${tokens[1]}" (isi 0-180).` };
    }
    const deg = clampAngle(rawDeg);
    const nextTuple: [number, number, number, number] = [...currentAngles] as [number, number, number, number];
    nextTuple[jointSpec.idx] = deg;
    return {
      type: 'mqtt',
      cmd: 'CMD_SET_SERVO',
      humanLabel: `Set ${jointSpec.label} -> ${deg}°`,
      params: { [jointSpec.key]: deg },
      nextServoAngles: nextTuple,
    };
  }

  return {
    type: 'error',
    message: `Perintah tidak dikenali: "${trimmed}". Ketik "help" untuk lihat format perintah.`,
  };
}
