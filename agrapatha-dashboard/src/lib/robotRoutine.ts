export interface RecordedRoutineStep {
  id: number;
  cmd: string;
  label: string;
  params?: Record<string, unknown>;
  recordedAtMs: number;
  waitAfterMs: number;
}

export interface RobotRoutine {
  name: string;
  createdAt: string;
  initialServoAngles: [number, number, number, number];
  steps: RecordedRoutineStep[];
}

export interface RoutineReplayAction {
  cmd: string;
  label: string;
  params?: Record<string, unknown>;
  waitMs: number;
}

export const ROUTINE_STORAGE_KEY = 'agrapatha_recorded_routine_v1';

const NON_MOTION_COMMANDS = new Set([
  'CMD_EMERGENCY_STOP',
  'CMD_RESET_EMERGENCY',
  'CMD_SET_ARM_MODE',
]);

/**
 * Checks whether an outgoing command should be captured into a motion recording.
 */
export function isRecordableCommand(cmd: string): boolean {
  return !NON_MOTION_COMMANDS.has(cmd);
}

/**
 * Computes sensible replay duration after executing a recorded command.
 * Slider and pump runs wait for at least their physical actuation time;
 * manual pause gaps between non-blocking commands are bounded so replay stays crisp.
 */
export function computeWaitAfterCommandMs(
  cmd: string,
  params: Record<string, unknown> | undefined,
  rawGapMs: number
): number {
  const safeGap = Math.max(350, Math.min(rawGapMs, 4000));
  if (cmd === 'CMD_SLIDER_LEFT' || cmd === 'L' || cmd === 'CMD_SLIDER_RIGHT' || cmd === 'R') {
    const dur = typeof params?.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 1500;
    return Math.max(Math.round(dur) + 250, Math.min(safeGap, Math.round(dur) + 1200));
  }
  if (cmd === 'CMD_START_IRRIGATION' || cmd === 'CMD_START_MISTING') {
    const dur = typeof params?.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 2500;
    return Math.max(Math.round(dur) + 200, safeGap);
  }
  if (cmd === 'CMD_SET_SERVO' || cmd === 'CMD_ARM_HOME' || cmd === 'CMD_PARK_SAFE_ZONE' || cmd === 'CMD_RETRACT_ARM') {
    return Math.max(550, safeGap);
  }
  if (cmd === 'CMD_TRIGGER_CAPTURE' || cmd === 'C') {
    return Math.max(1200, safeGap);
  }
  return safeGap;
}

/**
 * Appends a live command step to an active recording buffer.
 * When CMD_SLIDER_STOP immediately ends an active CMD_SLIDER_LEFT/RIGHT hold,
 * collapses the pair into a single slider step with the exact measured hold duration.
 */
export function appendRecordedStep(
  steps: RecordedRoutineStep[],
  next: {
    id: number;
    cmd: string;
    label: string;
    params?: Record<string, unknown>;
    timestampMs: number;
  }
): RecordedRoutineStep[] {
  if (!isRecordableCommand(next.cmd)) {
    return steps;
  }

  const isStop = next.cmd === 'CMD_SLIDER_STOP' || next.cmd === 'S';
  const last = steps[steps.length - 1];
  const isLastSlider =
    last &&
    (last.cmd === 'CMD_SLIDER_LEFT' ||
      last.cmd === 'L' ||
      last.cmd === 'CMD_SLIDER_RIGHT' ||
      last.cmd === 'R');

  if (isStop && isLastSlider) {
    const elapsedMs = Math.max(200, Math.min(15000, Math.round(next.timestampMs - last.recordedAtMs)));
    const prevDur = typeof last.params?.duration === 'number' ? last.params.duration : 3000;
    // Only collapse if stop happened before the programmed timeout (e.g., Tahan L/R release or early S)
    if (elapsedMs < prevDur - 50 || last.label.includes('Tahan')) {
      const nextParams: Record<string, unknown> = { ...(last.params ?? {}), duration: elapsedMs };
      const dirLabel = last.cmd === 'CMD_SLIDER_LEFT' || last.cmd === 'L' ? 'Kiri' : 'Kanan';
      const bypassSuffix = nextParams.ignore_limit ? ', Bypass' : '';
      const updatedLast: RecordedRoutineStep = {
        ...last,
        label: `L298N ${dirLabel} (${(elapsedMs / 1000).toFixed(1)}s${bypassSuffix})`,
        params: nextParams,
        waitAfterMs: elapsedMs + 250,
      };
      return [...steps.slice(0, -1), updatedLast];
    }
  }

  // Update waitAfterMs on the previous step based on actual operator timing
  const updated = steps.map((step, idx) => {
    if (idx !== steps.length - 1) return step;
    const gap = Math.max(0, next.timestampMs - step.recordedAtMs);
    return {
      ...step,
      waitAfterMs: computeWaitAfterCommandMs(step.cmd, step.params, gap),
    };
  });

  const defaultWait = computeWaitAfterCommandMs(next.cmd, next.params, 650);
  return [
    ...updated,
    {
      id: next.id,
      cmd: next.cmd,
      label: next.label,
      params: next.params ? { ...next.params } : undefined,
      recordedAtMs: next.timestampMs,
      waitAfterMs: defaultWait,
    },
  ];
}

/**
 * Generates "Kembali ke Semula" (Return-to-Origin) commands for a recorded routine:
 * 1) Turns pump off if left running
 * 2) Restores the 4-DoF Arm to initialServoAngles
 * 3) Reverses net L298N linear slider travel duration back toward origin
 */
export function buildReturnToOriginCommands(
  routine: Pick<RobotRoutine, 'initialServoAngles' | 'steps'>,
  ignoreRailLimitsFallback: boolean
): RoutineReplayAction[] {
  const actions: RoutineReplayAction[] = [];
  let netLeftMs = 0;
  let usedBypass = ignoreRailLimitsFallback;
  let touchedArm = false;
  let pumpLeftOn = false;

  for (const step of routine.steps) {
    if (step.cmd === 'CMD_SLIDER_LEFT' || step.cmd === 'L') {
      const dur = typeof step.params?.duration === 'number' && Number.isFinite(step.params.duration) ? step.params.duration : 1500;
      netLeftMs += Math.max(0, Math.round(dur));
      if (step.params?.ignore_limit === true) usedBypass = true;
    } else if (step.cmd === 'CMD_SLIDER_RIGHT' || step.cmd === 'R') {
      const dur = typeof step.params?.duration === 'number' && Number.isFinite(step.params.duration) ? step.params.duration : 1500;
      netLeftMs -= Math.max(0, Math.round(dur));
      if (step.params?.ignore_limit === true) usedBypass = true;
    } else if (
      step.cmd === 'CMD_SET_SERVO' ||
      step.cmd === 'CMD_ARM_HOME' ||
      step.cmd === 'CMD_PARK_SAFE_ZONE' ||
      step.cmd === 'CMD_RETRACT_ARM'
    ) {
      touchedArm = true;
    } else if (step.cmd === 'CMD_START_IRRIGATION' || step.cmd === 'CMD_START_MISTING') {
      pumpLeftOn = true;
    } else if (step.cmd === 'CMD_STOP_PUMP') {
      pumpLeftOn = false;
    }
  }

  if (pumpLeftOn) {
    actions.push({
      cmd: 'CMD_STOP_PUMP',
      label: 'Kembali Semula: Matikan Pompa',
      waitMs: 300,
    });
  }

  if (touchedArm) {
    const [b, s, e, n] = routine.initialServoAngles;
    actions.push({
      cmd: 'CMD_SET_SERVO',
      label: `Kembali Sudut Awal Arm (${b}°/${s}°/${e}°/${n}°)`,
      params: { base: b, shoulder: s, elbow: e, nozzle: n },
      waitMs: 750,
    });
  }

  // Compensate net rail travel in chunks up to 15000ms
  let remainingReverse = Math.abs(netLeftMs);
  if (remainingReverse >= 150) {
    const reverseCmd = netLeftMs > 0 ? 'CMD_SLIDER_RIGHT' : 'CMD_SLIDER_LEFT';
    const reverseDirLabel = netLeftMs > 0 ? 'Kanan' : 'Kiri';
    while (remainingReverse >= 150) {
      const chunk = Math.min(15000, remainingReverse);
      const params: Record<string, unknown> = { duration: chunk };
      if (usedBypass) params.ignore_limit = true;
      actions.push({
        cmd: reverseCmd,
        label: `Kembali Semula: L298N ${reverseDirLabel} (${(chunk / 1000).toFixed(1)}s)`,
        params,
        waitMs: chunk + 300,
      });
      remainingReverse -= chunk;
    }
  }

  return actions;
}

export function loadSavedRoutine(): RobotRoutine | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ROUTINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RobotRoutine>;
    if (!parsed || !Array.isArray(parsed.steps) || !Array.isArray(parsed.initialServoAngles) || parsed.initialServoAngles.length < 4) {
      return null;
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Rutinitas Rekaman',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      initialServoAngles: [
        Number(parsed.initialServoAngles[0]) || 90,
        Number(parsed.initialServoAngles[1]) || 45,
        Number(parsed.initialServoAngles[2]) || 45,
        Number(parsed.initialServoAngles[3]) || 90,
      ],
      steps: parsed.steps.filter(
        (st): st is RecordedRoutineStep =>
          Boolean(st) && typeof st.cmd === 'string' && typeof st.label === 'string' && typeof st.waitAfterMs === 'number'
      ),
    };
  } catch {
    return null;
  }
}

export function saveRecordedRoutine(routine: RobotRoutine | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!routine) {
      window.localStorage.removeItem(ROUTINE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ROUTINE_STORAGE_KEY, JSON.stringify(routine));
    }
  } catch {
    // ignore quota errors
  }
}
