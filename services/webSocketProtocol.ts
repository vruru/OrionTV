/**
 * 纯 JS 实现的 WebSocket 协议（RFC 6455）子集。
 *
 * React Native 没有内置 WebSocket 服务端，这里在 react-native-tcp-socket
 * 提供的裸 TCP 之上实现握手 + 帧编解码，不引入任何原生依赖。
 *
 * 支持：文本/二进制消息（含分片重组）、ping/pong、close。
 * 不支持：扩展协商、子协议、TLS（局域网场景不需要）。
 */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ---------------------------------------------------------------------------
// SHA-1（用于握手时的 Sec-WebSocket-Accept 计算）
// ---------------------------------------------------------------------------

function sha1(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const ml = data.length;
  const bitLen = ml * 8;
  const padZeros = (56 - ((ml + 1) % 64) + 64) % 64;
  const total = ml + 1 + padZeros + 8;

  const msg = new Uint8Array(total);
  msg.set(data);
  msg[ml] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(total - 4, bitLen >>> 0, false);

  const w = new Int32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = tmp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  odv.setInt32(0, h0, false);
  odv.setInt32(4, h1, false);
  odv.setInt32(8, h2, false);
  odv.setInt32(12, h3, false);
  odv.setInt32(16, h4, false);
  return out;
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? "=" : B64_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? "=" : B64_CHARS[b2 & 63];
  }
  return out;
}

// ---------------------------------------------------------------------------
// UTF-8
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

export function utf8Encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** 手写 UTF-8 解码（不依赖运行时的 TextDecoder，Hermes 上未必有） */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp =
        ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    } else {
      // 非法字节，跳过
      i += 1;
      continue;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 握手
// ---------------------------------------------------------------------------

/** 由请求头里的 Sec-WebSocket-Key 计算响应的 Sec-WebSocket-Accept */
export function computeAcceptKey(secWebSocketKey: string): string {
  return base64Encode(sha1(utf8Encode(secWebSocketKey + WS_GUID)));
}

// ---------------------------------------------------------------------------
// 帧编码（服务端 → 客户端，不掩码）
// ---------------------------------------------------------------------------

export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let header: number[];
  if (len < 126) {
    header = [0x80 | opcode, len];
  } else if (len < 65536) {
    header = [0x80 | opcode, 126, (len >> 8) & 0xff, len & 0xff];
  } else {
    header = [
      0x80 | opcode,
      127,
      0,
      0,
      0,
      0,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
    ];
  }
  const frame = new Uint8Array(header.length + len);
  frame.set(header);
  frame.set(payload, header.length);
  return frame;
}

export function encodeTextFrame(text: string): Uint8Array {
  return encodeFrame(0x1, utf8Encode(text));
}

export function encodePongFrame(payload: Uint8Array): Uint8Array {
  return encodeFrame(0xa, payload);
}

export function encodeCloseFrame(): Uint8Array {
  return encodeFrame(0x8, new Uint8Array(0));
}

// ---------------------------------------------------------------------------
// 帧解析（客户端 → 服务端，必须处理掩码与 TCP 分片）
// ---------------------------------------------------------------------------

export type WsEvent =
  | { type: "message"; text: string }
  | { type: "ping"; payload: Uint8Array }
  | { type: "pong"; payload: Uint8Array }
  | { type: "close" };

interface Frame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

export class WebSocketFrameParser {
  private buffer = new Uint8Array(0);
  private fragments: Uint8Array[] = [];
  private fragmentOpcode = -1;

  push(chunk: Uint8Array): WsEvent[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const events: WsEvent[] = [];
    for (;;) {
      const frame = this.tryReadFrame();
      if (!frame) break;
      const { fin, opcode, payload } = frame;

      if (opcode === 0x8) {
        events.push({ type: "close" });
        continue;
      }
      if (opcode === 0x9) {
        events.push({ type: "ping", payload });
        continue;
      }
      if (opcode === 0xa) {
        events.push({ type: "pong", payload });
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        if (opcode !== 0x0) {
          // 新消息的第一帧
          this.fragments = [payload];
          this.fragmentOpcode = opcode;
        } else if (this.fragmentOpcode !== -1) {
          this.fragments.push(payload);
        } else {
          continue; // 没有上下文的 continuation 帧，丢弃
        }
        if (fin) {
          const total = this.fragments.reduce((n, f) => n + f.length, 0);
          const full = new Uint8Array(total);
          let o = 0;
          for (const f of this.fragments) {
            full.set(f, o);
            o += f.length;
          }
          this.fragments = [];
          this.fragmentOpcode = -1;
          events.push({ type: "message", text: utf8Decode(full) });
        }
      }
      // 其他 opcode 保留未用，忽略
    }
    return events;
  }

  private tryReadFrame(): Frame | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = (buf[offset] << 8) | buf[offset + 1];
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      // 假定高 32 位为 0（局域网文本消息不可能超过 4GB）
      len = (buf[offset + 4] * 0x1000000 + ((buf[offset + 5] << 16) | (buf[offset + 6] << 8) | buf[offset + 7])) >>> 0;
      offset += 8;
    }

    let maskKey: Uint8Array | null = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) return null;

    let payload = buf.slice(offset, offset + len);
    if (maskKey) {
      const unmasked = new Uint8Array(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
      payload = unmasked;
    }

    this.buffer = buf.slice(offset + len);
    return { fin, opcode, payload };
  }
}
