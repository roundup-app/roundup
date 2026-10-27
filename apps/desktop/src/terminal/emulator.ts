import { showScrollbars } from "../scrollHover";
import tokens from "../tokens.css?inline";
import { createRoot, createEffect, on } from "solid-js";
import { appSettings, followAppAppearance } from "../settings/preferences";
import { DEFAULT_FONT_SIZE } from "./fontSize";
import { createLinkProvider } from "./linkProvider";
import type { Printed } from "./links";
import { terminalThemeFor } from "./theme";
import { attachTurns } from "./turns";
import type { TurnRows } from "./turns";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ImageAddon } from "@xterm/addon-image";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { IMarker, ITerminalAddon, ITerminalOptions } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

export type Size = { cols: number; rows: number };

/** One Terminal's screen. It exists before it is shown: bytes written to it wait for the first `show`. */
export type Emulator = {
  /** When present, wait before sending a fitted size to the Daemon. Output can be parsed while faces load. */
  readonly ready?: Promise<void> | undefined;
  write(bytes: Uint8Array, parsed?: () => void): void;
  /** Restores the Daemon's screen at its recorded size before later output is written. */
  setSize(size: Size): void;
  setFontSize(size: number): void;
  /** Clears the last complete screen before a replacement snapshot is written. */
  reset(): void;
  /** Keystrokes and pastes, as the bytes the program expects, in the order they were typed. */
  onInput(listener: (bytes: Uint8Array) => void): void;
  /** Live output event arrival, before buffering or snapshot recovery; snapshots never call it. */
  outputArrived?: ((bytes: Uint8Array) => void) | undefined;
  /** K1's optional probe: Screens calls this when the queue releases an input batch for encoding. */
  inputEncoding?: ((bytes: readonly number[]) => void) | undefined;
  /** K1's optional probe: Screens calls this after encoding its input batch, before dispatch. */
  inputEncoded?: ((bytes: readonly number[]) => void) | undefined;
  /** U365: a Cmd+click on a web link or path printed in the Terminal; one call per click. */
  onLink(listener: (printed: Printed) => void): void;
  selection(): string;
  /** U514: the Turns the shell's marks drew, oldest first; none for a Terminal that prints no mark. */
  turns(): TurnRows[];
  /** U514: selects Turn `index`'s rows; with `extend`, from the Turn last selected through it. */
  selectTurn(index: number, extend: boolean): void;
  paste(text: string): void;
  /** Moves the emulator into `host` and focuses it unless restoring the Rail. Until `ready` resolves, returns the snapshot grid; afterward returns the fitted size. */
  show(host: HTMLElement, focus?: boolean): Size;
  /** Gives the keyboard back to the emulator. */
  focus(): void;
  /** The size that fills the current host, or the snapshot grid while `ready` is pending. */
  fit(): Size;
  /** Reports a fit caused by loaded faces or xterm's scale/cell-metric redraw, without sending input. */
  onResize?: ((listener: (size: Size) => void) => void) | undefined;
  /** Whether the view sits at the newest line; false once the user has scrolled up. */
  isAtBottom(): boolean;
  /** Fires whenever the view's scroll position changes. */
  onScroll(listener: () => void): void;
  scrollToBottom(): void;
  dispose(): void;
};

export type RendererAddon = ITerminalAddon & Pick<WebglAddon, "onContextLoss">;

/** OSC 52 copies use the originating Terminal's clipboard failure owner. */
export type EmulatorFactory = (id: string, copy?: (text: string) => Promise<void>) => Emulator;

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

const encoder = new TextEncoder();

/** U399: the bytes `⌥⏎` sends, which Claude Code reads as a new line. */
const NEWLINE = "\x1b\r";

/** U399: a bare `⇧⏎` outside IME composition; every other chord keeps xterm's own encoding. */
const isShiftEnter = (event: KeyboardEvent): boolean =>
  event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing;

/** U2242: the bytes Ghostty's macOS defaults send for a bare `⌘` or `⌥` with ⌫, ← or →; other chords keep xterm's encoding. */
const MAC_EDITING_KEYS = new Map(
  Object.entries({
    Backspace: { cmd: "\x15", alt: "\x1b\x7f" },
    ArrowLeft: { cmd: "\x01", alt: "\x1bb" },
    ArrowRight: { cmd: "\x05", alt: "\x1bf" },
  }),
);

const macEditingBytes = (event: KeyboardEvent): string | null => {
  if (event.isComposing || event.ctrlKey || event.shiftKey || event.metaKey === event.altKey) return null;

  const bytes = MAC_EDITING_KEYS.get(event.key);

  return bytes ? (event.metaKey ? bytes.cmd : bytes.alt) : null;
};

/** Rule 7's 150 MB budget for ten idle Agents must hold under a Terminal that prints without end. */
export const SCROLLBACK_LINES = 10_000;

export const xtermOptions: ITerminalOptions = {
  allowProposedApi: true,
  // Portal refs can still belong to an inert template; mouse listeners need the live window's document.
  get documentOverride() {
    return document;
  },
  // xterm needs resolved values rather than CSS var references.
  fontFamily: /--font-terminal:\s*([^;]+);/.exec(tokens)![1]!.trim(),
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: Number.parseFloat(/--line-terminal:\s*([^;]+);/.exec(tokens)![1]!),
  letterSpacing: Number.parseFloat(/--letter-terminal:\s*([^;]+);/.exec(tokens)![1]!),
  scrollback: SCROLLBACK_LINES,
  // Read per Terminal: a module-level read is stale for every Terminal opened after the window's scheme changes.
  get theme() {
    return terminalThemeFor();
  },
};

/** What the keystroke run (`scenarios/perf.md` K1 to K3) watches: each chunk the emulator has parsed, each render, and which renderer drew. A build without the run passes none. */
export type EchoProbe = {
  /** xterm's `onData` fired: the key became bytes to send. */
  input(id: string): void;
  frame?(text: string, id: string): string;
  encoding(id: string, bytes: readonly number[]): void;
  encoded(id: string, bytes: readonly number[]): void;
  /** Live output reached the subscription, before buffering or parsing. */
  arrived(bytes: Uint8Array, id: string): void;
  written(bytes: Uint8Array, id: string): void;
  rendered(id: string): void;
  renderer(webgl: boolean, id: string): void;
};

/** xterm paints the scroll element's background inline from the theme; the stylesheet paints it from `--terminal-background`, so the inline copy is dropped (D1) each time xterm writes it. */
const dropInlineGround = (element: HTMLElement, disposers: (() => void)[]): void => {
  const scroller = element.querySelector<HTMLElement>(".xterm-scrollable-element");

  if (!scroller) return;

  const drop = () => scroller.style.removeProperty("background-color");
  const observer = new MutationObserver(drop);

  drop();
  observer.observe(scroller, { attributes: true, attributeFilter: ["style"] });
  disposers.push(() => observer.disconnect());
};

/** The real emulators (xterm.js). WebGL is tried until the webview first refuses it, then every later Terminal goes straight to the DOM renderer. */
export const createXtermEmulators = (
  probe?: EchoProbe,
  createWebgl: () => RendererAddon = () => new WebglAddon(),
): EmulatorFactory => {
  let webglDenied = false;

  return (id, copy) => {
    const terminal = new Terminal(xtermOptions);
    terminal.loadAddon(new ClipboardAddon(undefined, {
      readText: () => "",
      writeText: (selection, text) => selection === "c" ? copy?.(text) : undefined,
    }));
    // Bound each Terminal's decoded cache and decoder workspace, including idle Agents.
    terminal.loadAddon(new ImageAddon({
      storageLimit: 1,
      pixelLimit: 262_144,
      sixelSizeLimit: 1_048_576,
      iipSizeLimit: 1_048_576,
      enableSizeReports: false,
    }));
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    const fitter = new FitAddon();
    const element = document.createElement("div");
    let resized: (size: Size) => void = () => {};

    let opened = false;
    let disposed = false;
    let focusOnShow = true;
    let fontsReady = !document.fonts;
    const family = xtermOptions.fontFamily!;

    // Load every bundled style even with a custom preference, so clearing it never fits a fallback face.
    const ready = document.fonts ? Promise.all(
      ["normal 400", "normal 700", "italic 400", "italic 700"].map(style => document.fonts.load(`${style} ${DEFAULT_FONT_SIZE}px ${family}`)),
    ).catch((failure: Error) => {
      // A damaged/missing local asset still leaves the existing fallback stack usable.
      console.warn("Terminal font unavailable; using the fallback face", failure);
    }).then(() => {
      fontsReady = true;

      if (element.parentElement && !disposed) {
        prepareFontChange();
        const family = terminal.options.fontFamily!;

        // xterm caches cell metrics at open. Changing its public font option remeasures the loaded face.
        terminal.options.fontFamily = /--font-mono:\s*([^;]+);/.exec(tokens)![1]!.trim();
        terminal.options.fontFamily = family;
        size();
      }
    }) : undefined;

    let fontChanged = false;
    let fontViewport: IMarker | null = null;
    let fontFrame: number | null = null;
    let loadedWebgl: RendererAddon | null = null;
    const disposers: (() => void)[] = [];

    element.style.height = "100%";
    terminal.loadAddon(fitter);
    terminal.onRender(() => {
      element.toggleAttribute("data-scrollback", terminal.buffer.active.baseY > 0);
      probe?.rendered(id);

      refit();
    });
    terminal.onScroll(() => {
      element.toggleAttribute("data-scrollback", terminal.buffer.active.baseY > 0);

      if (opened && terminal.buffer.active.baseY > 0) showScrollbars(element);
    });

    // X17: the Daemon answers a program's colour query and DA1 from the App's scheme, shown or not; a second reply from here would reach the program twice.
    for (const handler of [
      terminal.parser.registerOscHandler(10, (data) => data === "?"),
      terminal.parser.registerOscHandler(11, (data) => data === "?"),
      terminal.parser.registerCsiHandler({ final: "c" }, () => true),
    ]) disposers.push(() => handler.dispose());

    // xterm also asks about the keypress that follows a keydown it did not handle, so both are refused.
    terminal.attachCustomKeyEventHandler((event) => {
      const bytes = isShiftEnter(event) ? NEWLINE : macEditingBytes(event);

      if (bytes === null) return true;

      if (event.type === "keydown") {
        event.preventDefault();
        terminal.input(bytes, true);
      }

      return false;
    });

    let cmdDown = false;
    let linkListener: (printed: Printed) => void = () => {};

    const trackCmd = (event: Pick<KeyboardEvent, "metaKey">) => {
      cmdDown = event.metaKey;
    };

    const dropCmd = () => {
      cmdDown = false;
    };

    // Capture reaches Bubble resize edges even when their handlers stop propagation.
    const clearOldSelection = (event: MouseEvent) => {
      if (event.button !== 0) return;

      window.getSelection()?.removeAllRanges();
      terminal.clearSelection();
    };

    window.addEventListener("pointerdown", clearOldSelection, true);
    window.addEventListener("keydown", trackCmd);
    window.addEventListener("keyup", trackCmd);
    window.addEventListener("blur", dropCmd);
    // A pressed Cmd shows on mouse movement too, so a Cmd pressed before the window took focus is not missed.
    element.addEventListener("mousemove", trackCmd);
    terminal.registerLinkProvider(createLinkProvider(terminal, () => cmdDown, (printed) => linkListener(printed)));

    const shellTurns = attachTurns(terminal, (first, last) => terminal.selectLines(first, last));

    const followScheme = () => {
      terminal.options.theme = terminalThemeFor();
    };

    const contrast = window.matchMedia?.("(prefers-contrast: more)");
    const forced = window.matchMedia?.("(forced-colors: active)");

    for (const query of [contrast, forced]) query?.addEventListener("change", followScheme);

    const stopScheme = followAppAppearance(followScheme);

    const restoreFontViewport = () => {
      fontFrame = null;

      if (fontViewport === null || fontChanged) return;

      if (!fontViewport.isDisposed) {
        // xterm's pixel offset can disagree with viewportY after a font change; reset that origin first.
        terminal.scrollLines(-terminal.buffer.active.length);
        terminal.scrollToLine(fontViewport.line);
      }

      fontViewport.dispose();
      fontViewport = null;
    };

    const rowWidth = (row: number, cols: number): number => {
      const buffer = terminal.buffer.active;
      const last = buffer.getLine(row)?.getCell(cols - 1);
      const next = buffer.getLine(row + 1);

      // xterm pads the last cell when a wide glyph wraps; that padding is not a selected character.
      return next?.isWrapped && next.getCell(0)?.getWidth() === 2 && last?.getCode() === 0 ? cols - 1 : cols;
    };

    const size = (): Size => {
      if (!fontsReady || disposed || element.closest("[hidden]")) return { cols: terminal.cols, rows: terminal.rows };

      const previous = { cols: terminal.cols, rows: terminal.rows };
      const proposed = fitter.proposeDimensions();
      const changing = proposed && (proposed.cols !== previous.cols || proposed.rows !== previous.rows);

      if (changing) prepareFontChange();

      // xterm clears selection on resize. Its markers follow reflow, so retain endpoints in their
      // logical lines rather than anchoring them to physical rows that a new column count replaces.
      const endpoint = (x: number, y: number) => {
        const buffer = terminal.buffer.active;
        let first = y;

        while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;

        const marker = terminal.registerMarker(first - buffer.baseY - buffer.cursorY);

        let offset = x;

        for (let row = first; row < y; row += 1) offset += rowWidth(row, previous.cols);

        return { marker, offset };
      };

      const selection = changing ? terminal.getSelectionPosition() : undefined;
      const start = selection ? endpoint(selection.start.x, selection.start.y) : null;
      const end = selection ? endpoint(selection.end.x, selection.end.y) : null;
      const reflowCursorLine = terminal.options.reflowCursorLine ?? false;

      // Fitting changed metrics must rewrap unfinished output instead of truncating the cursor line.
      if (fontChanged) terminal.options.reflowCursorLine = true;

      try {
        fitter.fit();

        // xterm's DOM renderer derives its cell size from the column and row counts, so a fit that changed
        // them can propose one cell more; fitting again here keeps one fit to one size.
        const settled = fitter.proposeDimensions();

        if (settled && (settled.cols !== terminal.cols || settled.rows !== terminal.rows)) fitter.fit();
      } finally {
        terminal.options.reflowCursorLine = reflowCursorLine;
        fontChanged = false;

        if (start?.marker && end?.marker && !start.marker.isDisposed && !end.marker.isDisposed) {
          const position = (line: number, offset: number) => {
            while (terminal.buffer.active.getLine(line + 1)?.isWrapped && offset >= rowWidth(line, terminal.cols)) {
              offset -= rowWidth(line, terminal.cols);
              line += 1;
            }

            return { line, col: offset };
          };

          const from = position(start.marker.line, start.offset);
          const to = position(end.marker.line, end.offset);

          terminal.select(from.col, from.line, (to.line - from.line) * terminal.cols + to.col - from.col);
        }

        start?.marker?.dispose();
        end?.marker?.dispose();
      }

      if (fontViewport !== null) {
        // xterm syncs viewport pixels in its render frame; scrolling before it uses the old cell height.
        if (opened) fontFrame ??= requestAnimationFrame(restoreFontViewport);
        else restoreFontViewport();
      }

      const fitted = { cols: terminal.cols, rows: terminal.rows };

      if (fitted.cols !== previous.cols || fitted.rows !== previous.rows) resized(fitted);

      return fitted;
    };

    // xterm redraws both renderers after DPR/cell metrics change; host observers miss equal CSS bounds.
    const refit = () => {
      if (!opened || disposed || !fontsReady || !element.parentElement || element.closest("[hidden]")) return;

      const proposed = fitter.proposeDimensions();

      if (proposed && (proposed.cols !== terminal.cols || proposed.rows !== terminal.rows)) size();
    };

    const prepareFontChange = () => {
      // Markers follow xterm's rewrap; a saved physical row would jump to different content.
      if (terminal.buffer.active.viewportY !== terminal.buffer.active.baseY) {
        const buffer = terminal.buffer.active;

        fontViewport ??= terminal.registerMarker(buffer.viewportY - buffer.baseY - buffer.cursorY) ?? null;
      }

      fontChanged = true;
    };

    const stopFont = createRoot(dispose => {
      createEffect(on(() => appSettings().fontFamily, family => {
        const next = family || /--font-terminal:\s*([^;]+);/.exec(tokens)![1]!.trim();

        if (terminal.options.fontFamily === next) return;

        prepareFontChange();
        terminal.options.fontFamily = next;

        if (opened) size();
      }));

      return dispose;
    });

    const open = () => {
      if (!opened) {
        terminal.open(element);
        opened = true;
        dropInlineGround(element, disposers);

        if (!webglDenied) webglDenied = !attachRenderer(terminal, () => {
          loadedWebgl = createWebgl();

          return loadedWebgl;
        }, console.warn, () => probe?.renderer(false, id));

        probe?.renderer(!webglDenied, id);
      }
    };

    return {
      ready,
      write: (bytes, parsed) => {
        terminal.write(bytes, () => {
          probe?.written(bytes, id);
          parsed?.();
        });
      },
      setSize: ({ cols, rows }) => {
        if (opened && loadedWebgl && (terminal.cols !== cols || terminal.rows !== rows)) {
          loadedWebgl.dispose();
          loadedWebgl = null;
        }

        terminal.resize(cols, rows);
      },
      setFontSize: (size) => {
        if (terminal.options.fontSize === size) return;

        prepareFontChange();

        terminal.options.fontSize = size;
      },
      reset: () => terminal.write("\x1bc"),
      outputArrived: probe ? (bytes) => probe.arrived(bytes, id) : undefined,
      inputEncoding: probe ? (bytes) => probe.encoding(id, bytes) : undefined,
      inputEncoded: probe ? (bytes) => probe.encoded(id, bytes) : undefined,
      onInput: (listener) => {
        terminal.onData((text) => {
          refit();
          probe?.input(id);
          listener(encoder.encode(probe?.frame?.(text, id) ?? text));
        });
        terminal.onBinary((text) => {
          refit();
          listener(Uint8Array.from(text, (char) => char.charCodeAt(0)));
        });
      },
      onLink: (listener) => {
        linkListener = listener;
      },
      selection: () => terminal.getSelection(),
      turns: shellTurns.turns,
      selectTurn: shellTurns.selectTurn,
      paste: (text) => terminal.paste(text),
      show: (host, focus = true) => {
        host.replaceChildren(element);

        focusOnShow = focus;

        open();

        const fitted = size();

        if (focusOnShow) terminal.focus();

        return fitted;
      },
      fit: size,
      onResize: (listener) => { resized = listener; },
      focus: () => terminal.focus(),
      isAtBottom: () => terminal.buffer.active.viewportY === terminal.buffer.active.baseY,
      onScroll: (listener) => terminal.onScroll(() => listener()),
      scrollToBottom: () => {
        fontViewport?.dispose();
        fontViewport = null;
        terminal.scrollToBottom();
      },
      dispose: () => {
        disposed = true;

        if (fontFrame !== null) cancelAnimationFrame(fontFrame);

        for (const query of [contrast, forced]) query?.removeEventListener("change", followScheme);

        stopScheme();
        stopFont();
        window.removeEventListener("pointerdown", clearOldSelection, true);
        window.removeEventListener("keydown", trackCmd);
        window.removeEventListener("keyup", trackCmd);
        window.removeEventListener("blur", dropCmd);
        disposers.forEach((dispose) => dispose());
        shellTurns.dispose();
        fontViewport?.dispose();
        terminal.dispose();
      },
    };
  };
};
