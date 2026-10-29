import { createEffect, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { xtermOptions, attachRenderer, dropInlineGround } from "../terminal/emulator";
import { followAppAppearance } from "./preferences";
import { terminalThemeFor } from "../terminal/theme";
import type { terminalType } from "./preferences";
import { copy } from "../copy";

/** A local, read-only xterm sample; it owns no Daemon identity or input subscription. */
export const TerminalPreview = (props: { type: ReturnType<typeof terminalType> }) => {
  let host!: HTMLDivElement;
  const terminal = new Terminal({ ...xtermOptions, ...props.type, disableStdin: true, cursorBlink: false, scrollback: 0 });
  const disposers: (() => void)[] = [];
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  onMount(() => {
    terminal.open(host);
    attachRenderer(terminal, () => new WebglAddon(), console.warn);
    dropInlineGround(host, disposers);
    fit.fit();
    terminal.write("roundup  \x1b[1mTerminal preview\x1b[0m\r\n┌────────┬────────┐\r\n│ ░▒▓█   │ ready  │\r\n└────────┴────────┘\r\n\x1b[32m✓\x1b[0m tests passed\r\n");
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    const stop = followAppAppearance(() => { terminal.options.theme = terminalThemeFor(); });
    onCleanup(() => { observer.disconnect(); stop(); });
  });
  createEffect(() => { Object.assign(terminal.options, props.type);

 if (host) fit.fit(); });
  onCleanup(() => { disposers.forEach(dispose => dispose()); terminal.dispose(); });

  return <section class="settings-preview" aria-label={copy.terminalPreview}>
    <h3 class="settings-group-name">{copy.terminalPreview}</h3>
    <div class="settings-preview-terminal" data-terminal ref={host} />
  </section>;
};
