import { render } from "@solidjs/testing-library";
import type { Ask } from "@contracts/ask/Ask";
import type { RailNode } from "@contracts/agent/RailNode";
import { Keys } from "../keys/Keys";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, workstream } from "../testing/nodes";
import { AskBar } from "./AskBar";

const TREE: RailNode[] = [
  door("lead", "idle", "idle", { name: "lead" }),
  agent("ann", "working", "busy", { parent: "lead", name: "Ann" }),
  door("ops", "needs-you", "asks", { order: 1, name: "ops" }),
  workstream("docs", { order: 2, name: "docs" }),
];

/** The Ask bar of an open Project on the fake Daemon, with `Keys` for `⌘/`; `asks` seeds `ask.list`. */
export const mountAskBar = async (asks: Ask[] = [], selected: string | null = null, tree: RailNode[] = TREE) => {
  const app = createFakeApp();

  app.handlers["rail.tree"] = () => tree;
  app.handlers["ask.list"] = () => asks;

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  if (selected !== null) connected.rail.select(selected);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Keys />
      <button type="button" class="outside">outside</button>
      <div class="centre-stack"><AskBar /></div>
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, connected };
};

export const ask = (id: string, at: number, parts: Ask["parts"], text = parts.map((part) => part.text).join(" ")): Ask => ({ id, text, at: BigInt(at), parts });

export const input = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(".ask-input");

export const rowTexts = (): string[] => [...document.querySelectorAll(".ask-row")].map((row) => [...row.querySelectorAll(".ask-text, .ask-where, .ask-state")].map((part) => part.textContent?.trim()).join(" | "));

export const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, code: key === "/" ? "Slash" : key, bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(event);

  return event;
};
