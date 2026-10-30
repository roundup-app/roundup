import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";
import { RpcError } from "../app/seam";
import { applying } from "../app/pending";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

afterEach(() => { cleanup(); localStorage.clear(); });

const actor = { kind: "user", id: "user", parent: null } as const;
const nameOf = () => document.getElementById("rail-name-a")?.textContent;
const row = () => document.getElementById("rail-name-a")?.closest("[aria-busy], [role=treeitem]");
const rename = (to: string) => {
  fireEvent.dblClick(screen.getByText("Old"));
  const field = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(field, { target: { value: to } });
  fireEvent.keyDown(field, { key: "Enter" });
};

it("u5172a_unknown_rename_shows_the_asked_name_throughout", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.app.handlers["rail.rename"] = () => { throw new RpcError(-32603, "no reply to rail.rename within 5s"); };
  const seen: (string | null | undefined)[] = [];
  rename("New");
  await waitFor(() => expect(row()?.getAttribute("aria-busy")).toBe("true"));
  seen.push(nameOf());
  mounted.app.emit({ name: "rail.renamed", data: { id: "a", name: "New" }, actor });
  await waitFor(() => expect(row()?.getAttribute("aria-busy")).toBeNull());
  seen.push(nameOf());
  expect(seen).toEqual(["New", "New"]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(railCallsTo(mounted.app, "rail.rename")).toHaveLength(1);
});

it("u5172b_late_event_does_not_flip_the_name", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.app.handlers["rail.rename"] = () => { throw new RpcError(-32603, "no reply"); };
  const read = [nameOf()];
  rename("New");
  await waitFor(() => expect(nameOf()).toBe("New"));
  mounted.app.emit({ name: "rail.changed", actor });
  await mounted.connected.rail.settled();
  read.push(nameOf());
  mounted.app.handlers["rail.tree"] = () => [agent("a", "idle", "ready", { name: "New" })];
  mounted.app.emit({ name: "rail.renamed", data: { id: "a", name: "New" }, actor });
  mounted.app.emit({ name: "rail.changed", actor });
  await mounted.connected.rail.settled();
  read.push(nameOf());
  expect(read).toEqual(["Old", "New", "New"]);
});

it("u5172a_refused_rename_restores_and_shows_why", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.app.handlers["rail.rename"] = () => { throw new RpcError(-32003, "name taken"); };
  rename("New");
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("name taken"));
  expect(mounted.connected.rail.pendingOf("a")).toBeNull();
  expect(mounted.connected.rail.nodes[0]?.name).toBe("Old");
});

it("u5172a_confirming_event_clears_the_mark", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.connected.rail.hold("a", { kind: "rename", asked: "New", base: "Old" });
  expect(mounted.connected.rail.pendingOf("a")).not.toBeNull();
  mounted.app.emit({ name: "rail.renamed", data: { id: "a", name: "New" }, actor });
  expect(mounted.connected.rail.pendingOf("a")).toBeNull();
  expect(mounted.connected.rail.nodes[0]?.name).toBe("New");
});

it("u5172a_contradicting_read_shows_the_daemon_value", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.connected.rail.hold("a", { kind: "rename", asked: "New", base: "Old" });
  mounted.app.handlers["rail.tree"] = () => [agent("a", "idle", "ready", { name: "Other" })];
  mounted.app.emit({ name: "rail.changed", actor });
  await mounted.connected.rail.settled();
  expect(mounted.connected.rail.pendingOf("a")).toBeNull();
  expect(mounted.connected.rail.nodes[0]?.name).toBe("Other");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

it("u5172b_pending_remove_keeps_the_row_marked", async () => {
  const mounted = await mountRail([agent("a", "idle", "ready", { name: "Old" })]);
  mounted.connected.rail.hold("a", { kind: "remove" });
  mounted.app.emit({ name: "rail.changed", actor });
  await mounted.connected.rail.settled();
  expect(row()?.getAttribute("aria-busy")).toBe("true");
  mounted.app.handlers["rail.tree"] = () => [];
  mounted.app.emit({ name: "rail.changed", actor });
  await mounted.connected.rail.settled();
  expect(mounted.connected.rail.pendingOf("a")).toBeNull();
  expect(mounted.connected.rail.nodes).toHaveLength(0);
});

it("u5172a_helper_maps_outcomes", async () => {
  expect(await applying(async () => 1)).toEqual({ kind: "applied", value: 1 });
  expect((await applying(async () => { throw new RpcError(-32003, "no"); })).kind).toBe("refused");
  expect((await applying(async () => { throw new RpcError(-32603, "internal"); })).kind).toBe("pending");
  expect((await applying(async () => { throw new Error("no reply within"); })).kind).toBe("pending");
  expect((await applying(() => Promise.reject("foreign"))).kind).toBe("pending");
});

const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);

  return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) && !/\.test\.|testing/.test(path) ? [path] : [];
});

it("u5172a_every_mutation_goes_through_the_helper", () => {
  const adopted = ["rail/Rail.tsx", "rail/menu/model.ts", "rail/MovePicker.tsx", "todos/deleteTodos.ts"];
  const root = join(__dirname, "..");
  const direct = sources(root).filter(path => /app\.rpc\(\s*"rail\.(rename|remove|move)"/.test(readFileSync(path, "utf8")));
  expect(direct.map(path => path.slice(root.length + 1)).filter(path => !adopted.includes(path))).toEqual(["perf/fixture.ts"]);

  for (const file of adopted) expect(readFileSync(join(root, file), "utf8")).toContain("applying(");
});
