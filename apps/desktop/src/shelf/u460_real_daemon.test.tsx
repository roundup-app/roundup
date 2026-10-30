import { askToDelete, questionClosed } from "./bulkQuestionHarness";
// @vitest-environment jsdom
import { connect } from "node:net";
import * as v from "valibot";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { showShelfTab } from "../testing/shelfTabs";
import { stubDialogLayout } from "./bulkQuestionHarness";

let real: StartedDaemon;

const replySchema = v.object({ id: v.number(), result: v.optional(v.unknown()), error: v.optional(v.object({ code: v.number(), message: v.string() })) });

const ownerCall = (owner: string, method: "pad.create" | "pad.write" | "pad.append", name: string, text: string): Promise<v.InferOutput<typeof replySchema>> => new Promise((resolve, reject) => {
  const socket = connect(join(real.dir, "rupd.sock"));
  const timer = setTimeout(() => { socket.destroy(); reject(new Error("owner call timed out")); }, 20_000);
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "daemon.identify", params: { actor: { kind: "agent", id: owner, parent: null } } }) + "\n"));
  socket.on("data", (chunk: string) => {
    buffer += chunk;

    for (;;) {
      const end = buffer.indexOf("\n");

      if (end < 0) break;
      const frame = v.parse(replySchema, JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);

      if (frame.id === 1 && !frame.error) socket.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method, params: { name, text } }) + "\n");
      else {
        clearTimeout(timer);
        socket.destroy();
        resolve(frame);
      }
    }
  });
  socket.on("error", (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
});

// Rail's Ark selection acknowledgement must precede Shelf inputs: a late scope
// change clears selection in createSelection and resets createBulkDelete.
const openShelf = async (tab: "Todos" | "Pads", all = false) => {
  const workstream = await screen.findByRole("treeitem", { name: /bulk-scope/ });
  fireEvent.click(workstream.querySelector<HTMLElement>('[data-part="branch-control"]') ?? workstream);
  await waitFor(() => expect(workstream.getAttribute("aria-selected")).toBe("true"));
  showShelfTab(tab);
  await waitFor(() => {
    expect(within(screen.getByRole("tablist", { name: "Bench" })).getByRole("tab", { name: new RegExp(`^${tab}`) }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: new RegExp(`^${tab}`) })).toBeTruthy();
  });

  if (all) fireEvent.click(document.querySelector('[data-todo-root]')!);

  // U3717: Unassigned starts folded.
  if (tab === "Todos" || tab === "Pads") {
    const unassigned = await waitFor(() => document.querySelector<HTMLElement>('[data-shelf-group="unassigned"][data-state="closed"] [data-part="branch-control"]') ?? Promise.reject(new Error("no group"))).catch(() => null);

    if (unassigned) fireEvent.click(unassigned);
  }
};

const selectRow = async (name: string | RegExp) => {
  const row = await screen.findByRole("button", { name });
  fireEvent.click(row, { metaKey: true });
  await waitFor(() => expect(row.getAttribute("aria-pressed")).toBe("true"));
};

const deleteSelected = async (count: number) => {
  await askToDelete(count);
  await questionClosed();
};

beforeAll(async () => {
  real = await startRealDaemon({});
}, 120_000);

afterAll(async () => { await real?.stop(); });

afterEach(cleanup);

stubDialogLayout();

it("u460_bulk_todo_delete_preserves_t6_across_homes", async () => {
  const app = createServedApp(real.base);
  const one = await app.rpc("rail.createWorkstream", { name: "bulk-scope", parent: null });
  const other = await app.rpc("rail.createWorkstream", { name: "elsewhere", parent: null });
  const first = await app.rpc("todo.create", { title: "blocker one", body: null, blockers: null });
  const second = await app.rpc("todo.create", { title: "blocker two", body: null, blockers: null });
  await app.rpc("todo.move", { id: first.id, home: one.id });
  await app.rpc("todo.move", { id: second.id, home: one.id });
  const dependent = await app.rpc("todo.create", { title: "dependent", body: null, blockers: [first.id, second.id] });
  await app.rpc("todo.move", { id: dependent.id, home: other.id });
  render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await openShelf("Todos");
  await selectRow(new RegExp(`^(Idle|Blocked|Done) #${first.id} `));
  await selectRow(new RegExp(`^(Idle|Blocked|Done) #${second.id} `));
  await deleteSelected(2);
  await waitFor(async () => {
    const rows = await app.rpc("todo.list", null);
    expect(rows.find((row) => row.id === dependent.id)?.blockers).toEqual([]);
    expect(rows.some((row) => row.id === first.id || row.id === second.id)).toBe(false);
  });
}, 60_000);

for (const files of [false, true]) it(`u460_deleted_pad_updates_do_not_recreate_it files=${files}`, async () => {
  const app = createServedApp(real.base);
  await app.rpc("pad.setStorage", { files });
  const name = `bulk-pad-${files}`;
  const owner = (await app.rpc("rail.tree", null)).find((row) => row.name === "bulk-scope")!;
  expect((await ownerCall(owner.id, "pad.create", name, "before")).error).toBeUndefined();
  expect((await ownerCall(owner.id, "pad.write", name, "committed before delete")).error).toBeUndefined();
  render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await openShelf("Pads", true);
  await selectRow(name);
  await deleteSelected(1);
  await waitFor(async () => expect((await app.rpc("pad.list", null)).some((row) => row.name === name)).toBe(false));
  expect((await ownerCall(owner.id, "pad.write", name, "after")).error?.code).toBe(-32001);
  expect((await ownerCall(owner.id, "pad.append", name, "after")).error?.code).toBe(-32001);
  await expect(app.rpc("pad.read", { name })).rejects.toMatchObject({ code: -32001 });
  const projects = join(real.dataDir, "projects");

  const keys = readdirSync(projects);

  expect(keys.length).toBeGreaterThan(0);

  for (const key of keys) expect(existsSync(join(projects, key, "pads", `${name}.md`))).toBe(false);
  expect((await app.rpc("pad.create", { name, text: "explicit new Pad" })).text).toBe("explicit new Pad");
  await app.rpc("pad.delete", { name });
}, 60_000);

it("u460_refused_transaction_preserves_t6_across_homes", async () => {
  const app = createServedApp(real.base);
  const homes = await app.rpc("rail.tree", null);
  const one = homes.find((row) => row.name === "bulk-scope")!;
  const other = homes.find((row) => row.name === "elsewhere")!;
  const first = await app.rpc("todo.create", { title: "partial one", body: null, blockers: null });
  const second = await app.rpc("todo.create", { title: "partial two", body: null, blockers: null });
  await app.rpc("todo.move", { id: first.id, home: one.id });
  await app.rpc("todo.move", { id: second.id, home: one.id });
  const dependent = await app.rpc("todo.create", { title: "partial dependent", body: null, blockers: [first.id, second.id] });
  await app.rpc("todo.move", { id: dependent.id, home: other.id });

  const failedApp: typeof app = {
    ...app,
    rpc: (method, params) => method === "todo.delete" && params && "ids" in params && params.ids.some(id => id === second.id) ? Promise.reject(new Error("injected unavailable connection")) : app.rpc(method, params),
    forProject: () => failedApp,
  };

  render(() => <App app={failedApp} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await openShelf("Todos");
  await selectRow(new RegExp(`^(Idle|Blocked|Done) #${first.id} `));
  await selectRow(new RegExp(`^(Idle|Blocked|Done) #${second.id} `));
  await deleteSelected(2);
  await screen.findByText(/partial two .*injected unavailable connection/);
  const rows = await app.rpc("todo.list", null);
  expect(rows.find((row) => row.id === dependent.id)).toMatchObject({ blockers: [first.id, second.id], blocked: true, home: other.id });
  expect(rows.some((row) => row.id === first.id)).toBe(true);
  expect(rows.some((row) => row.id === second.id)).toBe(true);
}, 60_000);

it("u460_deleted_rows_stay_absent_after_reopening_the_project", async () => {
  await real.restart();
  const app = createServedApp(real.base);
  const todos = await app.rpc("todo.list", null);
  expect(todos.map((todo) => todo.title)).toEqual(["dependent", "partial one", "partial two", "partial dependent"]);
  expect((await app.rpc("pad.list", null)).some((pad) => pad.name.startsWith("bulk-pad-"))).toBe(false);
  render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  await openShelf("Todos");
  const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ partial two/ });
  expect(row.getAttribute("aria-pressed")).toBe("false");
  expect([screen.queryByRole("group", { name: "Bench deletion" })]).toEqual([null]);
}, 60_000);
