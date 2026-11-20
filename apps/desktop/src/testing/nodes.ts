import type { Event as DaemonEvent } from "@contracts/Event";
import type { EventData } from "@contracts/EventData";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

/** RO5: the node when it has a Door (a Workstream or an Agent), `undefined` for a Group or no node. */
export const doorOf = (node: RailNode | undefined): DoorNode | undefined => node && isDoor(node) ? node : undefined;

export const NOW = 1_700_000_000_000;

export const MINUTE = 60_000;

import { USER } from "../pads/owner";
import { isDoor } from "../state/doorNode";
import type { DoorNode } from "../state/doorNode";

export { USER };

export const event = (data: EventData): DaemonEvent => ({ actor: USER, ...data });

/** O1: the Clarification order of a node that was given none. */
export const clarifying = (question: string): Order => ({ kind: "clarification", question });

type Of<K extends RailNode["kind"]> = Extract<RailNode, { kind: K }>;

const doorFacts = (id: string): Omit<Of<"agent">, "kind" | "id" | "name" | "parent" | "order" | "can_make_workstream" | "can_save_as_mode"> => ({
  status: { kind: "working", label: "starting", since: 0, finished: "0" },
  attempt: "1",
  status_revision: "1",
  terminal_id: `t-${id}`,
  worktree: null,
  can_resume: false, has_conversation: false, yolo: false,
  channel: null,
  stray: [],
  model: null,
  effort: null,
  work: null,
});

/** An Agent that started working at time 0; a `kind` override makes a Workstream or a Group of the same id. */
export function node(id: string, over?: Partial<Of<"agent">>): Of<"agent">;
export function node(id: string, over: Partial<Of<"workstream">> & { kind: "workstream" }): Of<"workstream">;
export function node(id: string, over: Partial<Of<"group">> & { kind: "group" }): Of<"group">;
export function node(id: string, over: Partial<RailNode> = {}): RailNode {
  const base = { id, name: id, parent: null, order: 0 };

  if (over.kind === "group") {
    // SAFETY: a Group carries only the base fields plus its override.
    return { ...base, ...over } as RailNode;
  }

  if (over.kind === "workstream") {
    // SAFETY: the workstream branch carries every Workstream field.
    return { ...base, ...doorFacts(id), auto: false, work: clarifying("What is this Workstream for?"), ...over } as RailNode;
  }

  // SAFETY: the default branch carries every Agent field.
  return { ...base, ...doorFacts(id), kind: "agent", can_make_workstream: false, can_save_as_mode: false, ...over } as RailNode;
}

export const agent = (id: string, kind: Kind, label: string, over: Partial<Of<"agent">> = {}): Of<"agent"> =>
  node(id, { status: { kind, label, since: NOW, finished: "0" }, ...over });

export const workstream = (id: string, over: Partial<Of<"workstream">> = {}): Of<"workstream"> =>
  node(id, { kind: "workstream", status: { kind: "done", label: "terminal gone", since: NOW, finished: "0" }, attempt: null, status_revision: null, terminal_id: null, ...over });

/** A Door as the Daemon sends it: a Workstream with a live Agent sitting at it. */
export const door = (id: string, kind: Kind, label: string, over: Partial<Of<"workstream">> = {}): Of<"workstream"> =>
  workstream(id, { attempt: "1", status_revision: "1", status: { kind, label, since: NOW, finished: "0" }, terminal_id: `t-${id}`, ...over });

/** A Mode is an Agent row with its saved first prompt. */
export const mode = (id: string, prompt: string, over: Partial<Of<"agent">> = {}): Of<"agent"> =>
  node(id, { mode_prompt: prompt, ...over });

/** A node that holds a Terminal and no Status: the Pane's tests mount one. A Terminal is no Rail row (X12), so it is an Agent here. */
export const terminal = (id: string, over: Partial<Of<"agent">> = {}): Of<"agent"> =>
  node(id, { status: null, attempt: null, status_revision: null, work: null, ...over });

export const info = (id: string, over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id,
  incarnation: `fixture-${id}`,
  cwd: "/p",
  title: null,
  program: "zsh",
  running: true,
  exit_code: null,
  owner: null,
  ...over,
});

/** U347: the Rail row `showEverything` selects. */
export const SCOPE_ROW = "scope-row";
