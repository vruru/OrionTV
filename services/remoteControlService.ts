import TCPHttpServer from "./tcpHttpServer";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RemoteControl');

const getRemotePageHTML = () => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>OrionTV Remote</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #121212; color: white; }
      h3 { color: #eee; }
      #container { display: flex; flex-direction: column; align-items: center; width: 90%; max-width: 400px; }
      #text { width: 100%; padding: 15px; font-size: 16px; border-radius: 8px; border: 1px solid #333; background-color: #2a2a2a; color: white; margin-bottom: 20px; box-sizing: border-box; }
      button { width: 100%; padding: 15px; font-size: 18px; font-weight: bold; border: none; border-radius: 8px; background-color: #007AFF; color: white; cursor: pointer; }
      button:active { background-color: #0056b3; }
      #status { font-size: 12px; color: #888; margin-bottom: 12px; }
      #status.ok { color: #4caf50; }
      #status.bad { color: #f44336; }
    </style>
  </head>
  <body>
    <div id="container">
      <h3>向电视发送文本</h3>
      <div id="status">连接中…</div>
      <input id="text" placeholder="请输入..." />
      <button onclick="send()">发送</button>
    </div>
    <script>
      // 注意：这里的 JS 运行在手机浏览器里，不能引用 App 侧的 logger。
      // 优先走 WebSocket（长连接、低延迟），连接失败自动降级为 HTTP POST。
      var ws = null;
      var wsReady = false;
      var statusEl = document.getElementById('status');

      function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = cls || '';
      }

      function connect() {
        try {
          ws = new WebSocket('ws://' + location.host + '/ws');
          ws.onopen = function() {
            wsReady = true;
            setStatus('已连接（WebSocket）', 'ok');
            ws.send(JSON.stringify({ type: 'handshake' }));
          };
          ws.onclose = function() {
            wsReady = false;
            setStatus('连接断开，3 秒后重连…', 'bad');
            setTimeout(connect, 3000);
          };
          ws.onerror = function() {
            wsReady = false;
          };
        } catch (e) {
          setStatus('WebSocket 不可用，使用兼容模式', 'bad');
        }
      }

      window.addEventListener('DOMContentLoaded', function() {
        connect();
        // 兼容模式兜底：即使 WS 不可用也发一次握手
        fetch('/handshake', { method: 'POST' }).catch(function(err) { console.error('Handshake failed:', err); });
      });

      function send() {
        var input = document.getElementById("text");
        var value = input.value;
        if (!value) return;
        if (wsReady && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ message: value }));
        } else {
          // 降级：HTTP POST（老路径，任何浏览器都可用）
          fetch("/message", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: value })
          }).catch(function(err) { console.error('Message send failed:', err); });
        }
        input.value = '';
      }
    </script>
  </body>
  </html>
  `;
};

class RemoteControlService {
  private httpServer: TCPHttpServer;
  private onMessage: (message: string) => void = () => {};
  private onHandshake: () => void = () => {};

  constructor() {
    this.httpServer = new TCPHttpServer();
    this.setupRequestHandler();
    // WebSocket 通道：消息与握手都支持；连接断开后页面会自动重连
    this.httpServer.setWebSocketHandler({
      onMessage: (_conn, text) => {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "handshake") {
            this.onHandshake();
          } else if (parsed.message) {
            this.onMessage(parsed.message);
          }
        } catch {
          // 非 JSON 文本按纯文本消息处理
          this.onMessage(text);
        }
      },
      onClose: () => {
        logger.debug("[RemoteControl] WebSocket client disconnected");
      },
    });
  }

  private setupRequestHandler() {
    this.httpServer.setRequestHandler((request) => {
      logger.debug("[RemoteControl] Received request:", request.method, request.url);

      try {
        if (request.method === "GET" && request.url === "/") {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
            body: getRemotePageHTML(),
          };
        } else if (request.method === "POST" && request.url === "/message") {
          try {
            const parsedBody = JSON.parse(request.body || "{}");
            const message = parsedBody.message;
            if (message) {
              this.onMessage(message);
            }
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "ok" }),
            };
          } catch (parseError) {
            logger.info("[RemoteControl] Failed to parse message body:", parseError);
            return {
              statusCode: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "Invalid JSON" }),
            };
          }
        } else if (request.method === "POST" && request.url === "/handshake") {
          this.onHandshake();
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ok" }),
          };
        } else {
          return {
            statusCode: 404,
            headers: { "Content-Type": "text/plain" },
            body: "Not Found",
          };
        }
      } catch (error) {
        logger.info("[RemoteControl] Request handler error:", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Internal Server Error" }),
        };
      }
    });
  }

  public init(actions: { onMessage: (message: string) => void; onHandshake: () => void }) {
    this.onMessage = actions.onMessage;
    this.onHandshake = actions.onHandshake;
  }

  public async startServer(): Promise<string> {
    logger.debug("[RemoteControl] Attempting to start server...");

    try {
      const url = await this.httpServer.start();
      logger.debug(`[RemoteControl] Server started successfully at: ${url}`);
      return url;
    } catch (error) {
      logger.info("[RemoteControl] Failed to start server:", error);
      throw new Error(error instanceof Error ? error.message : "Failed to start server");
    }
  }

  public stopServer() {
    logger.debug("[RemoteControl] Stopping server...");
    this.httpServer.stop();
  }

  public isRunning(): boolean {
    return this.httpServer.getIsRunning();
  }
}

export const remoteControlService = new RemoteControlService();
