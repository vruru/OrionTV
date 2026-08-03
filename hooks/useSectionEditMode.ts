/**
 * 设置模块的 TV 编辑模式状态机。
 *
 * 交互模型（与用户确认的规范一致）：
 *   1. 模块整体是唯一可聚焦单元（嵌套可聚焦元素在 Android TV 上会导致焦点卡死）
 *   2. 确认键进入编辑模式 → 上下键在模块内的目标（输入框/开关/按钮）间移动
 *   3. 确认键激活当前目标（开关立即翻转 / 输入框弹键盘）
 *   4. 输入框激活期间按键交给系统键盘；返回键先收起键盘
 *   5. 返回键退出编辑模式，回到模块间导航
 *
 * 注意：useTVEventHandler 只"监听"不"消费"，方向键仍会驱动系统焦点引擎。
 * 因此模块内的子元素必须 focusable={false}（输入框仅在激活时临时放开），
 * 系统焦点只能停在模块外层 Pressable 上，与直播页焦点陷阱同一套方案。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, useTVEventHandler } from "react-native";

interface UseSectionEditModeOptions {
  deviceType: string;
  /** 模块内可选目标数量 */
  itemCount: number;
  /** 外层模块是否持有焦点 */
  isSectionFocused: boolean;
  /** 目标正处于激活编辑态（如输入框弹键盘中），此期间挂起按键接管 */
  isEditingTarget?: boolean;
  /** 确认键激活当前光标目标 */
  onActivate: (index: number) => void;
  /** 返回键按下且正在编辑目标时调用（通常是收起键盘/blur 输入框） */
  onDismissTarget?: () => void;
  /** 编辑模式开关变化时通知父级（设置页据此挂起全局导航） */
  onEditModeChange?: (editing: boolean) => void;
}

export const useSectionEditMode = ({
  deviceType,
  itemCount,
  isSectionFocused,
  isEditingTarget = false,
  onActivate,
  onDismissTarget,
  onEditModeChange,
}: UseSectionEditModeOptions) => {
  const [editMode, setEditMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  // useTVEventHandler 的闭包通过 ref 读最新状态
  const activeRef = useRef(false);
  activeRef.current = deviceType === "tv" && editMode && isSectionFocused && !isEditingTarget;
  const editingTargetRef = useRef(false);
  editingTargetRef.current = isEditingTarget;
  const editModeRef = useRef(false);
  editModeRef.current = editMode;

  const setCursorBoth = (i: number) => {
    cursorRef.current = i;
    setCursor(i);
  };

  const enterEditMode = useCallback(() => {
    if (deviceType !== "tv") return;
    setCursorBoth(0);
    setEditMode(true);
    onEditModeChange?.(true);
  }, [deviceType, onEditModeChange]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    onEditModeChange?.(false);
  }, [onEditModeChange]);

  // 返回键：先收目标编辑态（键盘），再退出编辑模式；都不在则不拦截（正常退出页面）
  useEffect(() => {
    if (deviceType !== "tv" || !editMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editingTargetRef.current) {
        onDismissTarget?.();
        return true;
      }
      if (editModeRef.current) {
        exitEditMode();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [deviceType, editMode, exitEditMode, onDismissTarget]);

  const handleTVEvent = useCallback(
    (event: any) => {
      if (!activeRef.current) return;
      const type = event?.eventType;
      const action = event?.eventKeyAction;
      if (type === "up" || type === "down") {
        const delta = type === "up" ? -1 : 1;
        let next = cursorRef.current + delta;
        if (next < 0) next = 0;
        if (next > itemCount - 1) next = itemCount - 1;
        if (next !== cursorRef.current) setCursorBoth(next);
      } else if (type === "select") {
        if (action === 0) return; // 按下不处理，等抬起，避免长按连发
        onActivate(cursorRef.current);
      }
    },
    [itemCount, onActivate]
  );

  useTVEventHandler(deviceType === "tv" ? handleTVEvent : () => {});

  return { editMode, cursor, enterEditMode, exitEditMode };
};
