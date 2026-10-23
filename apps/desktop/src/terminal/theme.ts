import type { ITheme } from "@xterm/xterm";

/** An emulator theme that always names the two colours the Daemon reports to a program (X17). */
export type TerminalTheme = ITheme & { background: string; foreground: string };

/** The emulator's colours per scheme, as the values of `tokens.css`'s `--ground` and `--text` in that scheme. Each ANSI colour is 4.5:1 or better on its scheme's `--ground` as text (U4). */
export const lightTerminalTheme: TerminalTheme = {
  background: "#ffffff",
  foreground: "#1d1d1f",
  cursor: "#1d1d1f",
  cursorAccent: "#ffffff",
  black: "#1d1d1f",
  red: "#c4262e",
  green: "#1a7f37",
  yellow: "#975900",
  blue: "#0a60d8",
  magenta: "#a626a4",
  cyan: "#0b7285",
  white: "#68686d",
  brightBlack: "#515154",
  brightRed: "#d1242f",
  brightGreen: "#167a33",
  brightYellow: "#8f5400",
  brightBlue: "#0a55c0",
  brightMagenta: "#9b2199",
  brightCyan: "#0a6a7c",
  brightWhite: "#3a3a3c",
};

export const darkTerminalTheme: TerminalTheme = {
  background: "#1c1c1e",
  foreground: "#f5f5f7",
  cursor: "#f5f5f7",
  cursorAccent: "#1c1c1e",
  black: "#8e8e93",
  red: "#ff6b6b",
  green: "#5fd37a",
  yellow: "#f0a030",
  blue: "#4d9bff",
  magenta: "#d98cff",
  cyan: "#4ccfe0",
  white: "#d1d1d6",
  brightBlack: "#a1a1a6",
  brightRed: "#ff8a8a",
  brightGreen: "#7ee596",
  brightYellow: "#ffbe55",
  brightBlue: "#79b4ff",
  brightMagenta: "#e5a8ff",
  brightCyan: "#7adfec",
  brightWhite: "#ffffff",
};

export const DARK_SCHEME = "(prefers-color-scheme: dark)";

/** The theme for the window's colour scheme. */
export const terminalThemeFor = (dark: boolean): TerminalTheme => {
  // xterm accepts concrete colours, so resolve the same platform Token that browser selections paint.
  const probe = document.createElement("span");
  probe.style.backgroundColor = "var(--text-selection)";
  probe.style.color = "var(--text-selection-ink)";
  document.documentElement.append(probe);
  const resolved = getComputedStyle(probe);
  const selection = resolved.backgroundColor;
  const ink = resolved.color;
  probe.remove();

  const theme = dark ? darkTerminalTheme : lightTerminalTheme;

  return { ...theme, selectionBackground: selection, selectionInactiveBackground: selection, selectionForeground: ink };
};
