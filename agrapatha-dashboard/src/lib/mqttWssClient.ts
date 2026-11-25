/**
 * AGRAPATHA — Zero-Dependency Browser MQTT 3.1.1 over WebSocket (WSS Port 8084) Client
 * Connects directly from browser to EMQX Cloud Serverless (wss://<host>:8084/mqtt)
 * for real-time telemetry reception and two-way robot action command dispatch.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMqttString(str: string): Uint8Array {
  const utf8 = textEncoder.encode(str);
  const out = new Uint8Array(2 + utf8.length);
  out[0] = (utf8.length >> 8) & 0xff;
  out[1] = utf8.length & 0xff;
  out.set(utf8, 2);
  return out;
}

export function encodeRemainingLength(length: number): Uint8Array {
  const bytes: number[] = [];
  let x = length;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) {
      encodedByte = encodedByte | 128;
    }
    bytes.push(encodedByte);
  } while (x > 0);
  return new Uint8Array(bytes);
}

export function buildMqttConnectPacket(clientId: string, username?: string, password?: string, keepAliveSec = 60): Uint8Array {
  const hasUser = Boolean(username && username.length > 0);
  const hasPass = Boolean(password && password.length > 0);

  let flags = 0x02; // Clean Session
  if (hasUser) flags |= 0x80;
  if (hasPass) flags |= 0x40;

  const clientIdBytes = encodeMqttString(clientId);
  const userBytes = hasUser ? encodeMqttString(username!) : new Uint8Array(0);
  const passBytes = hasPass ? encodeMqttString(password!) : new Uint8Array(0);

  // Variable header (10 bytes): Protocol Name 'MQTT' (6), Level 4 (1), Flags (1), KeepAlive (2)
  const varHeader = new Uint8Array([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54,
    0x04,
    flags,
    (keepAliveSec >> 8) & 0xff,
    keepAliveSec & 0xff,
  ]);

  const remainingLen = varHeader.length + clientIdBytes.length + userBytes.length + passBytes.length;
  const remBytes = encodeRemainingLength(remainingLen);

  const packet = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  packet[offset++] = 0x10; // CONNECT
  packet.set(remBytes, offset); offset += remBytes.length;
  packet.set(varHeader, offset); offset += varHeader.length;
  packet.set(clientIdBytes, offset); offset += clientIdBytes.length;
  packet.set(userBytes, offset); offset += userBytes.length;
  packet.set(passBytes, offset);
  return packet;
}

export function buildMqttSubscribePacket(packetId: number, topic: string): Uint8Array {
  const topicBytes = encodeMqttString(topic);
  const remainingLen = 2 + topicBytes.length + 1;
  const remBytes = encodeRemainingLength(remainingLen);

  const packet = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  packet[offset++] = 0x82; // SUBSCRIBE (QoS 1 header flag)
  packet.set(remBytes, offset); offset += remBytes.length;
  packet[offset++] = (packetId >> 8) & 0xff;
  packet[offset++] = packetId & 0xff;
  packet.set(topicBytes, offset); offset += topicBytes.length;
  packet[offset++] = 0x00; // Requested QoS 0
  return packet;
}

export function buildMqttPublishPacket(topic: string, payload: string): Uint8Array {
  const topicBytes = encodeMqttString(topic);
  const payloadBytes = textEncoder.encode(payload);
  const remainingLen = topicBytes.length + payloadBytes.length;
  const remBytes = encodeRemainingLength(remainingLen);

  const packet = new Uint8Array(1 + remBytes.length + remainingLen);
  let offset = 0;
  packet[offset++] = 0x30; // PUBLISH QoS 0
  packet.set(remBytes, offset); offset += remBytes.length;
  packet.set(topicBytes, offset); offset += topicBytes.length;
  packet.set(payloadBytes, offset);
  return packet;
}

export interface DecodedMqttPublish {
  topic: string;
  payload: string;
}

export type DecodedMqttFrame =
  | { type: 'CONNACK'; returnCode: number }
  | { type: 'PUBLISH'; publish: DecodedMqttPublish }
  | { type: 'SUBACK' }
  | { type: 'PINGRESP' }
  | { type: 'OTHER'; packetType: number };

export function parseMqttPacket(buf: Uint8Array): DecodedMqttFrame | null {
  if (buf.length < 2) return null;
  const headerByte = buf[0];
  const packetType = (headerByte >> 4) & 0x0f;

  // Decode remaining length
  let multiplier = 1;
  let value = 0;
  let idx = 1;
  let encodedByte = 0;
  do {
    if (idx >= buf.length) return null;
    encodedByte = buf[idx++];
    value += (encodedByte & 127) * multiplier;
    multiplier *= 128;
    if (multiplier > 128 * 128 * 128 * 128) return null;
  } while ((encodedByte & 128) !== 0);

  if (buf.length < idx + value) return null;

  if (packetType === 2 && value >= 2) {
    // CONNACK
    return { type: 'CONNACK', returnCode: buf[idx + 1] };
  }
  if (packetType === 3) {
    // PUBLISH
    const qos = (headerByte >> 1) & 0x03;
    if (idx + 2 > buf.length) return null;
    const topicLen = (buf[idx] << 8) | buf[idx + 1];
    idx += 2;
    if (idx + topicLen > buf.length) return null;
    const topic = textDecoder.decode(buf.subarray(idx, idx + topicLen));
    idx += topicLen;
    if (qos > 0) {
      idx += 2; // Skip Packet Identifier
    }
    const payloadEnd = Math.min(buf.length, idx + (value - (2 + topicLen + (qos > 0 ? 2 : 0))));
    const payload = textDecoder.decode(buf.subarray(idx, payloadEnd));
    return { type: 'PUBLISH', publish: { topic, payload } };
  }
  if (packetType === 9) return { type: 'SUBACK' };
  if (packetType === 13) return { type: 'PINGRESP' };
  return { type: 'OTHER', packetType };
}

export interface MqttWssOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  telemetryTopic?: string;
  onConnect?: () => void;
  onMessage?: (topic: string, payload: string) => void;
  onError?: (err: string) => void;
  onClose?: () => void;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export class MqttWssClient {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private packetCounter = 1;
  private readonly opts: MqttWssOptions;

  constructor(options: MqttWssOptions) {
    this.opts = options;
  }

  public connect(): void {
    this.disconnect();
    const port = this.opts.port || 8084;
    const url = `wss://${this.opts.host}:${port}/mqtt`;
    const clientId = `agrapatha-web-${Math.random().toString(16).slice(2, 10)}`;

    try {
      const ws = new WebSocket(url, ['mqtt']);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        const pkt = buildMqttConnectPacket(clientId, this.opts.username, this.opts.password, 45);
        ws.send(toArrayBuffer(pkt));
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (!(evt.data instanceof ArrayBuffer)) return;
        const frame = parseMqttPacket(new Uint8Array(evt.data));
        if (!frame) return;

        if (frame.type === 'CONNACK') {
          if (frame.returnCode === 0) {
            this.isConnected = true;
            const topic = this.opts.telemetryTopic || 'agrapatha/telemetry';
            ws.send(toArrayBuffer(buildMqttSubscribePacket(this.packetCounter++, topic)));
            this.pingTimer = setInterval(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(toArrayBuffer(new Uint8Array([0xc0, 0x00]))); // PINGREQ
              }
            }, 30000);
            this.opts.onConnect?.();
          } else {
            const reasons: Record<number, string> = {
              1: 'Protokol tidak didukung',
              2: 'Client ID ditolak',
              3: 'Broker tidak tersedia',
              4: 'Username atau Password salah',
              5: 'Tidak diotorisasi (Not Authorized)',
            };
            this.opts.onError?.(`EMQX Auth Gagal (rc=${frame.returnCode}): ${reasons[frame.returnCode] || 'Unknown'}`);
            this.disconnect();
          }
        } else if (frame.type === 'PUBLISH') {
          this.opts.onMessage?.(frame.publish.topic, frame.publish.payload);
        }
      };

      ws.onerror = () => {
        this.opts.onError?.(`Gagal terhubung ke EMQX WebSocket TLS (${url})`);
      };

      ws.onclose = () => {
        this.cleanupTimers();
        this.isConnected = false;
        this.opts.onClose?.();
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.onError?.(`WebSocket error: ${msg}`);
    }
  }

  public publish(topic: string, payload: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnected) {
      return false;
    }
    this.ws.send(toArrayBuffer(buildMqttPublishPacket(topic, payload)));
    return true;
  }

  public getConnected(): boolean {
    return this.isConnected;
  }

  private cleanupTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public disconnect(): void {
    this.cleanupTimers();
    this.isConnected = false;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new Uint8Array([0xe0, 0x00])); // DISCONNECT
        }
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
