import tokens from "../tokens.css?inline";
import { createRoot, createEffect, on } from "solid-js";
import { appSettings, appDark, followAppAppearance } from "../settings/preferences";
import { DEFAULT_FONT_SIZE } from "./fontSize";
import { createLinkProvider } from "./linkProvider";
import type { Printed } from "./links";
import { terminalThemeFor } from "./theme";
import { attachTurns } from "./turns";
import type { TurnRows } from "./turns";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
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
  /** Whether the view sits at the newest line; false once the user has scrolled up. */
  isAtBottom(): boolean;
  /** Fires whenever the view's scroll position changes. */
  onScroll(listener: () => void): void;
  scrollToBottom(): void;
  dispose(): void;
};

export type RendererAddon = ITerminalAddon & Pick<WebglAddon, "onContextLoss">;

export type EmulatorFactory = (id: string) => Emulator;

/** Loads the WebGL renderer, or leaves the DOM renderer and says so once through `warn`. Returns whether WebGL is in use. */
export const attachRenderer = (
  terminal: Pick<Terminal, "loadAddon">,
  createWebgl: () => RendererAddon,
  warn: (message: string) => void,
): boolean => {
  try {
    const webgl = createWebgl();

    terminal.loadAddon(webgl);
    // Past the webview's context limit the oldest context is lost; its Terminal falls back to the DOM renderer.
    webgl.onContextLoss(() => webgl.dispose());

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
    return terminalThemeFor(appDark());
  },
};

/** What the keystroke run (`scenarios/perf.md` K1 to K3) watches: each chunk the emulator has parsed, each render, and which renderer drew. A build without the run passes none. */
export type EchoProbe = {
  written(bytes: Uint8Array): void;
  rendered(): void;
  renderer(webgl: boolean): void;
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

  return () => {
    const terminal = new Terminal(xtermOptions);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    const fitter = new FitAddon();
    const element = document.createElement("div");
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
        open();
        prepareFontChange();
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
    terminal.onRender(() => probe?.rendered());

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

    let cmdHeld = false;
    let linkListener: (printed: Printed) => void = () => {};

    const trackCmd = (event: Pick<KeyboardEvent, "metaKey">) => {
      cmdHeld = event.metaKey;
    };

    const dropCmd = () => {
      cmdHeld = false;
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
    // A held Cmd shows on mouse movement too, so a Cmd pressed before the window took focus is not missed.
    element.addEventListener("mousemove", trackCmd);
    terminal.registerLinkProvider(createLinkProvider(terminal, () => cmdHeld, (printed) => linkListener(printed)));

    const shellTurns = attachTurns(terminal, (first, last) => terminal.selectLines(first, last));

    const followScheme = () => {
      terminal.options.theme = terminalThemeFor(appDark());
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

    const size = (): Size => {
      if (!fontsReady || disposed) return { cols: terminal.cols, rows: terminal.rows };

      const reflowCursorLine = terminal.options.reflowCursorLine ?? false;

      // Font resizing must retain unfinished output; ordinary shell resizing keeps xterm's policy.
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
      }

      if (fontViewport !== null) {
        // xterm syncs viewport pixels in its render frame; scrolling before it uses the old cell height.
        if (opened) fontFrame ??= requestAnimationFrame(restoreFontViewport);
        else restoreFontViewport();
      }

      return { cols: terminal.cols, rows: terminal.rows };
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
        }, console.warn);

        probe?.renderer(!webglDenied);
      }

      if (focusOnShow) terminal.focus();
    };

    return {
      ready,
      write: (bytes, parsed) => terminal.write(bytes, () => {
        probe?.written(bytes);
        parsed?.();
      }),
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
      onInput: (listener) => {
        terminal.onData((text) => listener(encoder.encode(text)));
        terminal.onBinary((text) => listener(Uint8Array.from(text, (char) => char.charCodeAt(0))));
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

        if (fontsReady) open();

        return size();
      },
      fit: size,
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
