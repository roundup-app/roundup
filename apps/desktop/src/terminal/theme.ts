import type { ITheme } from "@xterm/xterm";
import tokens from "../tokens.css?inline";

/** An emulator theme that always names the two colours the Daemon reports to a program (X17). */
export type TerminalTheme = ITheme & { background: string; foreground: string };

// Resolve the same Terminal Tokens CSS uses, including for X17 before a pane is attached.
const theme = (dark: boolean): TerminalTheme => {
  const column = dark ? tokens.split(/:root\[data-mode=["']?dark["']?\]/)[1]! : tokens;

  const value = (name: string): string => {
    const colour = new RegExp(`--terminal-${name}:\\s*([^;]+);`).exec(column)![1]!.trim();

    // Vite shortens hex in production CSS; terminal.scheme requires #rrggbb.
    return colour.replace(/^#([a-f\d])([a-f\d])([a-f\d])$/i, "#$1$1$2$2$3$3");
  };

  return {
    background: value("background"), foreground: value("foreground"),
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

export const lightTerminalTheme = theme(false);

export const darkTerminalTheme = theme(true);

/** The theme for the window's colour scheme. */
export const terminalThemeFor = (dark: boolean): TerminalTheme => (dark ? darkTerminalTheme : lightTerminalTheme);
