// fallow-ignore-file duplicate-export -- press supplies Ask slash-key codes; switcherFixture supplies letter-key codes. Tests import each directly.
import { createSignal, flush, Show } from "solid-js";
import { expect } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import type { Ask } from "@contracts/ask/Ask";
import type { RailNode } from "@contracts/agent/RailNode";
import { DrawerHost } from "../drawer/DrawerHost";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import type { AskRouting } from "../state/asks";
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

/** The Ask bar of an open Project on the fake Daemon, with its registered `⌘/` owner; `asks` seeds `ask.list`. */
/** Stands in for the Overview menu: the panel opens through the same entry, shown only while work qualifies. */
const RecoveryEntry = () => {
  const entries = useRecoveryMenu();

  return <Show when={entries().length > 0}><button type="button" onClick={() => void entries()[0]!.run?.()}>Recover unfinished work</button></Show>;
};

export const mountAskBar = async (asks: Ask[] = [], selected: string | null = null, tree: RailNode[] | Promise<RailNode[]> = structuredClone(TREE), pane = false, path = `/ask-${crypto.randomUUID()}`, reducedMotion = false, viewing = () => true, routing?: AskRouting) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree instanceof Promise ? [] : tree;
  app.handlers["ask.list"] = () => asks;

  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "existing output" });
  app.handlers["terminal.resize"] = () => null;
  const { factory } = fakeEmulators();
  const connected = await connectProject(app, { name: "p", path }, () => reducedMotion, () => 0, undefined, undefined, undefined, viewing, undefined, routing);

  connected.showView("workstreams");


  if (tree instanceof Promise) {
    app.handlers["rail.tree"] = () => tree;
    connected.rail = createRailState(app, connected.events);
  }

  if (selected !== null) connected.rail.select(selected);

  const [recovery, setRecovery] = createSignal<{ project: string; revision: string }>();

  const view = render(() => (
    <ConnectedProjectContext value={connected}>
      <aside class="rail"><RecoveryEntry /></aside>
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      <button type="button" class="outside">outside</button>
      <div class="centre-stack">{pane && <Pane createEmulator={factory} notice={connected.rail.failure()} retryNotice={() => void connected.rail.refresh({ terminals: true })} />}<AskBar recovery={recovery()} /></div>
    </ConnectedProjectContext>
  ));

  await connected.rail.settled();




  return { app, connected, setRecovery, unmount: view.unmount };
};

export const ask = (id: string, at: number, parts: Ask["parts"], text = parts.map((part) => part.text).join(" ")): Ask => ({ id, text, at: BigInt(at), parts });

export const input = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(".ask-input");

/** What a row shows: a Tooltip's content sits inside its cell, hidden, so it is no part of what the row reads. */
const shownText = (node: Node): string =>
  node instanceof Element && node.matches("[data-slot=tooltip-content]") ? ""
    : node.nodeType === Node.TEXT_NODE ? node.textContent ?? ""
      : [...node.childNodes].map(shownText).join("");

export const rowTexts = (): string[] => [...document.querySelectorAll(".ask-row")].map((row) => [...row.querySelectorAll(".ask-text, .ask-where, .ask-state")].map((part) => shownText(part).trim()).join(" | "));

export const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, code: key === "/" ? "Slash" : key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);
  flush();

  return event;
};

/** U6244c: only `⌘/` opens the Ask; the mounted bar starts closed, so tests open it as the user does. A press made before the App registers its keys is lost, so it is repeated until the Ask answers. */
export const openAsk = async (): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt++) {
    press("/", { metaKey: true }, document.querySelector(".outside") ?? document.body);

    try {
      await waitFor(() => expect(input()).not.toBeNull(), { timeout: 250 });

      return;
    } catch { /* the keys were not registered yet */ }
  }

  await waitFor(() => expect(input()).not.toBeNull());
};
