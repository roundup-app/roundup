import { createNow, DisplayClockContext } from "../state/clock";
import { render, waitFor } from "@solidjs/testing-library";
import { vi } from "vitest";
import { createSignal, onCleanup, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event, info, workstream } from "../testing/nodes";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Pane } from "../terminal/Pane";
import { fakeEmulators } from "../terminal/paneHarness";
import type { Screens } from "../terminal/screens";
import { ResourceStrip } from "../resources/ResourceStrip";
import { Bubbles } from "./Bubbles";

export const TREE: RailNode[] = [workstream("w"), agent("a", "working", "busy", { parent: "w" }), agent("b", "working", "busy", { parent: "w", order: 1 }), workstream("other", { order: 1 })];

export const TERMINALS: TerminalInfo[] = [
  info("1", { owner: "a", title: "cargo test" }),
  info("2", { owner: "w", title: "zsh" }),
  info("3", { owner: "b", title: "other run" }),
];

/** The Pane and its bubbles in one open Project whose Daemon lists `terminals`, with a fake `terminal.open` and `terminal.close`. */
export const mountBubbles = async (selected: string | null = "a", terminals: TerminalInfo[] = TERMINALS, tree: RailNode[] = TREE, hostPresent = true) => {
  const app = createFakeApp();
  const [hasHost, setHostPresent] = createSignal(hostPresent);
  let listed = [...terminals];

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => listed;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.open"] = ({ workstream: owner }) => {
    listed = [...listed, info("9", { owner: owner ?? "/p", title: "login" })];
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return { terminal_id: "9" };
  };

  app.handlers["terminal.close"] = ({ id }) => {
    listed = listed.filter((terminal) => terminal.id !== id);
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return null;
  };

  const [recovery, recover] = createSignal<{ project: string; revision: string }>();
  const [exit, setExit] = createSignal<{ code: number | null } | null>(null);
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0, exit);
  connected.showView("terminal-tabs");
  const emulators = fakeEmulators();

  if (selected !== null) connected.rail.select(selected);

  /** A selected Agent's Pane takes focus on show, which would minimise the Bubbles under test (U2224); these tests place focus themselves. */
  const unfocused = (id: string) => {
    const emulator = emulators.factory(id);

    return { ...emulator, show: (host: HTMLElement) => emulator.show(host, false) };
  };

  const rendered = render(() => {
    // jsdom has no layout. Give the Bubble layer its historical 800×600 test pane;
    // scenarios supplying their own measured bar keep their own layout adapter.
    if (!vi.isMockFunction(Element.prototype.getBoundingClientRect)) {
      const original = Element.prototype.getBoundingClientRect;

      const boxes = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return this.matches(".bubbles, .centre-stack") ? new DOMRect(0, 0, 800, 600) : original.call(this);
      });

      onCleanup(() => boxes.mockRestore());
    }

    const [screens, setScreens] = createSignal<Screens>();

    const now = createNow(() => Date.now());

    return (
      <DisplayClockContext.Provider value={now.subscribe}><ConnectedProjectContext.Provider value={connected}>
        <div class="rail-row" tabindex="0">row</div>
        <div class="centre-stack">
          <Pane createEmulator={unfocused} screensRef={setScreens} />
          <Show when={screens()}>{(shared) => <Bubbles screens={shared()} recovery={recovery()} />}</Show>
          <Show when={hasHost()}><ResourceStrip /></Show>
        </div>
      </ConnectedProjectContext.Provider></DisplayClockContext.Provider>
    );
  });

  // Output emitted by a test before selectOutput attaches would be lost by the fake transport.
  await waitFor(() => {
    const bubbles = [...document.querySelectorAll<HTMLElement>(".bubble")];

    if ((hasHost() && !document.querySelector(".terminal-tabs")) || bubbles.some(bubble => listed.some(terminal => terminal.id === bubble.dataset.bubble && terminal.running)
      && !app.outputSubscriptions.some(subscription => subscription.id === bubble.dataset.bubble))) throw new Error("Terminal output subscriptions not attached");
  });

  return { app, connected, emulators, setExit, recover, setHostPresent, container: rendered.container, setListed: (next: TerminalInfo[]) => (listed = next) };
};

export const bubbleChord = (key: string, init: KeyboardEventInit = {}, target: Element | Window = window): KeyboardEvent => {
  const code = key === "." ? "Period" : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const press = new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(press);

  return press;
};

/** In Terminal order: each bubble is its own layer in the body, so the DOM order is the order they were first shown in. */
export const bubbleNames = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".bubble")]
    .sort((a, b) => Number(a.dataset.bubble) - Number(b.dataset.bubble))
    .map((bubble) => bubble.querySelector(".bubble-name")?.textContent ?? "");

export const bubbleCalls = (app: ReturnType<typeof createFakeApp>, method: string) => app.calls.filter((call) => call.method === method).map((call) => call.params);
