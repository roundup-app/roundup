// fallow-ignore-file duplicate-export -- press supplies Ask slash-key codes; switcherFixture supplies letter-key codes. Tests import each directly.
import { createSignal, Show } from "solid-js";
import { render } from "@solidjs/testing-library";
import type { Ask } from "@contracts/ask/Ask";
import type { RailNode } from "@contracts/agent/RailNode";
import { DrawerHost } from "../drawer/DrawerHost";
import { Keys } from "../keys/Keys";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, workstream } from "../testing/nodes";
import { createRailState } from "../state/rail";
import { Pane } from "../terminal/Pane";
import { fakeEmulators } from "../terminal/paneHarness";
import { AskBar } from "./AskBar";

const TREE: RailNode[] = [
  door("lead", "idle", "idle", { name: "lead" }),
  agent("ann", "working", "busy", { parent: "lead", name: "Ann" }),
  door("ops", "needs-you", "asks", { order: 1, name: "ops" }),
  workstream("docs", { order: 2, name: "docs" }),
];

/** The Ask bar of an open Project on the fake Daemon, with `Keys` for `⌘/`; `asks` seeds `ask.list`. */
/** Stands in for the Overview menu: the panel opens through the same entry, shown only while work qualifies. */
const RecoveryEntry = () => {
  const entries = useRecoveryMenu();

  return <Show when={entries().length > 0}><button type="button" onClick={() => void entries()[0]!.run?.()}>Recover unfinished work</button></Show>;
};

export const mountAskBar = async (asks: Ask[] | Error = [], selected: string | null = null, tree: RailNode[] | Promise<RailNode[]> = structuredClone(TREE), pane = false, path = `/ask-${crypto.randomUUID()}`, reducedMotion = false) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree instanceof Promise ? [] : tree;
  app.handlers["ask.list"] = () => {
    if (asks instanceof Error) throw asks;

    return asks;
  };

  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "existing output" });
  app.handlers["terminal.resize"] = () => null;
  const { factory } = fakeEmulators();
  const connected = await connectProject(app, { name: "p", path }, () => reducedMotion, () => 0);

  if (tree instanceof Promise) {
    app.handlers["rail.tree"] = () => tree;
    connected.rail = createRailState(app, connected.events);
  }

  if (selected !== null) connected.rail.select(selected);

  const [recovery, setRecovery] = createSignal<{ project: string; revision: string }>();

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <aside class="rail"><RecoveryEntry /></aside>
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      <button type="button" class="outside">outside</button>
      <div class="centre-stack">{pane && <Pane createEmulator={factory} />}<AskBar recovery={recovery()} /></div>
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, connected, setRecovery, unmount: view.unmount };
};

export const ask = (id: string, at: number, parts: Ask["parts"], text = parts.map((part) => part.text).join(" ")): Ask => ({ id, text, at: BigInt(at), parts });

export const input = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(".ask-input");

export const rowTexts = (): string[] => [...document.querySelectorAll(".ask-row")].map((row) => [...row.querySelectorAll(".ask-text, .ask-where, .ask-state")].map((part) => part.textContent?.trim()).join(" | "));

export const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, code: key === "/" ? "Slash" : key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};
