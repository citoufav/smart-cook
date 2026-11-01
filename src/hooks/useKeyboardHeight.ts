import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * 键盘挡住多少（0 = 收起）。
 *
 * 为什么不用 `KeyboardAvoidingView`：它在 **Modal 里不可靠**。Modal 是独立窗口，
 * Android 不会帮它 resize，而 KAV 在 Android 上依赖窗口被 resize 才能算出位移，
 * 于是表现为"输入框被键盘盖住"。自己拿高度、自己让位，行为是确定的，
 * 而且和 ChatSheet 早就这么做的那套一致。
 *
 * 用在 Modal / 底部弹层里。**普通页面不要用** —— 那些页面走系统的 adjustResize
 * （窗口本身变矮），再减一次键盘高度会往上多跳一格。
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS 用 *Will* 事件：和键盘动画同步升起来，不会先被挡一下再弹；
    // Android 的 Will 事件不可靠（不少机型不发），只能用 Did
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
