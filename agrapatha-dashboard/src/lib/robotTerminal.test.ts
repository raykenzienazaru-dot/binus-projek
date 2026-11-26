import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotTerminalCommand } from './robotTerminal.ts';

describe('Robot Terminal CLI Parser Tests', () => {
  const defaultAngles: [number, number, number, number] = [90, 45, 45, 90];

  test('parses single-joint servo shorthand commands and clamps 0..180', () => {
    const j1 = parseRobotTerminalCommand('1 120', defaultAngles, false);
    assert.ok(j1 && j1.type === 'mqtt');
    assert.equal(j1.cmd, 'CMD_SET_SERVO');
    assert.deepEqual(j1.params, { base: 120 });
    assert.deepEqual(j1.nextServoAngles, [120, 45, 45, 90]);

    const sh = parseRobotTerminalCommand('sh=250', defaultAngles, false);
    assert.ok(sh && sh.type === 'mqtt');
    assert.deepEqual(sh.params, { shoulder: 180 });

    const el = parseRobotTerminalCommand('elbow 30°', defaultAngles, false);
    assert.ok(el && el.type === 'mqtt');
    assert.deepEqual(el.params, { elbow: 30 });

    const noz = parseRobotTerminalCommand('4 -15', defaultAngles, false);
    assert.ok(noz && noz.type === 'mqtt');
    assert.deepEqual(noz.params, { nozzle: 0 });
  });

  test('parses 4-axis servo command and bare 4-number vector', () => {
    const res1 = parseRobotTerminalCommand('servo 30 60 75 110', defaultAngles, false);
    assert.ok(res1 && res1.type === 'mqtt');
    assert.equal(res1.cmd, 'CMD_SET_SERVO');
    assert.deepEqual(res1.params, { base: 30, shoulder: 60, elbow: 75, nozzle: 110 });

    const res2 = parseRobotTerminalCommand('60 50 40 100', defaultAngles, false);
    assert.ok(res2 && res2.type === 'mqtt');
    assert.deepEqual(res2.nextServoAngles, [60, 50, 40, 100]);
  });

  test('parses L298N OUT3/OUT4 left, right, duration, bypass, and stop commands', () => {
    const leftDefault = parseRobotTerminalCommand('L', defaultAngles, false);
    assert.ok(leftDefault && leftDefault.type === 'mqtt');
    assert.equal(leftDefault.cmd, 'CMD_SLIDER_LEFT');
    assert.deepEqual(leftDefault.params, { duration: 3000 });

    const rightBypass = parseRobotTerminalCommand('r 2.5s bypass', defaultAngles, false);
    assert.ok(rightBypass && rightBypass.type === 'mqtt');
    assert.equal(rightBypass.cmd, 'CMD_SLIDER_RIGHT');
    assert.deepEqual(rightBypass.params, { duration: 2500, ignore_limit: true });

    const stop = parseRobotTerminalCommand('s', defaultAngles, false);
    assert.ok(stop && stop.type === 'mqtt');
    assert.equal(stop.cmd, 'CMD_SLIDER_STOP');
  });

  test('parses cam, pump, emergency, home, mode, utilities, and raw JSON', () => {
    assert.deepEqual(parseRobotTerminalCommand('c', defaultAngles, false), { type: 'capture_cam' });
    assert.deepEqual(parseRobotTerminalCommand('help', defaultAngles, false), { type: 'help' });
    assert.deepEqual(parseRobotTerminalCommand('clear', defaultAngles, false), { type: 'clear' });
    assert.deepEqual(parseRobotTerminalCommand('bypass on', defaultAngles, false), {
      type: 'set_limit_bypass',
      enabled: true,
    });

    const estop = parseRobotTerminalCommand('estop', defaultAngles, false);
    assert.ok(estop && estop.type === 'mqtt' && estop.cmd === 'CMD_EMERGENCY_STOP');

    const reset = parseRobotTerminalCommand('reset', defaultAngles, false);
    assert.ok(reset && reset.type === 'mqtt' && reset.cmd === 'CMD_RESET_EMERGENCY');

    const pump = parseRobotTerminalCommand('pump on 5s', defaultAngles, false);
    assert.ok(pump && pump.type === 'mqtt' && pump.cmd === 'CMD_START_IRRIGATION');
    assert.deepEqual(pump.params, { duration: 5000 });

    const raw = parseRobotTerminalCommand('{"cmd":"CMD_SLIDER_LEFT","params":{"duration":4000}}', defaultAngles, false);
    assert.ok(raw && raw.type === 'mqtt');
    assert.equal(raw.cmd, 'CMD_SLIDER_LEFT');
    assert.deepEqual(raw.params, { duration: 4000 });
  });

  test('returns structured error for unknown command instead of throwing', () => {
    const err = parseRobotTerminalCommand('foobar 123', defaultAngles, false);
    assert.ok(err && err.type === 'error');
    assert.ok(err.message.includes('help'));
  });
});
