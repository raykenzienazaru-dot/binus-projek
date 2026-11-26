import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRecordedStep,
  buildReturnToOriginCommands,
  computeWaitAfterCommandMs,
  type RecordedRoutineStep,
} from './robotRoutine.ts';

describe('Robot Routine Recorder & Return-to-Origin Tests', () => {
  test('collapses hold slider + stop pair into exact elapsed duration', () => {
    let steps: RecordedRoutineStep[] = [];
    steps = appendRecordedStep(steps, {
      id: 1,
      cmd: 'CMD_SLIDER_LEFT',
      label: 'Tahan Rel Kiri (L298N OUT3/4)',
      params: { duration: 10000, ignore_limit: true },
      timestampMs: 1000,
    });
    steps = appendRecordedStep(steps, {
      id: 2,
      cmd: 'CMD_SLIDER_STOP',
      label: 'Stop Rel L298N (Lepas Tahan)',
      timestampMs: 2850,
    });

    assert.equal(steps.length, 1);
    assert.equal(steps[0].cmd, 'CMD_SLIDER_LEFT');
    assert.equal(steps[0].params?.duration, 1850);
    assert.equal(steps[0].params?.ignore_limit, true);
    assert.equal(steps[0].waitAfterMs, 2100);
  });

  test('computes bounded wait times while preserving physical slider duration', () => {
    assert.equal(computeWaitAfterCommandMs('CMD_SLIDER_RIGHT', { duration: 3000 }, 500), 3250);
    assert.equal(computeWaitAfterCommandMs('CMD_SET_SERVO', { base: 120 }, 15000), 4000);
    assert.equal(computeWaitAfterCommandMs('CMD_SET_SERVO', { base: 120 }, 100), 550);
  });

  test('builds return-to-origin actions restoring initial arm angles and reversing net L298N travel', () => {
    const returnActions = buildReturnToOriginCommands(
      {
        initialServoAngles: [90, 45, 45, 90],
        steps: [
          { id: 1, cmd: 'CMD_SLIDER_LEFT', label: 'L 3s', params: { duration: 3000 }, recordedAtMs: 1000, waitAfterMs: 3250 },
          { id: 2, cmd: 'CMD_SLIDER_RIGHT', label: 'R 1s', params: { duration: 1000 }, recordedAtMs: 4250, waitAfterMs: 1250 },
          { id: 3, cmd: 'CMD_SET_SERVO', label: 'Base 150', params: { base: 150 }, recordedAtMs: 5500, waitAfterMs: 650 },
          { id: 4, cmd: 'CMD_START_IRRIGATION', label: 'Pump 2s', params: { duration: 2000 }, recordedAtMs: 6200, waitAfterMs: 2200 },
        ],
      },
      false
    );

    assert.equal(returnActions.length, 3);
    assert.equal(returnActions[0].cmd, 'CMD_STOP_PUMP');
    assert.equal(returnActions[1].cmd, 'CMD_SET_SERVO');
    assert.deepEqual(returnActions[1].params, { base: 90, shoulder: 45, elbow: 45, nozzle: 90 });
    assert.equal(returnActions[2].cmd, 'CMD_SLIDER_RIGHT'); // Net +2000ms Left -> reverse 2000ms Right
    assert.deepEqual(returnActions[2].params, { duration: 2000 });
  });

  test('skips emergency and mode commands from being recorded into loop routine', () => {
    let steps: RecordedRoutineStep[] = [];
    steps = appendRecordedStep(steps, {
      id: 1,
      cmd: 'CMD_EMERGENCY_STOP',
      label: 'E-STOP',
      timestampMs: 1000,
    });
    assert.equal(steps.length, 0);
  });
});
