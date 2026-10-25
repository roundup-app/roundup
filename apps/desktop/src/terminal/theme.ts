import type { ITheme } from "@xterm/xterm";
import "../tokens.css";

/** An emulator theme that always names the two colours the Daemon reports to a program (X17). */
export type TerminalTheme = ITheme & { background: string; foreground: string };

/** Read the window's resolved Tokens, including before a Terminal attaches for X17. */
export const terminalThemeFor = (): TerminalTheme => {
  const styles = getComputedStyle(document.documentElement);

  const value = (name: string): string => {
    const colour = styles.getPropertyValue(`--terminal-${name}`).trim();

    // Production CSS can shorten hex; terminal.scheme requires #rrggbb.
    return colour.replace(/^#([a-f\d])([a-f\d])([a-f\d])$/i, "#$1$1$2$2$3$3");
  };

  return {
    background: value("background"), foreground: value("foreground"),
    scrollbarSliderBackground: styles.getPropertyValue("--scrollbar-thumb").trim(),
    scrollbarSliderHoverBackground: styles.getPropertyValue("--scrollbar-thumb").trim(),
    scrollbarSliderActiveBackground: styles.getPropertyValue("--scrollbar-thumb").trim(),
    cursor: value("cursor"), cursorAccent: value("cursor-text"),
    selectionBackground: value("selection"), selectionForeground: value("selection-text"),
    selectionInactiveBackground: value("selection"),
    black: value("black"), red: value("red"), green: value("green"), yellow: value("yellow"),
    blue: value("blue"), magenta: value("magenta"), cyan: value("cyan"), white: value("white"),
    brightBlack: value("bright-black"), brightRed: value("bright-red"), brightGreen: value("bright-green"),
    brightYellow: value("bright-yellow"), brightBlue: value("bright-blue"), brightMagenta: value("bright-magenta"),
    brightCyan: value("bright-cyan"), brightWhite: value("bright-white"),
  };
};
