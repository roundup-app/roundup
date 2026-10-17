import { render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
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
export const mountBubbles = async (selected: string | null = "a", terminals: TerminalInfo[] = TERMINALS, tree: RailNode[] = TREE) => {
  const app = createFakeApp();
  let listed = [...terminals];

  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => listed;
  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.open"] = ({ workstream: owner }) => {
    listed = [...listed, info("9", { owner, title: "login" })];
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return { terminal_id: "9" };
  };

  app.handlers["terminal.close"] = ({ id }) => {
    listed = listed.filter((terminal) => terminal.id !== id);
    queueMicrotask(() => app.emit(event({ name: "terminal.changed" })));

    return null;
  };

  const [exit, setExit] = createSignal<{ code: number | null } | null>(null);
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0, exit);
  const emulators = fakeEmulators();

  if (selected !== null) connected.rail.select(selected);

  const rendered = render(() => {
    const [screens, setScreens] = createSignal<Screens>();

    return (
      <ConnectedProjectContext.Provider value={connected}>
        <div class="centre-stack">
          <Pane createEmulator={emulators.factory} screensRef={setScreens} />
          <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
          <ResourceStrip />
        </div>
      </ConnectedProjectContext.Provider>
    );
  });

  return { app, connected, emulators, setExit, container: rendered.container, setListed: (next: TerminalInfo[]) => (listed = next) };
};

export const bubbleChord = (key: string, init: KeyboardEventInit = {}, target: Element | Window = window): KeyboardEvent => {
  const code = key === "." ? "Period" : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const press = new KeyboardEvent("keydown", { key, code, metaKey: true, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(press);

  return press;
};

export const bubbleNames = (): string[] => [...document.querySelectorAll(".bubble-name")].map((name) => name.textContent ?? "");

export const bubbleCalls = (app: ReturnType<typeof createFakeApp>, method: string) => app.calls.filter((call) => call.method === method).map((call) => call.params);
