/**
 * 终端调色板 —— 固定深色，**不跟随应用主题**。
 *
 * 为什么不跟随：
 *
 * 1. 终端外壳（`styles/terminal.css`）本来就是写死的深色（`#171717` 底、
 *    白色半透明工具栏文字）。若 xterm 调色板改从 CSS 变量取色，浅色主题下
 *    会得到「浅底深字」，嵌在深色边框与工具栏里非常割裂。
 * 2. xterm 的 `theme` 只在构造 `new Terminal()` 时应用一次，运行时切换主题
 *    并不会更新。也就是说「跟随主题」从未真正生效，只会在浅色模式下新建
 *    终端时产生一次错误的浅色调色板。
 *
 * 因此这里直接固化深色值：无论当前主题如何，终端始终是一块深色区域，
 * 与外壳保持一致。数值取自深色主题的 CSS 变量，改主题时需同步核对。
 */
export const TERMINAL_THEME = {
  background: "#171717",
  foreground: "#dedede",
  cursor: "#7aded3",
  selectionBackground: "#37373d",
  red: "#f5927e",
  green: "#7fd99a",
  yellow: "#e0c04a",
  blue: "#7eb6ff",
  magenta: "#c792ea",
  cyan: "#5ec4bc",
} as const;

/** xterm 会写入该对象，因此每次传入独立副本。 */
export function createTerminalTheme(): Record<string, string> {
  return { ...TERMINAL_THEME };
}
