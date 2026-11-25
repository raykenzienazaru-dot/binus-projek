import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMqttConnectPacket,
  buildMqttPublishPacket,
  buildMqttSubscribePacket,
  encodeRemainingLength,
  parseMqttPacket,
} from './mqttWssClient.ts';

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
