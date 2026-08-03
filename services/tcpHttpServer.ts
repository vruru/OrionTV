import TcpSocket from 'react-native-tcp-socket';
import NetInfo from '@react-native-community/netinfo';
import Logger from '@/utils/Logger';
import {
  WebSocketFrameParser,
  computeAcceptKey,
  encodeTextFrame,
  encodePongFrame,
  encodeCloseFrame,
  utf8Encode,
} from './webSocketProtocol';

const logger = Logger.withTag('TCPHttpServer');

const PORT = 12346;

/** WebSocket 连接抽象：对调用方暴露发送文本与关闭能力 */
export interface WebSocketConnection {
  id: number;
  sendText: (text: string) => void;
  close: () => void;
}

interface WebSocketHandler {
  onOpen?: (conn: WebSocketConnection) => void;
  onMessage: (conn: WebSocketConnection, text: string) => void;
  onClose?: (conn: WebSocketConnection) => void;
}

interface HttpRequest {
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: string;
}

interface HttpResponse {
  statusCode: number;
  headers: { [key: string]: string };
  body: string;
}

type RequestHandler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

class TCPHttpServer {
  private server: TcpSocket.Server | null = null;
  private isRunning = false;
  private requestHandler: RequestHandler | null = null;
  private wsHandler: WebSocketHandler | null = null;
  private connSeq = 0;

  constructor() {
    this.server = null;
  }

  private parseHttpRequest(data: string): HttpRequest | null {
    try {
      const lines = data.split('\r\n');
      const requestLine = lines[0].split(' ');
      
      if (requestLine.length < 3) {
        return null;
      }

      const method = requestLine[0];
      const url = requestLine[1];
      const headers: { [key: string]: string } = {};
      
      let bodyStartIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line === '') {
          bodyStartIndex = i + 1;
          break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      const body = bodyStartIndex > 0 ? lines.slice(bodyStartIndex).join('\r\n') : '';

      return { method, url, headers, body };
    } catch (error) {
      logger.info('[TCPHttpServer] Error parsing HTTP request:', error);
      return null;
    }
  }

  private formatHttpResponse(response: HttpResponse): string {
    const statusTexts: { [key: number]: string } = {
      200: 'OK',
      400: 'Bad Request',
      404: 'Not Found',
      500: 'Internal Server Error'
    };

    const statusText = statusTexts[response.statusCode] || 'Unknown';
    const headers = {
      'Content-Length': new TextEncoder().encode(response.body).length.toString(),
      'Connection': 'close',
      ...response.headers
    };

    let httpResponse = `HTTP/1.1 ${response.statusCode} ${statusText}\r\n`;
    
    for (const [key, value] of Object.entries(headers)) {
      httpResponse += `${key}: ${value}\r\n`;
    }
    
    httpResponse += '\r\n';
    httpResponse += response.body;

    return httpResponse;
  }

  public setRequestHandler(handler: RequestHandler) {
    this.requestHandler = handler;
  }

  /** 注册 WebSocket 处理器；之后带 Upgrade 头的连接会升级为 WS，不再走 HTTP 路径 */
  public setWebSocketHandler(handler: WebSocketHandler) {
    this.wsHandler = handler;
  }

  /** tcp-socket 的 data 可能是 Buffer 或 string，统一转成字节数组 */
  private toBytes(data: string | Buffer): Uint8Array {
    if (typeof data === 'string') return utf8Encode(data);
    return new Uint8Array(data);
  }

  public async start(): Promise<string> {
    const netState = await NetInfo.fetch();
    let ipAddress: string | null = null;
    
    if (netState.type === 'wifi' || netState.type === 'ethernet') {
      ipAddress = (netState.details as any)?.ipAddress ?? null;
    }

    if (!ipAddress) {
      throw new Error('无法获取IP地址，请确认设备已连接到WiFi或以太网。');
    }

    if (this.isRunning) {
      logger.debug('[TCPHttpServer] Server is already running.');
      return `http://${ipAddress}:${PORT}`;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = TcpSocket.createServer((socket: TcpSocket.Socket) => {
          logger.debug('[TCPHttpServer] Client connected');

          let requestData = '';
          let upgraded = false;
          const frameParser = new WebSocketFrameParser();
          const connId = ++this.connSeq;
          const conn: WebSocketConnection = {
            id: connId,
            sendText: (text: string) => {
              try {
                socket.write(encodeTextFrame(text));
              } catch (e) {
                logger.info('[TCPHttpServer] WS send failed:', e);
              }
            },
            close: () => {
              try {
                socket.write(encodeCloseFrame());
              } catch {
                // 忽略关闭时的写入错误
              }
              socket.end();
            },
          };

          const handleWsBytes = (bytes: Uint8Array) => {
            for (const ev of frameParser.push(bytes)) {
              if (ev.type === 'message') {
                this.wsHandler?.onMessage(conn, ev.text);
              } else if (ev.type === 'ping') {
                try {
                  socket.write(encodePongFrame(ev.payload));
                } catch {
                  // 忽略
                }
              } else if (ev.type === 'close') {
                try {
                  socket.write(encodeCloseFrame());
                } catch {
                  // 忽略
                }
                this.wsHandler?.onClose?.(conn);
                socket.end();
              }
            }
          };

          socket.on('data', async (data: string | Buffer) => {
            // 已升级的连接：全部字节交给 WebSocket 帧解析器
            if (upgraded) {
              handleWsBytes(this.toBytes(data));
              return;
            }

            requestData += data.toString();

            // 必须等整个请求收完再处理：头部以 \r\n\r\n 结束，且 body 要达到
            // Content-Length 指定的字节数。之前只要看到头部结束符就解析，
            // 如果 POST body 在后续的 TCP 分片里才到达，就会被截断解析成无效 JSON。
            const headerEnd = requestData.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
              return; // 头部还没收完
            }
            const headerText = requestData.substring(0, headerEnd);

            // WebSocket 升级请求（GET + Upgrade: websocket）：完成握手后切换到帧模式
            if (this.wsHandler && /upgrade:\s*websocket/i.test(headerText)) {
              const keyMatch = /sec-websocket-key:\s*(\S+)/i.exec(headerText);
              if (keyMatch) {
                const accept = computeAcceptKey(keyMatch[1]);
                socket.write(
                  'HTTP/1.1 101 Switching Protocols\r\n' +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
                );
                upgraded = true;
                logger.debug(`[TCPHttpServer] WebSocket upgraded (conn ${connId})`);
                this.wsHandler.onOpen?.(conn);
                // 头部之后若还有残留字节，按 WS 帧继续解析
                const rest = requestData.substring(headerEnd + 4);
                requestData = '';
                if (rest.length > 0) {
                  handleWsBytes(utf8Encode(rest));
                }
                return;
              }
            }

            const contentLengthMatch = /content-length:\s*(\d+)/i.exec(headerText);
            const contentLength = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;
            if (contentLength > 0) {
              const body = requestData.substring(headerEnd + 4);
              // Content-Length 按字节计，JS 字符串按字符计（UTF-8 中文 3 字节/字符）
              const bodyBytes = new TextEncoder().encode(body).length;
              if (bodyBytes < contentLength) {
                return; // body 还没收完
              }
            }

            try {
              const request = this.parseHttpRequest(requestData);
              if (request && this.requestHandler) {
                const response = await this.requestHandler(request);
                const httpResponse = this.formatHttpResponse(response);
                socket.write(httpResponse);
              } else {
                // Send 400 Bad Request for malformed requests
                const errorResponse = this.formatHttpResponse({
                  statusCode: 400,
                  headers: { 'Content-Type': 'text/plain' },
                  body: 'Bad Request'
                });
                socket.write(errorResponse);
              }
            } catch (error) {
              logger.info('[TCPHttpServer] Error handling request:', error);
              const errorResponse = this.formatHttpResponse({
                statusCode: 500,
                headers: { 'Content-Type': 'text/plain' },
                body: 'Internal Server Error'
              });
              socket.write(errorResponse);
            }
            
            socket.end();
            requestData = '';
          });

          socket.on('error', (error: Error) => {
            logger.info('[TCPHttpServer] Socket error:', error);
          });

          socket.on('close', () => {
            if (upgraded) {
              this.wsHandler?.onClose?.(conn);
            }
            logger.debug('[TCPHttpServer] Client disconnected');
          });
        });

        this.server.listen({ port: PORT, host: '0.0.0.0' }, () => {
          logger.debug(`[TCPHttpServer] Server listening on ${ipAddress}:${PORT}`);
          this.isRunning = true;
          resolve(`http://${ipAddress}:${PORT}`);
        });

        this.server.on('error', (error: Error) => {
          logger.info('[TCPHttpServer] Server error:', error);
          this.isRunning = false;
          reject(error);
        });

      } catch (error) {
        logger.info('[TCPHttpServer] Failed to start server:', error);
        reject(error);
      }
    });
  }

  public stop() {
    if (this.server && this.isRunning) {
      this.server.close();
      this.server = null;
      this.isRunning = false;
      logger.debug('[TCPHttpServer] Server stopped');
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }
}

export default TCPHttpServer;
