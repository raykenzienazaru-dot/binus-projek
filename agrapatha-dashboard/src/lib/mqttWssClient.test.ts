import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMqttConnectPacket,
  buildMqttPublishPacket,
  buildMqttSubscribePacket,
  encodeRemainingLength,
  parseMqttPacket,
  parseMqttPackets,
} from './mqttWssClient.ts';
import { parseGatewayTelemetry } from './gatewayService.ts';

describe('EMQX MQTT 3.1.1 over WebSocket Codec Tests', () => {
  test('encodes single-byte and multi-byte remaining length per MQTT 3.1.1 spec', () => {
    assert.deepEqual(Array.from(encodeRemainingLength(64)), [0x40]);
    assert.deepEqual(Array.from(encodeRemainingLength(127)), [0x7f]);
    assert.deepEqual(Array.from(encodeRemainingLength(128)), [0x80, 0x01]);
    assert.deepEqual(Array.from(encodeRemainingLength(16383)), [0xff, 0x7f]);
  });

  test('builds valid CONNECT packet with username and password flags', () => {
    const pkt = buildMqttConnectPacket('client-1', 'agrapatha', 'secret123', 45);
    assert.equal(pkt[0], 0x10);
    // Protocol 'MQTT'
    const proto = String.fromCharCode(pkt[4], pkt[5], pkt[6], pkt[7]);
    assert.equal(proto, 'MQTT');
    assert.equal(pkt[8], 0x04); // Level 3.1.1
    assert.equal(pkt[9], 0xc2); // Username (0x80) + Password (0x40) + CleanSession (0x02)
  });

  test('builds and parses PUBLISH packet round-trip cleanly', () => {
    const payload = JSON.stringify({ cmd: 'CMD_FIRE_SUPPRESSION', params: { duration: 4000 } });
    const pkt = buildMqttPublishPacket('agrapatha/commands', payload);
    const parsed = parseMqttPacket(pkt);
    assert.ok(parsed && parsed.type === 'PUBLISH');
    assert.equal(parsed.publish.topic, 'agrapatha/commands');
    assert.equal(parsed.publish.payload, payload);
  });

  test('decodes multiple coalesced MQTT frames in a single WebSocket binary buffer', () => {
    const suback = new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]);
    const livePayload = JSON.stringify({
      temperature: 28.5,
      humidity: 64.2,
      soil_moisture: 42.1,
      soil_raw: 2450,
      flame_detected: 1,
      flame_ch: [0, 1, 0, 0, 0],
      flame_direction: 'Kiri (CH2)',
      flame_angle: 60,
      arm_manual_mode: true,
      zone: 2,
      pump_status: false,
      pump_lockout: false,
      servo_angles: [90, 45, 45, 90],
      system_state: 'SCANNING_ZONES',
      env_condition: 'KEBAKARAN',
      action_command: 'CMD_FIRE_SUPPRESSION',
      command_label: 'PERINTAH: SEMPROT Kiri (CH2) (60 deg)',
      command_payload: { cmd: 'CMD_FIRE_SUPPRESSION', params: { duration: 4000 } },
    });
    const pub = buildMqttPublishPacket('agrapatha/telemetry', livePayload);
    const combined = new Uint8Array(suback.length + pub.length);
    combined.set(suback, 0);
    combined.set(pub, suback.length);

    const frames = parseMqttPackets(combined);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].type, 'SUBACK');
    assert.equal(frames[1].type, 'PUBLISH');
    if (frames[1].type === 'PUBLISH') {
      const normalized = parseGatewayTelemetry({
        ...(JSON.parse(frames[1].publish.payload) as Record<string, unknown>),
        freshness: 'FRESH',
        timestamp: Date.now(),
      });
      assert.ok(normalized);
      assert.equal(normalized.temp, 28.5);
      assert.equal(normalized.flameDetected, 1);
      assert.deepEqual(normalized.flameChannels, [0, 1, 0, 0, 0]);
      assert.equal(normalized.flameDirection, 'Kiri (CH2)');
      assert.equal(normalized.flameAngle, 60);
      assert.equal(normalized.armManualMode, true);
      assert.equal(normalized.systemState, 'SCANNING_ZONES');
    }
  });

  test('builds valid SUBSCRIBE packet and parses CONNACK/SUBACK/PINGRESP', () => {
    const sub = buildMqttSubscribePacket(1, 'agrapatha/telemetry');
    assert.equal(sub[0], 0x82);
    assert.deepEqual(parseMqttPacket(new Uint8Array([0x20, 0x02, 0x00, 0x00])), {
      type: 'CONNACK',
      returnCode: 0,
    });
    assert.deepEqual(parseMqttPacket(new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00])), {
      type: 'SUBACK',
    });
    assert.deepEqual(parseMqttPacket(new Uint8Array([0xd0, 0x00])), {
      type: 'PINGRESP',
    });
  });
});
