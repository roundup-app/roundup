import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

export type RendererAddon = ITerminalAddon & Pick<WebglAddon, "onContextLoss">;

/** Which renderer draws one Terminal. `arabic` is the DOM renderer for good: WebGL clips long shaped Arabic runs. */
export type Renderer = { kind: "dom" } | { kind: "webgl"; addon: RendererAddon } | { kind: "arabic" };

/** Loads the WebGL renderer, or leaves the DOM renderer and says so once through `warn`. Returns whether WebGL is in use. */
export const attachRenderer = (
  terminal: Pick<Terminal, "loadAddon">,
  createWebgl: () => RendererAddon,
  warn: (message: string) => void,
  lost?: () => void,
): boolean => {
  try {
    const webgl = createWebgl();

    terminal.loadAddon(webgl);
    // Past the webview's context limit the oldest context is lost; its Terminal falls back to the DOM renderer.
    webgl.onContextLoss(() => { webgl.dispose(); lost?.(); });

    return true;
  } catch (failure) {
    if (!(failure instanceof Error)) throw failure;

    warn(`WebGL renderer unavailable, using the DOM renderer: ${failure.message}`);

    return false;
  }
};

/** `attachRenderer`, answering with the Renderer in use. */
export const loadWebgl = (
  terminal: Pick<Terminal, "loadAddon">,
  createWebgl: () => RendererAddon,
  warn: (message: string) => void,
  lost?: () => void,
): Renderer => {
  let addon: RendererAddon | undefined;

  return attachRenderer(terminal, () => (addon = createWebgl()), warn, lost) && addon ? { kind: "webgl", addon } : { kind: "dom" };
};

const ARABIC = "؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿";

const ARABIC_RUN = new RegExp(`[${ARABIC}]+(?:[ \\-.,!?:;'"()0-9]+[${ARABIC}]+)*[.,!?:]?`, "g");

/** Each Arabic string needing shaping, spaces between words included. */
export const arabicRuns = (text: string): [number, number][] =>
  // WebGL gives joined cells a fake codepoint but rasterizes one-character strings as ordinary glyphs.
  // Leaving single characters unjoined avoids a missing glyph and the joined-cell redraw cache leak.
  [...text.matchAll(ARABIC_RUN)].flatMap<[number, number]>(match => match[0].length > 1 ? [[match.index, match.index + match[0].length]] : []);
