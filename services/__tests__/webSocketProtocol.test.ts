import {
  computeAcceptKey,
  encodeTextFrame,
  encodeCloseFrame,
  WebSocketFrameParser,
  utf8Encode,
  utf8Decode,
} from "../webSocketProtocol";

describe("webSocketProtocol", () => {
  describe("computeAcceptKey", () => {
    it("应该匹配 RFC 6455 官方测试向量", () => {
      // RFC 6455 §1.3 示例：key 为 dGhlIHNhbXBsZSBub25jZQ== 时，
      // accept 必须为 s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
      expect(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    });
  });

  describe("utf8 编解码", () => {
    it("应该正确处理中文与 emoji", () => {
      const text = "你好 OrionTV 📺 abc";
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    });
  });

  describe("帧编码与解析", () => {
    it("客户端掩码帧应被正确解掩码并解码", () => {
      // 手工构造一个客户端掩码文本帧："hi"
      const payload = utf8Encode("hi");
      const mask = new Uint8Array([0x37, 0xfa, 0x21, 0x3d]);
      const masked = payload.map((b, i) => b ^ mask[i % 4]);
      const frame = new Uint8Array([0x81, 0x80 | payload.length, ...mask, ...masked]);

      const parser = new WebSocketFrameParser();
      const events = parser.push(frame);
      expect(events).toEqual([{ type: "message", text: "hi" }]);
    });

    it("TCP 分片到达时应等收齐后再产出消息", () => {
      const payload = utf8Encode("你好世界");
      const mask = new Uint8Array([1, 2, 3, 4]);
      const masked = payload.map((b, i) => b ^ mask[i % 4]);
      const full = new Uint8Array([0x81, 0x80 | payload.length, ...mask, ...masked]);

      const parser = new WebSocketFrameParser();
      // 逐字节送入，模拟极端分片
      for (let i = 0; i < full.length - 1; i++) {
        expect(parser.push(full.slice(i, i + 1))).toEqual([]);
      }
      const events = parser.push(full.slice(full.length - 1));
      expect(events).toEqual([{ type: "message", text: "你好世界" }]);
    });

    it("分片消息（FIN=0 + continuation）应重组", () => {
      const parser = new WebSocketFrameParser();
      // 第一帧：FIN=0, opcode=1, "你好"
      const p1 = utf8Encode("你好");
      const f1 = new Uint8Array([0x01, 0x80 | p1.length, 9, 9, 9, 9, ...p1.map((b, i) => b ^ 9)]);
      expect(parser.push(f1)).toEqual([]);
      // 第二帧：FIN=1, opcode=0, "世界"
      const p2 = utf8Encode("世界");
      const f2 = new Uint8Array([0x80, 0x80 | p2.length, 9, 9, 9, 9, ...p2.map((b, i) => b ^ 9)]);
      expect(parser.push(f2)).toEqual([{ type: "message", text: "你好世界" }]);
    });

    it("ping 帧应原样带出 payload 供回 pong", () => {
      const parser = new WebSocketFrameParser();
      const frame = new Uint8Array([0x89, 0x80, 5, 5, 5, 5]); // ping, masked, len=0
      const events = parser.push(frame);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("ping");
    });

    it("close 帧应产出 close 事件", () => {
      const parser = new WebSocketFrameParser();
      const frame = new Uint8Array([0x88, 0x80, 0, 0, 0, 0]);
      expect(parser.push(frame)).toEqual([{ type: "close" }]);
    });

    it("服务端发出的文本帧格式应正确（不掩码）", () => {
      const frame = encodeTextFrame("ok");
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(2); // 长度位，无掩码
      expect(utf8Decode(frame.slice(2))).toBe("ok");
    });

    it("长度 > 125 时应使用 16 位扩展长度", () => {
      const text = "a".repeat(300);
      const frame = encodeTextFrame(text);
      expect(frame[1]).toBe(126);
      expect((frame[2] << 8) | frame[3]).toBe(300);
    });

    it("close 帧编码应为 0x88 + 空负载", () => {
      const frame = encodeCloseFrame();
      expect(Array.from(frame)).toEqual([0x88, 0]);
    });
  });
});
