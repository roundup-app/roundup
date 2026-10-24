import type { Actor } from "@contracts/Actor";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { EventData } from "@contracts/EventData";
import type { Decision } from "@contracts/decision/Decision";
import type { Kind } from "@contracts/Kind";
import type { Message } from "@contracts/message/Message";
import type { ContextPart } from "@contracts/agent/ContextPart";
import type { ContextPartKind } from "@contracts/agent/ContextPartKind";
import type { ConversationOverview } from "@contracts/agent/ConversationOverview";
import type { RailNode } from "@contracts/agent/RailNode";
import type { KeptReason } from "@contracts/agent/KeptReason";
import type { ImportCandidate } from "@contracts/project/ImportCandidate";
import type { ImportOutcome } from "@contracts/project/ImportOutcome";
import type { Removal } from "@contracts/agent/Removal";
import type { Pad } from "@contracts/pad/Pad";
import type { Todo } from "@contracts/todo/Todo";
import { RpcError } from "../app/seam";
import type { Project } from "../app/seam";
import { createFakeApp } from "./fakeApp";
import { toBase64 } from "../terminal/base64";
import type { FakeApp } from "./fakeApp";
import { agent, workstream, MINUTE, door, USER } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";

const CONFLICT = -32003;

const NOT_FOUND = -32001;

const KINDS: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

export const SEEDS = ["first-run", "agents-10", "tree-40", "daemon-exits", "conflict", "empty-project", "door-stopped", "door-report", "decisions", "earlier-run", "context-bar", "tabs-8", "bubbles", "resources", "import-candidates", "note-queue"] as const;

export type SeedName = (typeof SEEDS)[number];

export const isSeedName = (name: string): name is SeedName => SEEDS.some((seed) => seed === name);

type Split = ContextPart[] | undefined;

const contextBarAgents = (now: number): RailNode[] => {
  const split = (...pairs: [ContextPartKind, number][]): ContextPart[] => pairs.map(([kind, tokens]) => ({ kind, tokens }));

  const rows: [string, string, number, number, Split][] = [
    ["split-agent", "full split", 84000, 200000, split(["system", 6000], ["tools", 18000], ["files", 12000], ["conversation", 40000], ["other", 8000])],
    ["bare-agent", "no split", 84000, 200000, undefined],
    ["dense-agent", "densest split", 500000, 1000000, split(["system", 3], ["tools", 120000], ["files", 90000], ["conversation", 250000], ["other", 39997])],
    ["full-agent", "96 percent", 192000, 200000, split(["system", 6000], ["tools", 18000], ["conversation", 168000])],
  ];

  return rows.map(([id, name, used, limit, context_parts], order) => {
    const overview: ConversationOverview = { program: "Claude Code", id: `${id}-session`, used, limit };

    if (context_parts) overview.context_parts = context_parts;

    return agent(id, "done", "finished", { name, order, terminal_id: null, status: statusAt(now, "done", "finished", 0), overview });
  });
};

const PROJECT: Project = { name: "harness", path: "/Users/you/harness" };

/** What the page can do to the Daemon the App is talking to. */
export type Controls = {
  app: FakeApp;
  emit(event: DaemonEvent): void;
  /** Replaces one node's Status and sends `agent.status`, as the Daemon does when an Adapter decides a new Kind. */
  setStatus(id: string, kind: Kind, label: string): void;
  /** The Terminal prints `text`: its bytes reach that Terminal's output subscription only, if it has one. */
  writeOutput(terminalId: string, text: string): void;
  /** Makes the Todos and Pads created from now on belong to `actor`, as when that Agent made them; the user until called. */
  actAs(actor: Actor): void;
  /** Makes the next `rpc` call, whatever its method, reject with `code` and `message`. */
  failNext(code: number, message: string): void;
};

const statusAt = (now: number, kind: Kind, label: string, minutesAgo: number) => ({
  kind,
  label,
  since: now - minutesAgo * MINUTE,
  finished: "0",
});

const cyclingAgents = (now: number, count: number, parentOf: (index: number) => string | null): RailNode[] =>
  Array.from({ length: count }, (_, index) => {
    const kind = KINDS[index % KINDS.length] ?? "idle";
    const name = `agent-${index + 1}`;

    return agent(name, kind, `${kind} label ${index + 1}`, {
      parent: parentOf(index),
      order: index,
      status: statusAt(now, kind, `${kind} label ${index + 1}`, index * 3 + 1),
    });
  });

/** Workstreams nested two deep, a Door with children and long names; 38 nodes in all. */
const nestedTree = (now: number): RailNode[] => [
  workstream("backend", { name: "backend" }),
  workstream("auth", { name: "auth-refactor", parent: "backend" }),
  door("payments", "working", "coordinating 3 children", {
    name: "payments workstream with a very long name that overflows the rail",
    order: 1,
    status: statusAt(now, "working", "coordinating 3 children", 42),
  }),
  agent("migrate", "needs-you", "asks: keep v1 routes? and a long label that should truncate in the live line", {
    name: "migrate-db",
    parent: "backend",
    order: 1,
    status: statusAt(now, "needs-you", "asks: keep v1 routes? and a long label that should truncate in the live line", 4),
  }),
  agent("tokens", "working", "editing src/auth/token.rs", {
    name: "token-rotation",
    parent: "auth",
    status: statusAt(now, "working", "editing src/auth/token.rs", 12),
  }),
  agent("logins", "error", "tests failed: 3", {
    name: "login-store",
    parent: "auth",
    order: 1,
    status: statusAt(now, "error", "tests failed: 3", 1),
  }),
  agent("docs", "done", "finished", { parent: "auth", order: 2, status: statusAt(now, "done", "finished", 30) }),
  ...cyclingAgents(now, 31, (index) => (index % 3 === 0 ? "payments" : null)),
];

/** U347: the Shelf shows what a running Agent owns, so every other seeded Todo belongs to `tokens`, and the user's Pads to the running Door `payments`. */
const RUNNING: Actor = { kind: "agent", id: "tokens", parent: null };

const todosAt = (now: number): Todo[] =>
  Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    title: index === 2 ? "a very long todo title that goes on and on past the width of the shelf column" : `todo ${index + 1}`,
    body: "body text",
    done: index === 6,
    blockers: index === 3 ? [3, 5] : [],
    blocked: index === 3,
    created_at: now,
    creator: index % 2 === 0 ? RUNNING : USER,
    home: null,
    owner: null,
    refs: [],
    estimate_minutes: null,
  }));

const padsAt = (now: number): Pad[] =>
  Array.from({ length: 4 }, (_, index) => ({
    incarnation: `fixture-${index}`,
    name: index === 1 ? "a-pad-with-a-very-long-name-here" : `pad-${index}`,
    owner: index % 2 === 1 ? USER : { kind: "agent", id: "agent-1", parent: null },
    text: "# hello\nsome text\n".repeat(30),
    updated_at: now,
    revision: 1,
    home: index % 2 === 1 ? "payments" : null,
  }));

const exitCodeOf = (target: RailNode): number | null => {
  if (target.status?.kind === "error") return 1;

  return target.status?.kind === "done" ? 0 : null;
};

/** Installs a Daemon that keeps the Rail, Todos and Pads in memory and sends the Events a real one sends after the same write. */
const installDaemon = (app: FakeApp, tree: RailNode[], now: number, withShelf: boolean, withBubbles = false, withImports = false): Controls => {
  const nodes = structuredClone(tree);
  const exits = new Map<string, number | null>();
  const outputOffsets = new Map<string, number>();
  const outputBytes = new Map<string, Uint8Array[]>();

  for (const other of nodes) {
    if (other.terminal_id && exitCodeOf(other) !== null) exits.set(other.terminal_id, exitCodeOf(other));
  }

  const send = (data: EventData) => app.emit({ actor: USER, ...data });

  const changed = <T,>(value: T): T => {
    queueMicrotask(() => send({ name: "rail.changed" }));

    return value;
  };

  const find = (id: string): RailNode => {
    const found = nodes.find((other) => other.id === id);

    if (!found) throw new RpcError(NOT_FOUND, `not found: node ${id}`);

    return found;
  };

  const append = (parent: string | null, made: (id: string, order: number) => RailNode): RailNode => {
    const added = made(`n${nodes.length + 1}`, nodes.filter((other) => other.parent === parent).length);
    nodes.push(added);

    return changed(added);
  };

  const exit = (terminalId: string) => {
    exits.set(terminalId, null);
    send({ name: "terminal.exited", data: { id: terminalId, code: null } });
  };

  let maker: Actor = USER;

  Object.assign(
    app.handlers,
    todoHandlers({ todos: withShelf ? todosAt(now) : [] }, send, () => maker),
    padHandlers({ pads: withShelf ? padsAt(now) : [], history: [{ actor: USER, verb: "wrote", item: "todo:1", at: now - 5 * MINUTE }] }, send, () => maker),
  );
  app.handlers["rail.tree"] = () => structuredClone(nodes);

  const candidates: ImportCandidate[] = withImports ? Array.from({ length: 10 }, (_, index) => ({
    source: `s${index}`,
    title: `調査と実装 — résumé — ${"Long conversation title ".repeat(8)}${index}`,
    cwd: `packages/deep/${"folder/".repeat(10)}destination-${index}`,
    last_activity_ms: BigInt(now - index * MINUTE),
    revision: `r${index}`,
  })) : [];

  const imported = new Map<string, ImportOutcome>();
  let refuseFirst = withImports;

  app.handlers["project.importDiscover"] = () => ({
    candidates: structuredClone(candidates.filter((candidate) => !imported.has(candidate.source))),
    excluded: withImports ? [{ source: "missing", reason: "Source unavailable: recorded folder no longer exists.", title: null, last_activity_ms: 1700000000000n }] : [],
  });
  app.handlers["project.importCommit"] = ({ selections }) => ({ outcomes: selections.map((selection): ImportOutcome => {
    const previous = imported.get(selection.source);

    if (previous) return previous;

    const candidate = candidates.find((each) => each.source === selection.source && each.revision === selection.revision);
    const error = !candidate ? "Source changed: refresh and choose again." : selection.source === "s0" && refuseFirst ? "Copy refused: source unreadable. Retry." : null;

    if (error || !candidate) {
      refuseFirst = false;

      return { source: selection.source, workstream: null, agent: null, error };
    }

    const parent = append(null, (id, order) => workstream(id, { name: candidate.title, order, status: null }));
    const child = append(parent.id, (id, order) => agent(id, "done", "", { name: candidate.title, parent: parent.id, order, status: null, terminal_id: null, attempt: null, status_revision: null, can_resume: true }));
    const outcome = { source: candidate.source, workstream: parent.id, agent: child.id, error: null };
    imported.set(candidate.source, outcome);

    return outcome;
  }) });

  const owned = new Map<string, { owner: string; title: string | null }>();
  let ownedCount = 0;

  const start = (owner: string, title: string | null) => {
    ownedCount += 1;

    const id = `${100 + ownedCount}`;

    owned.set(id, { owner, title });
    queueMicrotask(() => send({ name: "terminal.changed" }));

    return { terminal_id: id };
  };

  app.handlers["terminal.list"] = () =>
    [...new Set([...nodes.flatMap((node) => node.terminal_id ? [node.terminal_id] : []), ...owned.keys(), ...exits.keys()])].map((id) =>
      ({ id, incarnation: `seed-${PROJECT.path}-${id}`, cwd: PROJECT.path, title: owned.get(id)?.title ?? null, program: "zsh", running: !exits.has(id), exit_code: exits.get(id) ?? null, owner: owned.get(id)?.owner ?? null }));
  app.handlers["terminal.open"] = ({ workstream }) => start(workstream ?? PROJECT.path, null);
  app.handlers["agent.run"] = ({ id, command }) => start(id, command[0]?.split("/").pop() ?? null);
  app.handlers["terminal.close"] = ({ id }) => {
    if (!owned.delete(id)) throw new RpcError(NOT_FOUND, `not found: terminal ${id}`);

    exits.delete(id);
    queueMicrotask(() => send({ name: "terminal.changed" }));

    return null;
  };

  app.handlers["agent.spawn"] = ({ parent }) =>
    append(parent, (id, order) => agent(id, "working", "starting", { name: "agent", parent, order, status: statusAt(Date.now(), "working", "starting", 0) }));
  app.handlers["rail.createWorkstream"] = ({ name, parent }) => append(parent, (id, order) => workstream(id, { name, parent, order }));
  app.handlers["rail.rename"] = ({ id, name }) => changed(Object.assign(find(id), { name }));
  app.handlers["rail.startDoor"] = ({ id }) => {
    const node = find(id);

    if (node.kind !== "workstream" || (node.terminal_id !== null && !exits.has(node.terminal_id))) throw new Error("Door is already active");
    const attempt = String(BigInt(node.attempt ?? "0") + 1n);

    return changed(Object.assign(node, { attempt, status_revision: "1", terminal_id: `t-${id}-${attempt}`, status: statusAt(Date.now(), "working", "starting", 0) }));
  };

  app.handlers["rail.move"] = ({ id, parent, index }) => {
    const moved = find(id);
    const siblings = nodes.filter((other) => other.parent === parent && other.id !== id).sort((left, right) => left.order - right.order);
    siblings.splice(index, 0, Object.assign(moved, { parent }));
    siblings.forEach((sibling, order) => Object.assign(sibling, { order }));

    return changed(null);
  };

  const removeWorkstream = async (workstream: RailNode): Promise<Removal> => {
    const result: Removal = { removed: [], kept: [] };
    const descendants = (id: string): RailNode[] => nodes.filter((other) => other.parent === id).flatMap((child) => [child, ...descendants(child.id)]);
    const agentsBelow = descendants(workstream.id).filter((each) => each.kind === "agent");
    const staying = new Map<string, KeptReason>();

    for (const node of agentsBelow) {
      const finished = node.status?.kind === "done" || node.status?.kind === "error";
      const state = finished && node.worktree !== null ? await app.handlers["agent.worktreeState"]?.({ id: node.id }) : undefined;
      const reason: KeptReason | null = !finished ? "running" : state && state.ahead > 0 ? "ahead" : state?.dirty ? "dirty" : null;

      if (reason !== null) staying.set(node.id, reason);
    }

    for (const node of agentsBelow) {
      const reason = staying.get(node.id);

      if (reason === undefined) {
        result.removed.push({ id: node.id, kind: "agent", name: node.name });
      } else {
        Object.assign(node, { parent: workstream.parent, order: workstream.order + 0.5 + result.kept.length / 1000 });
        result.kept.push({ id: node.id, kind: "agent", name: node.name, reason });
      }
    }

    for (const other of descendants(workstream.id)) nodes.splice(nodes.indexOf(other), 1);

    for (const todo of (await app.handlers["todo.list"]?.(null)) ?? []) {
      if (todo.home !== workstream.id) continue;

      if (todo.done) {
        await app.handlers["todo.delete"]?.({ id: todo.id });
        result.removed.push({ id: String(todo.id), kind: "todo", name: todo.title });
      } else {
        await app.handlers["todo.move"]?.({ id: todo.id, home: null });
        result.kept.push({ id: String(todo.id), kind: "todo", name: todo.title, reason: "open" });
      }
    }

    for (const pad of (await app.handlers["pad.list"]?.(null)) ?? []) {
      if (pad.home !== workstream.id) continue;
      const reason = pad.owner.kind === "agent" ? staying.get(pad.owner.id) : undefined;

      if (reason === undefined) {
        await app.handlers["pad.delete"]?.({ name: pad.name });
        result.removed.push({ id: pad.name, kind: "pad", name: pad.name });
      } else {
        await app.handlers["pad.move"]?.({ name: pad.name, home: null });
        result.kept.push({ id: pad.name, kind: "pad", name: pad.name, reason });
      }
    }

    nodes.splice(nodes.indexOf(workstream), 1);
    nodes.filter((other) => other.parent === workstream.parent).sort((left, right) => left.order - right.order).forEach((sibling, order) => Object.assign(sibling, { order }));
    changed(null);

    return result;
  };

  app.handlers["rail.remove"] = ({ id }) => {
    const node = find(id);

    exit(node.terminal_id ?? `t-${id}`);

    if (node.kind === "workstream") return removeWorkstream(node);

    const siblings = nodes.filter((other) => other.parent === node.parent).sort((left, right) => left.order - right.order);
    const at = siblings.findIndex((other) => other.id === id);
    const children = nodes.filter((other) => other.parent === id).sort((left, right) => left.order - right.order);
    siblings.splice(at, 1, ...children.map((child) => Object.assign(child, { parent: node.parent })));
    siblings.forEach((sibling, order) => Object.assign(sibling, { order }));
    nodes.splice(nodes.indexOf(node), 1);

    return changed(null);
  };

  // D8: a fixed result, as the Daemon would sample it, for every running node.
  app.handlers["project.resources"] = () => {
    const agents = nodes.filter((node) => node.status && node.status.kind !== "done").map((node, index) => ({ id: node.id, memory_bytes: 412e6 + index * 1e6, cpu_percent: 18, disk_bytes: node.worktree ? 2.1e9 : null }));

    return { agents, total: { memory_bytes: agents.reduce((sum, entry) => sum + entry.memory_bytes, 0), cpu_percent: 18 * agents.length, disk_bytes: agents.some((entry) => entry.disk_bytes !== null) ? 2.1e9 : null } };
  };

  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = ({ id }) => {
    if (!owned.has(id) && !nodes.some((node) => node.terminal_id === id)) throw new RpcError(NOT_FOUND, `not found: terminal ${id}`);

    const chunks = outputBytes.get(id) ?? [];
    const bytes = new Uint8Array(outputOffsets.get(id) ?? 0);
    let at = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }

    return { cols: 100, rows: 30, after: at, data: toBase64(bytes) };
  };

  app.handlers["terminal.write"] = () => null;
  app.handlers["terminal.kill"] = (terminalId) => {
    exit(terminalId.id);

    return null;
  };

  app.handlers["agent.stop"] = ({ id }) => {
    const node = find(id);

    if (node.terminal_id === null) return null;

    exit(node.terminal_id);
    Object.assign(node, { terminal_id: null, status: statusAt(Date.now(), "done", "stopped", 0), status_revision: String(BigInt(node.status_revision ?? "0") + 1n) });

    return changed(null);
  };

  const write = (terminalId: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    const offset = outputOffsets.get(terminalId) ?? 0;

    outputOffsets.set(terminalId, offset + bytes.length);
    outputBytes.set(terminalId, [...(outputBytes.get(terminalId) ?? []), bytes]);
    app.emitBytes(terminalId, bytes);
  };

  if (withBubbles) {
    // U164's observer: an Agent with one running and one exited Run, a Workstream's Terminal, and the densest case, eight Runs.
    owned.set("101", { owner: "runner", title: "cargo test" });
    owned.set("102", { owner: "runner", title: "tail -f build.log" });
    exits.set("102", 0);
    owned.set("103", { owner: "first-workstream", title: "zsh" });

    for (let index = 0; index < 8; index += 1) owned.set(`${110 + index}`, { owner: "dense", title: index === 0 ? "a-run-named-with-sixty-characters-so-that-the-header-has-to-clip-it" : `run ${index}` });

    ownedCount = 20;
    afterFirstLoad(app, () => {
      for (const id of ["101", "103"]) write(id, `${id} ready\r\n`);
      write("110", `${"x".repeat(200)}\r\n`);
    });
  }

  let failure: RpcError | null = null;
  const rpc = app.rpc;
  app.rpc = async (method, params) => {
    if (failure) {
      const failing = failure;
      failure = null;
      throw failing;
    }

    return rpc(method, params);
  };

  return {
    app,
    emit: (event) => app.emit(event),
    actAs: (actor) => {
      maker = actor;
    },
    setStatus: (id, kind, label) => {
      const status = statusAt(Date.now(), kind, label, 0);
      find(id).status = status;
      const status_revision = String(BigInt(find(id).status_revision ?? "0") + 1n);
      find(id).status_revision = status_revision;
      send({ name: "agent.status", data: { attempt: find(id).attempt ?? "1", status_revision, id, status } });
    },
    writeOutput: (terminalId, text) => {
      write(terminalId, text);
    },
    failNext: (code, message) => {
      failure = new RpcError(code, message);
    },
  };
};

/** Runs `action` once the App has subscribed and its first reads have settled. */
const afterFirstLoad = (app: FakeApp, action: () => void) => {
  const subscribe = app.subscribe;
  app.subscribe = async (listener, after) => {
    const head = await subscribe(listener, after);
    setTimeout(action, 0);

    return head;
  };
};

/** A fake App on a Daemon holding the named seed; `now` is the clock the Statuses are measured from. */
export const seedApp = (name: SeedName, now: number): Controls => {
  const app = createFakeApp();
  const tree = (name === "tree-40" || name === "import-candidates") ? nestedTree(now) : cyclingAgents(now, 10, () => null);

  const nodes = name === "first-run" || name === "empty-project"
    ? []
    : name === "context-bar"
      ? contextBarAgents(now)
    : name === "earlier-run"
      ? [agent("earlier-agent", "done", "finished", { name: "earlier agent", overview: { program: "Claude Code", id: "earlier-session", name: "Recipe notebook", used: 84000, limit: 200000, card: { intent: "Collect household recipes", facts: ["Recipes stay local"], outcome: "Notebook saved" } }, terminal_id: null, status: statusAt(now, "done", "finished", 0) })]
      : name === "resources"
      ? [
        agent("worktree-agent", "working", "building", { name: "worktree agent", status: statusAt(now, "working", "building", 1), worktree: { path: "/p/.roundup/worktree-agent", branch: "roundup/worktree-agent", base: "main" } }),
        agent("bare-agent", "idle", "idle", { name: "bare agent", order: 1, status: statusAt(now, "idle", "idle", 2) }),
        agent("finished-agent", "done", "finished", { name: "finished agent", order: 2, terminal_id: null, status: statusAt(now, "done", "finished", 3) }),
      ]
      : name === "door-report"
      ? [
        door("r1", "working", "working", { name: "workstream-1" }),
        agent("c1", "working", "working", { name: "child", parent: "r1", work: { kind: "work", ask: "Give a short tour of the repo and say where the build starts, which tests run on a push and what a change must pass before it merges", limits: ["touch main", "skip tests", "edit contracts"] } }),
      ]
      : name === "bubbles"
        ? [
          workstream("first-workstream", { name: "first workstream" }),
          agent("runner", "working", "running tests", { name: "runner", parent: "first-workstream", status: statusAt(now, "working", "running tests", 2) }),
          agent("dense", "working", "eight Runs", { name: "dense", parent: "first-workstream", order: 1, status: statusAt(now, "working", "eight Runs", 1) }),
        ]
      : name === "door-stopped"
      ? [door("first-workstream", "done", "finished", { name: "first workstream", status: statusAt(now, "done", "finished", 0) })]
      : tree;

  const controls = installDaemon(app, nodes, now, name === "tree-40" || name === "conflict" || name === "import-candidates", name === "bubbles", name === "import-candidates");
  app.opened.project = name === "first-run" ? null : PROJECT;

  if (name === "tree-40") {
    // U3744, U3745: a cap of 3 and the first Workstream whose Door never started waiting for a slot.
    const waiting = nodes.find(node => node.kind === "workstream" && node.attempt === null);

    app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, workstreamCap: 3, models: { roles: [] } });
    app.handlers["workstream.queue"] = () => ({ running: 3, cap: 3, entries: waiting ? [{ workstream: waiting.id, start: { kind: "queued" } }] : [] });
  }

  if (name === "tabs-8") {
    // U184's observer: eight Projects, a needs-you Agent in the second and an error in the eighth.
    const marked = new Map<number, Kind>([[2, "needs-you"], [8, "error"]]);

    for (let index = 2; index <= 8; index += 1) {
      const kind = marked.get(index) ?? "working";
      const label = `${kind} label`;
      const project = app.add(`/Users/you/project-number-${index}`);

      installDaemon(app.of(project.path), [agent(`p${index}-agent`, kind, label, { status: statusAt(now, kind, label, 1) })], now, false);
    }
  }

  if (name === "note-queue") {
    // U3780's observer: the densest queue, a long multi-line note, an unbreakable word, non-Latin text and a pending note from another Agent.
    const from = { kind: "user", id: "user", parent: null } as const;
    const base = { to: "agent-4", kind: "note", replyTo: null, passedFrom: null, reason: null, status: "pending" } as const;

    const queued: Message[] = [
      { ...base, id: 1, from, body: `${"A very long first line that cannot fit one row of the narrowest pane ".repeat(4)}\nand a second line`, at: now },
      { ...base, id: 2, from, body: "x".repeat(120), at: now },
      { ...base, id: 3, from, body: "メモ: 次のステップで確認してください", at: now },
      { ...base, id: 4, from: { kind: "agent", id: "agent-2", parent: null }, body: "Shall I rebase onto main first?", at: now },
    ];

    let next = 5;

    app.handlers["message.list"] = () => queued;
    app.handlers["message.send"] = ({ to, kind, body, replyTo }) => {
      const sent = { ...base, to, kind, body, replyTo, id: next++, from, at: now };

      queued.push(sent);
      controls.emit({ actor: USER, name: "message.sent", data: sent });

      return sent;
    };
  }

  if (name === "resources") {
    // U408's observer: the densest case, 999.9 GB, 1600% and 12.3 TB, for the Agent with a Worktree.
    const dense = { memory_bytes: 999.9e9, cpu_percent: 1600, disk_bytes: 12.3e12 };

    app.handlers["project.resources"] = () => ({
      agents: [{ id: "worktree-agent", ...dense }, { id: "bare-agent", memory_bytes: 5e6, cpu_percent: 0, disk_bytes: null }],
      total: { memory_bytes: 999.9e9 + 5e6, cpu_percent: 1600, disk_bytes: 12.3e12 },
    });
  }

  if (name === "decisions") {
    const open = new Map<string, Decision>([
      ["d-1", { id: "d-1", agent: "agent-1", tool: "Bash", args: JSON.stringify({ command: "rm -rf build && cargo build --release", description: "Remove the build output" }), opened_at: now, answerable: true, scopes: ["once", "session"], risk: "destructive" }],
      ["d-4", { id: "d-4", agent: "agent-4", tool: "Edit", args: JSON.stringify({ file_path: "/Users/you/project/src/main.rs", old_string: "let a = 1;", new_string: "let a = 2;\nlet b = 3;" }), opened_at: now, answerable: true, scopes: ["once", "session", "project"] }],
      ["d-2", { id: "d-2", agent: "agent-2", tool: "ask_user", args: JSON.stringify({ question: "keep v1 routes?", answers: [{ label: "keep (recommended)", description: "no client breaks; the old routes stay to maintain", preview: "```text\nGET /v1/runs\nGET /v2/runs\n```" }, { label: "drop", description: "one set of routes; v1 clients break" }] }), opened_at: now, answerable: true }],
      ["d-3", { id: "d-3", agent: "agent-3", tool: "AskUserQuestion", args: "Layout\nWhich layout?\n1. Grid\n   Tiles\n   first\n   second\n2. List\n   Rows", opened_at: now, answerable: false }],
    ]);

    app.handlers["decision.list"] = () => [...open.values()];
    app.handlers["decision.capture"] = ({ id }) => {
      const decision = open.get(id);

      if (!decision) throw new RpcError(CONFLICT, "the original question is no longer open");

      return { daemon: "harness", agent: decision.agent, attempt: "1", decision: id };
    };

    app.handlers["decision.answer"] = ({ id }) => {
      open.delete(id);
      controls.emit({ actor: USER, name: "decision.cleared", data: { id, outcome: "answered" } });

      return null;
    };

    app.handlers["decision.revoke"] = () => null;
  }

  if (name === "daemon-exits") afterFirstLoad(app, () => app.exitDaemon({ code: 1 }));

  if (name === "conflict") afterFirstLoad(app, () => controls.failNext(CONFLICT, "name already taken"));

  return controls;
};
