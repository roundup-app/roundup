import type { Event as DaemonEvent } from "@contracts/Event";
import type { EventData } from "@contracts/EventData";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";

export const NOW = 1_700_000_000_000;

export const MINUTE = 60_000;

import { USER } from "../pads/owner";

export { USER };

export const event = (data: EventData): DaemonEvent => ({ actor: USER, ...data });

/** O1: the Clarification order of a node that was given none. */
export const clarifying = (question: string): Order => ({ kind: "clarification", question });

/** An Agent that started working at time 0; the other builders refine it. */
export const node = (id: string, over: Partial<RailNode> = {}): RailNode => ({
  id,
  kind: "agent",
  name: id,
  parent: null,
  order: 0,
  status: { kind: "working", label: "starting", since: 0, finished: "0" },
  attempt: "1",
  status_revision: "1",
  terminal_id: `t-${id}`,
  worktree: null,
  can_resume: false, yolo: false,
  channel: null,
  stray: [],
  model: null,
  effort: null,
  work: over.kind === "workstream" ? clarifying("What is this Workstream for?") : null,
  ...over,
});

export const agent = (id: string, kind: Kind, label: string, over: Partial<RailNode> = {}): RailNode =>
  node(id, { status: { kind, label, since: NOW, finished: "0" }, ...over });

export const workstream = (id: string, over: Partial<RailNode> = {}): RailNode =>
  node(id, { kind: "workstream", status: { kind: "done", label: "terminal gone", since: NOW, finished: "0" }, attempt: null, status_revision: null, terminal_id: null, ...over });

/** A Door as the Daemon sends it: a Workstream with a live Agent sitting at it. */
export const door = (id: string, kind: Kind, label: string, over: Partial<RailNode> = {}): RailNode =>
  workstream(id, { attempt: "1", status_revision: "1", status: { kind, label, since: NOW, finished: "0" }, terminal_id: `t-${id}`, ...over });

/** A node that holds a Terminal and no Status: the Pane's tests mount one. A Terminal is no Rail row (X12), so it is an Agent here. */
export const terminal = (id: string, over: Partial<RailNode> = {}): RailNode =>
  node(id, { kind: "agent", status: null, attempt: null, status_revision: null, work: null, ...over });

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
