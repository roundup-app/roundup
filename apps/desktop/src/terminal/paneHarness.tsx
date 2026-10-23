import { render } from "@solidjs/testing-library";
import { expect, vi } from "vitest";
import type { Accessor } from "solid-js";
import type { DaemonExit } from "../app/seam";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import { Rail } from "../rail/Rail";
import { Pane } from "./Pane";
import type { Emulator, EmulatorFactory, Size } from "./emulator";
import type { Printed } from "./links";

type FakeEmulator = Emulator & {
  written: Uint8Array[];
  host: HTMLElement | null;
  /** What `show` and `fit` answer. */
  size: Size;
  fits: number;
  fontSize: number;
  disposed: boolean;
  type(bytes: Uint8Array): void;
  selectedText: string;
  select(text: string): void;
  /** Simulates a Cmd+click on a link or path the Terminal printed. */
  clickLink(printed: Printed): void;
  pasted: string[];
  scrollsToBottom: number;
  /** Simulates the user scrolling the view, as a wheel or drag would. */
  scroll(atBottom: boolean): void;
};

export const fakeEmulators = () => {
  const made = new Map<string, FakeEmulator>();

  const factory: EmulatorFactory = (id) => {
    let inputListener: (bytes: Uint8Array) => void = () => {};

    let linkListener: (printed: Printed) => void = () => {};

    let scrollListener: () => void = () => {};

    let bottom = true;

    let screenEl: HTMLElement | null = null;

    const emulator: FakeEmulator = {
      written: [],
      host: null,
      size: { cols: 100, rows: 30 },
      fits: 0,
      fontSize: 13,
      setFontSize: (size: number) => { emulator.fontSize = size; },
      disposed: false,
      selectedText: "",
      select: (text) => { emulator.selectedText = text; },
      clickLink: (printed) => linkListener(printed),
      pasted: [],
      scrollsToBottom: 0,
      write: (bytes, parsed) => {
        if (bytes.length > 0) emulator.written.push(bytes);
        parsed?.();
      },
      setSize: (size) => { emulator.size = size; },
      reset: () => { emulator.written = []; },
      onInput: (next) => {
        inputListener = next;
      },
      onLink: (next) => {
        linkListener = next;
      },
      selection: () => emulator.selectedText,
      turns: () => [],
      selectTurn: () => {},
      paste: (text) => {
        emulator.pasted.push(text);
        inputListener(new TextEncoder().encode(text));
      },
      onScroll: (next) => {
        scrollListener = next;
      },
      show: (host, focus = true) => {
        emulator.host = host;

        screenEl = document.createElement("div");

        screenEl.textContent = id;
        screenEl.tabIndex = 0;
        screenEl.dataset.terminal = id;
        host.replaceChildren(screenEl);

        if (focus) screenEl.focus();

        return emulator.size;
      },
      fit: () => {
        emulator.fits += 1;

        return emulator.size;
      },
      focus: () => screenEl?.focus(),
      isAtBottom: () => bottom,
      scrollToBottom: () => {
        emulator.scrollsToBottom += 1;
        bottom = true;
      },
      dispose: () => {
        emulator.disposed = true;
      },
      type: (bytes) => inputListener(bytes),
      scroll: (atBottom) => {
        bottom = atBottom;
        scrollListener();
      },
    };

    made.set(id, emulator);

    return emulator;
  };

  return { factory, made };
};

/** Resolves once the Terminal's output subscription is installed, so what it prints next reaches the pane. */
export const subscribed = (app: FakeApp, id: string): Promise<void> =>
  vi.waitFor(() => expect(app.outputSubscriptions.some((subscription) => subscription.id === id && !subscription.released)).toBe(true));

type Mounted = {
  app: FakeApp;
  connected: ConnectedProject;
  emulators: ReturnType<typeof fakeEmulators>["made"];
  container: HTMLElement;
};

/** A ConnectedProject whose Rail holds `tree` and whose Daemon lists `terminals`, with no Pane rendered. */
export const connectFakeProject = async (
  tree: RailNode[],
  terminals: TerminalInfo[] = [],
  now = 0,
  daemonExit: Accessor<DaemonExit | null> = () => null,
): Promise<{ app: FakeApp; connected: ConnectedProject }> => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => terminals;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => now, daemonExit);

  return { app, connected };
};

/** A Pane inside an open Project whose Rail holds `tree` and whose Daemon lists `terminals`. */
export const mountPane = async (
  tree: RailNode[],
  terminals: TerminalInfo[] = [],
  now = 0,
  daemonExit: Accessor<DaemonExit | null> = () => null,
): Promise<Mounted> => {
  const { app, connected } = await connectFakeProject(tree, terminals, now, daemonExit);
  const { factory, made } = fakeEmulators();

  const { container } = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={factory} />
    </ConnectedProjectContext.Provider>
  ));

  return { app, connected, emulators: made, container };
};

/** A Rail above a Pane in one open Project, so a spawn's new row can be watched handing focus to its Terminal (U33). */
export const mountRailAndPane = async (tree: RailNode[]): Promise<Mounted> => {
  const { app, connected } = await connectFakeProject(tree);
  const { factory, made } = fakeEmulators();

  const { container } = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Rail />
      <Pane createEmulator={factory} />
    </ConnectedProjectContext.Provider>
  ));

  return { app, connected, emulators: made, container };
};

export const callsTo = (app: FakeApp, method: "terminal.write" | "terminal.resize") =>
  app.calls.filter((call) => call.method === method).map((call) => call.params);
