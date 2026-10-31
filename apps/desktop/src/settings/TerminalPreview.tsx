import { createEffect, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { xtermOptions, attachRenderer, dropInlineGround } from "../terminal/emulator";
import { followAppAppearance } from "./preferences";
import { terminalThemeFor } from "../terminal/theme";
import type { terminalType } from "./preferences";
import { copy } from "./copy";

const reset = "\x1b[0m";

const previewSample = [`${copy.previewApp}  \x1b[1m${copy.terminalPreview}${reset}`, copy.previewTop, copy.previewRow, copy.previewBottom, `\x1b[32m✓${reset} ${copy.previewResult}`].join("\r\n");

/** A local, read-only xterm sample; it owns no Daemon identity or input subscription. */
export const TerminalPreview = (props: { type: ReturnType<typeof terminalType> }) => {
  let host!: HTMLDivElement;
  const terminal = new Terminal({ ...xtermOptions, ...props.type, disableStdin: true, cursorBlink: false, scrollback: 0 });
  const disposers: (() => void)[] = [];
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  const repaint = () => {
    fit.fit();
    // Keep the complete sample visible at every font metric; xterm owns the five-row height.
    terminal.resize(terminal.cols, previewSample.split("\r\n").length);
    // With no scrollback, resizing can discard sample rows. Rebuild the complete sample after fitting.
    // Queue the reset with its text so an earlier asynchronous write cannot append after it.
    terminal.write(`\x1bc${previewSample}`);
  };

  let themeFrame: number | undefined;

  const repaintTheme = () => {
    if (themeFrame !== undefined) cancelAnimationFrame(themeFrame);
    // Appearance's root effect must update the resolved CSS scheme before xterm reads its Tokens.
    themeFrame = requestAnimationFrame(() => {
      themeFrame = undefined;
      terminal.options.theme = terminalThemeFor();
      terminal.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
    });
  };

  onMount(() => {
    terminal.open(host);
    attachRenderer(terminal, () => new WebglAddon(), console.warn);
    dropInlineGround(host, disposers);

    if (terminal.textarea) {
      terminal.textarea.tabIndex = -1;
      terminal.textarea.setAttribute("aria-hidden", "true");
    }

    repaint();
    repaintTheme();
    const observer = new ResizeObserver(repaint);
    observer.observe(host);
    const stop = followAppAppearance(repaintTheme);
    onCleanup(() => { observer.disconnect(); stop(); });
  });
  createEffect(() => {
    Object.assign(terminal.options, props.type);

    if (host) repaint();
  });
  onCleanup(() => { if (themeFrame !== undefined) cancelAnimationFrame(themeFrame); disposers.forEach(dispose => dispose()); terminal.dispose(); });

  return <section class="settings-preview" aria-label={copy.terminalPreview}>
    <h3 class="settings-group-name">{copy.terminalPreview}</h3>
    <div class="settings-preview-terminal" data-terminal ref={host} />
  </section>;
};
