import tokens from "../tokens.css?inline";
import { DEFAULT_FONT_SIZE } from "./fontSize";
import type { Terminal } from "@xterm/xterm";

const token = (name: string): string => {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();

  if (value === undefined) throw new Error(`tokens.css has no --${name}`);

  return value;
};

/** `tokens.css` parsed once: xterm needs resolved values rather than CSS var references. */
export const terminalTokens = {
  family: token("font-terminal"),
  mono: token("font-mono"),
  weight: Number.parseInt(token("weight-terminal"), 10),
  lineHeight: Number.parseFloat(token("line-terminal")),
  letterSpacing: Number.parseFloat(token("letter-terminal")),
};

const loadStyles = (styles: string[], size: number, family: string): Promise<FontFace[][]> =>
  Promise.all(styles.map(style => document.fonts.load(`${style} ${size}px ${family}`)));

/** The default styles load even with a custom preference, so clearing it never fits a fallback face. */
export const loadDefaultFaces = (): Promise<void> =>
  loadStyles(["normal 400", "normal 700", "italic 400", "italic 700"], DEFAULT_FONT_SIZE, terminalTokens.family).then(() => undefined);

/** Loads the faces `terminal` now asks for, again while its size or family changes underneath the wait. */
export const loadEffectiveFont = async (terminal: Pick<Terminal, "options">, stopped: () => boolean): Promise<void> => {
  if (!document.fonts) return;

  let fontSize: number | undefined;
  let fontFamily: string | undefined;

  do {
    const { options } = terminal;

    fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
    fontFamily = options.fontFamily ?? terminalTokens.family;
    await loadStyles([`normal ${options.fontWeight}`, `normal ${options.fontWeightBold}`, `italic ${options.fontWeight}`, `italic ${options.fontWeightBold}`], fontSize, fontFamily);
    await document.fonts.ready;
  } while (!stopped() && (fontSize !== terminal.options.fontSize || fontFamily !== terminal.options.fontFamily));
};

/** xterm caches cell metrics at open. Changing its public font option remeasures the loaded face. */
export const remeasure = (terminal: Pick<Terminal, "options">, family = terminal.options.fontFamily ?? terminalTokens.family): void => {
  terminal.options.fontFamily = terminalTokens.mono;
  terminal.options.fontFamily = family;
};
