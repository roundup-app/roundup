import type { Actor } from "@contracts/Actor";
import type { RailNode } from "@contracts/agent/RailNode";
import type { AppSeam } from "../app/seam";
import { USER } from "../pads/owner";

/** Derived from testing/seeds.ts's nestedTree, todosAt and padsAt; no random seed or wall time enters the workload description. */
const description = {
  identity: "tree-40-native-v1",
  rail: [
    { name: "payments", parent: null, kind: "workstream" },
    { name: "backend", parent: null, kind: "workstream" },
    { name: "auth-refactor", parent: "backend", kind: "workstream" },
    { name: "migrate-db", parent: "backend", kind: "agent" },
    { name: "token-rotation", parent: "auth-refactor", kind: "agent" },
    { name: "login-store", parent: "auth-refactor", kind: "agent" },
    { name: "docs", parent: "auth-refactor", kind: "agent" },
    ...Array.from({ length: 33 }, (_, index) => ({ name: `agent-${index + 1}`, parent: index % 3 === 0 ? "payments" : null, kind: "agent" })),
  ],
  // Two groups, each with a three-level branch and a sibling for committed reorder.
  todos: Array.from({ length: 8 }, (_, index) => ({
    title: index === 2 ? "a very long todo title that goes on and on past the width of the shelf column" : `todo ${index + 1}`,
    owner: index < 4 ? "user" : "token-rotation",
    parent: index % 4 === 1 || index % 4 === 2 ? index - 1 : null,
    body: "body text",
  })),
  pads: Array.from({ length: 4 }, (_, index) => ({ name: index === 1 ? "a-pad-with-a-very-long-name-here" : `pad-${index}`, text: "# hello\nsome text\n".repeat(30) })),
  working: ["token-rotation", ...Array.from({ length: 9 }, (_, index) => `agent-${index + 1}`)],
};

export type Fixture = {
  identity: string;
  bytes: string;
  sha256: string;
  home: string;
  rail: { name: string; id: string }[];
  todos: { id: number; title: string; owner: Actor; blockers: number[] }[];
  pads: string[];
  working: string[];
  terminal: string;
};

/** Only the isolated measurement Project is writable. Existing user items are never adopted or erased. */
export const prepareFixture = async (app: Pick<AppSeam, "rpc">, cwd: string, terminal: string): Promise<Fixture> => {
  const [tree, todos, pads] = await Promise.all([app.rpc("rail.tree", null), app.rpc("todo.list", null), app.rpc("pad.list", null)]);
  const home = tree[0];

  if (tree.length !== 1 || home?.kind !== "workstream" || todos.length || pads.length) {
    throw new Error("the native fixture needs an isolated Project with only the measurement Workstream and no Todos or Pads");
  }

  const bytes = JSON.stringify(description);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes));
  const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const nodes = new Map<string, RailNode>();

  await app.rpc("rail.rename", { id: home.id, name: "payments" });
  nodes.set("payments", { ...home, name: "payments" });

  for (const row of description.rail.slice(1)) {
    const parent = row.parent === null ? null : nodes.get(row.parent)?.id;

    if (parent === undefined) throw new Error(`missing fixture parent ${row.parent}`);
    const node = row.kind === "workstream"
      ? await app.rpc("rail.createWorkstream", { name: row.name, parent })
      : await app.rpc("agent.spawn", { cwd, prompt: null, parent, name: row.name });

    nodes.set(row.name, node);
    if (row.kind === "agent") await app.rpc("agent.signal", {
      id: node.id, attempt: node.attempt ?? "1",
      payload: description.working.includes(row.name) ? { hook_event_name: "UserPromptSubmit", prompt: "work" } : { hook_event_name: "Stop" },
    });
  }

  const ownerId = nodes.get("token-rotation")!.id;
  const made: Fixture["todos"] = [];

  for (const row of description.todos) {
    const owner: Actor = row.owner === "user" ? USER : { kind: "agent", id: ownerId, parent: null };
    const blockers = row.parent === null ? [] : [made[row.parent]!.id];
    const todo = await app.rpc("todo.create", { title: row.title, body: row.body, blockers, owner });

    await app.rpc("todo.move", { id: todo.id, home: home.id });
    made.push({ id: todo.id, title: row.title, owner, blockers });
  }

  for (const pad of description.pads) {
    await app.rpc("pad.create", pad);
    await app.rpc("pad.move", { name: pad.name, home: home.id });
  }

  const fixture: Fixture = {
    identity: description.identity, bytes, sha256, home: home.id,
    rail: [...nodes].map(([name, node]) => ({ name, id: node.id })), todos: made,
    pads: description.pads.map(pad => pad.name), working: description.working.map(name => nodes.get(name)!.id), terminal,
  };

  // Read back the public seam: an acknowledged write alone does not establish the fixture.
  const [actualTree, actualTodos, actualPads, terminals] = await Promise.all([
    app.rpc("rail.tree", null), app.rpc("todo.list", null), app.rpc("pad.list", null), app.rpc("terminal.list", null),
  ]);
  const compatible = actualTree.length === 40 && fixture.rail.every(row => {
    const wanted = description.rail.find(other => other.name === row.name)!;
    const actual = actualTree.find(other => other.id === row.id);
    const parent = wanted.parent === null ? null : nodes.get(wanted.parent)!.id;

    return actual?.name === row.name && actual.kind === wanted.kind && actual.parent === parent;
  }) && actualTodos.length === 8 && made.every(row => {
    const actual = actualTodos.find(other => other.id === row.id);

    return actual && !actual.done && actual.home === home.id && actual.title === row.title
      && JSON.stringify(actual.owner) === JSON.stringify(row.owner) && JSON.stringify(actual.blockers) === JSON.stringify(row.blockers);
  }) && actualPads.length === 4 && description.pads.every(row => actualPads.some(pad => pad.name === row.name && pad.text === row.text && pad.home === home.id))
    && fixture.working.every(id => actualTree.find(node => node.id === id)?.status?.kind === "working")
    && terminals.some(row => row.id === terminal && row.running);

  if (!compatible) throw new Error("the native fixture readback differs from tree-40-native-v1");

  return fixture;
};
