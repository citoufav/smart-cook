import { useCallback, useEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';
import { Dimensions } from 'react-native';
import { useKeyboardHeight } from './useKeyboardHeight';

/** 只要能量位置就行，TextInput 和 View 都满足 */
export type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

/**
 * 让被键盘盖住的输入框自己滚到键盘上方。
 *
 * 为什么不用现成的：Android 15 的 edge-to-edge 之后，窗口不再随键盘缩小，
 * RN 的 `KeyboardAvoidingView` 和 ScrollView 的自动避让都不再可靠。
 * 所以自己量：`measureInWindow` 拿到输入框在屏幕上的位置，和
 * 「屏幕高 − 键盘高」比一比，超了就按超出量滚。
 *
 * 用法：
 * ```tsx
 * const { scrollRef, onScroll, captureFocus } = useKeyboardAwareScroll();
 * <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16}>
 *   <TextInput ref={ref} onFocus={captureFocus(ref)} />
 * ```
 * 键盘高度变化时会自动再滚一次（第一次聚焦时键盘还没弹出来，高度是 0）。
 */
export function useKeyboardAwareScroll() {
  const keyboardHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const focusedRef = useRef<Measurable | null>(null);

  const scrollToFocused = useCallback((kb: number) => {
    const node = focusedRef.current;
    if (!node || kb <= 0) return;
    const visibleBottom = Dimensions.get('window').height - kb;
    node.measureInWindow((_x, y, _w, h) => {
      // 多留 12px，别让输入框正好贴着键盘边
      const overflow = y + h + 12 - visibleBottom;
      if (overflow > 0) {
        scrollRef.current?.scrollTo({
          y: Math.max(0, offsetRef.current + overflow),
          animated: true,
        });
      }
    });
  }, []);

  // 键盘弹起/收起时补一次：聚焦那一刻还不知道键盘多高
  useEffect(() => {
    scrollToFocused(keyboardHeight);
  }, [keyboardHeight, scrollToFocused]);

  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  /** 在焦点落到「键盘已经开着时点的另一个输入框」这种场景下也要滚 */
  const captureFocus = useCallback(
    (ref: React.RefObject<Measurable | null>) => () => {
      focusedRef.current = ref.current ?? null;
      if (keyboardHeight > 0) scrollToFocused(keyboardHeight);
    },
    [keyboardHeight, scrollToFocused],
  );

  /**
   * 同上，但直接给节点而不是 ref —— 子组件自己持有 ref、父组件不知道的类型时用这个，
   * 免得为了传个 ref 把 prop 类型搞成 any。
   */
  const captureNode = useCallback(
    (node: Measurable | null) => {
      focusedRef.current = node;
      if (keyboardHeight > 0) scrollToFocused(keyboardHeight);
    },
    [keyboardHeight, scrollToFocused],
  );

  return { scrollRef, onScroll, captureFocus, captureNode, keyboardHeight };
}
