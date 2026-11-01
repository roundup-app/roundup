import { leaderKey } from "../keys/leaderFixture";
import { render, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ActionRow } from "@contracts/action/ActionRow";
import type { Todo } from "@contracts/todo/Todo";
import type { Pad } from "@contracts/pad/Pad";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createNow, DisplayClockContext } from "../state/clock";
import { Bubbles } from "../bubbles/Bubbles";
import { AskBar } from "../ask/AskBar";
import { AttentionKey } from "../rail/AttentionKey";
import { Rail } from "../rail/Rail";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info, workstream } from "../testing/nodes";
import { Pane } from "../terminal/Pane";
import { fakeEmulators } from "../terminal/paneHarness";
import type { Screens } from "../terminal/screens";
import type { ToastQueue } from "../toasts/queue";
import { Switcher } from "./Switcher";

const TREE: RailNode[] = [
  door("lead", "idle", "idle", { name: "lead" }),
  agent("ann", "working", "busy", { parent: "lead", name: "Ann" }),
  agent("bob", "needs-you", "asks", { parent: "lead", order: 1, name: "Bob" }),
  agent("cy", "error", "failed", { parent: "lead", order: 2, name: "Cy" }),
  workstream("ops", { order: 1, name: "ops" }),
  agent("dee", "idle", "idle", { parent: "ops", name: "Dee" }),
];

const TERMINALS: TerminalInfo[] = [info("7", { owner: "ops", title: "build shell" })];

/** The Rail, a Pane, its bubbles and the Switcher in one open Project; `failures` collects what the Switcher reports. */
export const mountSwitcher = async (selected: string | null = null, tree: RailNode[] = TREE, terminals: TerminalInfo[] = TERMINALS, daemonExit: () => { code: number | null } | null = () => null, lists: { todos?: Todo[]; pads?: Pad[]; userActions?: () => ActionRow[] } = {}, notify?: ToastQueue["notify"]) => {
  const app = createFakeApp();
  let listed = [...terminals, ...tree.flatMap((node) => node.terminal_id ? [info(node.terminal_id)] : [])];

  app.handlers["rail.tree"] = () => tree;
  app.handlers["todo.list"] = () => lists.todos ?? [];
  app.handlers["pad.list"] = () => lists.pads ?? [];
  if (lists.userActions) app.handlers["action.userList"] = lists.userActions;
  app.handlers["terminal.list"] = () => listed;
  app.handlers["terminal.close"] = ({ id }) => {
    listed = listed.filter((terminal) => terminal.id !== id);

    return null;
  };

  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0, daemonExit);
  connected.showView("terminal-tabs");
  const emulators = fakeEmulators();
  const failures: (string | null)[] = [];

  if (selected !== null) connected.rail.select(selected);

  render(() => {
    const [screens, setScreens] = createSignal<Screens>();

    return (
      <DisplayClockContext.Provider value={createNow(() => Date.now()).subscribe}><ConnectedProjectContext.Provider value={connected}>
        <AttentionKey />
        <AskBar />
        <Rail />
        <div class="centre-stack">
          <Pane createEmulator={emulators.factory} screensRef={setScreens} />
          <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
          <div class="resource-strip" /><span class="resource-agent" />
          <Switcher notify={notify} onFailure={(message) => failures.push(message)} onOpen={() => {}} />
        </div>
      </ConnectedProjectContext.Provider></DisplayClockContext.Provider>
    );
  });

  await connected.rail.settled();
  await waitFor(() => { if (!app.calls.some(call => call.method === "todo.unread")) throw new Error("Overview comments have not started loading"); });

  return { app, connected, emulators, failures };
};

export const switcherKey = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};

/** Open the switcher as the leader does: `⌘K` then `K` (U2239). */
export const openSwitcher = (): void => void leaderKey("KeyK");

export const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>(".switcher input");

export const rows = (): string[] => [...document.querySelectorAll('.switcher .app-combobox-item:not([data-value^="action:"])')].map((row) => [...row.querySelectorAll("span:not(.glyph, .switcher-mark, .switcher-row, .failure-line):not(.glyph *)")].map((part) => part.textContent).join(" "));
