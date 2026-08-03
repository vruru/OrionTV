/**
 * react-native-tvos 会为一次长按发送开始(0)和结束(1)两个 longSelect 事件。
 * 业务动作只能在开始事件执行；少数遥控器不提供 action，此时按单次事件处理。
 */
export const isTVLongPressStart = (eventKeyAction?: number): boolean => eventKeyAction !== 1;
