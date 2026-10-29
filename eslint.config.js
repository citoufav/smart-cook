// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // RN 惯用法说明：`useRef(new Animated.Value()).current` 与"渲染期读写 ref 保存最新值"
      // 是本代码库（及 RN 生态）大量存在的既有模式，react-hooks v6 的编译器前置规则
      // 会对其产生大量误报，暂关闭，待后续按 React Compiler 规范逐步迁移。
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
