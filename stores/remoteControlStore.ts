import { create } from 'zustand';
import { remoteControlService } from '@/services/remoteControlService';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RemoteControlStore');

// 远程输入消息。用对象而不是「文本_时间戳」拼接字符串：旧实现里手动
// setMessage 会拼 `_${Date.now()}` 后缀而真实的 onMessage 路径不拼，导致
// ① 连续两条相同文本时状态不变、useEffect 不重新触发（第二条输入被吞）
// ② 消费方用 split("_")[0] 剥离后缀，会把本身含下划线的输入截断。
export interface RemoteMessage {
  text: string;
  id: number; // 单调递增，保证相同文本也始终是一条新消息
}

let messageSeq = 0;
const nextMessageId = () => ++messageSeq;

interface RemoteControlState {
  isServerRunning: boolean;
  serverUrl: string | null;
  error: string | null;
  startServer: () => Promise<void>;
  stopServer: () => void;
  isModalVisible: boolean;
  showModal: (targetPage?: string) => void;
  hideModal: () => void;
  lastMessage: RemoteMessage | null;
  targetPage: string | null;
  setMessage: (message: string, targetPage?: string) => void;
  clearMessage: () => void;
}

export const useRemoteControlStore = create<RemoteControlState>((set, get) => ({
  isServerRunning: false,
  serverUrl: null,
  error: null,
  isModalVisible: false,
  lastMessage: null,
  targetPage: null,

  startServer: async () => {
    if (get().isServerRunning) {
      return;
    }
    remoteControlService.init({
      onMessage: (message: string) => {
        logger.debug('Received message:', message);
        const currentState = get();
        // Use the current targetPage from the store
        set({ lastMessage: { text: message, id: nextMessageId() }, targetPage: currentState.targetPage });
      },
      onHandshake: () => {
        logger.debug('Handshake successful');
        set({ isModalVisible: false })
      },
    });
    try {
      const url = await remoteControlService.startServer();
      logger.info('Server started, URL:', url);
      set({ isServerRunning: true, serverUrl: url, error: null });
    } catch {
      const errorMessage = '启动失败，请强制退应用后重试。';
      logger.error('Failed to start server:', errorMessage);
      set({ error: errorMessage });
    }
  },

  stopServer: () => {
    if (get().isServerRunning) {
      remoteControlService.stopServer();
      set({ isServerRunning: false, serverUrl: null });
    }
  },

  showModal: (targetPage?: string) => set({ isModalVisible: true, targetPage }),
  hideModal: () => set({ isModalVisible: false, targetPage: null }),

  setMessage: (message: string, targetPage?: string) => {
    set({ lastMessage: { text: message, id: nextMessageId() }, targetPage });
  },

  clearMessage: () => {
    set({ lastMessage: null, targetPage: null });
  },
}));
