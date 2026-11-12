import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAxe } from "../testing/axe";
import { agent, door, event, NOW, workstream } from "../testing/nodes";
import { message } from "../testing/centreFixture";
import { createRoot, createSignal } from "solid-js";
import * as topology from "../state/railTopology";
import { createRailTree } from "./railTree";
import { itemOf, mountRail, rowOf, settled } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

const tree = () => [
  workstream("outer"),
  workstream("inner", { parent: "outer" }),
  agent("leaf", "idle", "x", { parent: "inner" }),
  door("door", "working", "y", { order: 1 }),
  agent("child", "idle", "z", { parent: "door" }),
];

describe("u520 the Rail's accessibility tree", () => {
  it("u520_tree_semantics_and_names", async () => {
    await mountRail(tree());

    expect(screen.getAllByRole("tree")).toHaveLength(1);
    expect(screen.getByRole("tree").getAttribute("aria-labelledby")).not.toBeNull();

    const levels = Object.fromEntries(["outer", "inner", "leaf", "door", "child"].map((name) => [name, itemOf(name).getAttribute("aria-level")]));

    expect(levels).toEqual({ outer: "2", inner: "3", leaf: "4", door: "2", child: "3" });
    // A fold is a branch's own attribute; a leaf carries none.
    expect(["outer", "inner", "door"].map((name) => itemOf(name).getAttribute("aria-expanded"))).toEqual(["true", "true", "true"]);
    expect(["leaf", "child"].map((name) => itemOf(name).hasAttribute("aria-expanded"))).toEqual([false, false]);

    fireEvent.click(within(rowOf("inner")).getByRole("button", { name: "Collapse" }));
    await settled();

    expect(itemOf("inner").getAttribute("aria-expanded")).toBe("false");

    for (const button of document.querySelectorAll<HTMLElement>(".rail-tree button")) {
      expect(button.getAttribute("title") ?? "").toBe("");
      expect((button.getAttribute("aria-label") ?? button.textContent ?? "").trim()).not.toBe("");
    }
  });

  it("u520_axe_clean", async () => {
    await mountRail(tree());

    const { violations } = await runAxe();

    expect(violations).toEqual([]);
  });
});

it("u5645a_reconciled_structure_updates_once_and_view_changes_do_not_rebuild", async () => {
  const construction = vi.spyOn(topology, "railTopology");
  const { connected, rail, app, setNow } = await mountRail(tree());
  const sourceArray = rail.nodes;
  const inner = rail.nodes.find(node => node.id === "inner");
  // A second projection shares the connected Rail state's canonical topology.
  const initial = construction.mock.calls.length;
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string | null>>(new Set());
  const { projection, dispose } = createRoot(dispose => ({ projection: createRailTree(connected, unfolded, () => undefined), dispose }));
  expect(construction.mock.calls.length).toBe(initial);
  const canonical = projection.topology();

  fireEvent.click(rowOf("leaf"));
  await settled();
  expect(construction.mock.calls.length).toBe(initial);
  rowOf("leaf").focus();
  setNow(NOW + 1);
  setUnfolded(new Set(["inner"]));
  rail.toggleCollapsed("inner");
  rail.setSectionOpen("workstreams", false);
  app.emit(event({ name: "message.sent", data: message(5645, { kind: "question", from: { kind: "agent", id: "outer", parent: null } }) }));
  await settled();
  expect(projection.topology()).toBe(canonical);
  expect(projection.rows().map(row => row.key)).not.toContain("node:leaf");
  expect(projection.expanded()).not.toContain("inner");
  expect(projection.expanded()).not.toContain("section:workstreams");
  expect(construction.mock.calls.length).toBe(initial);

  const refresh = async (nodes: ReturnType<typeof tree>) => {
    const before = construction.mock.calls.length;
    app.handlers["rail.tree"] = () => nodes;
    await rail.refresh();
    expect(rail.nodes).toBe(sourceArray);
    expect(rail.nodes.find(node => node.id === "inner")).toBe(inner);
    // Both projections and selection share one build for the reconciled revision.
    expect(construction.mock.calls.length).toBe(before + 1);
    projection.rows(); projection.collection(); projection.treeRows();
    expect(construction.mock.calls.length).toBe(before + 1);
  };

  rail.toggleCollapsed("inner");
  rail.setSectionOpen("workstreams", true);
  await refresh([...tree(), agent("new", "working", "x", { parent: "outer", order: -1 })]);
  expect(projection.nodeIds().slice(0, 3)).toEqual(["outer", "new", "inner"]);
  await refresh(tree().map(node => node.id === "inner" ? { ...node, parent: "door" } : node));
  expect(projection.nodeIds()).toEqual(["outer", "door", "inner", "leaf", "child"]);
  await refresh(tree().map(node => node.id === "outer" ? { ...node, kind: "agent", mode_prompt: "Saved" } : node));
  expect(projection.sectionRows().map(section => section.id)).toEqual(["workstreams", "modes"]);
  await refresh(tree().map(node => node.id === "child" ? { ...node, order: -1 } : node));
  expect(projection.nodeIds()).toEqual(["outer", "inner", "leaf", "door", "child"]);
  dispose();
  construction.mockRestore();
});

it("u5645c_refresh_preserves_row_identity_selection_and_focus", async () => {
  const { rail, app } = await mountRail(tree());
  fireEvent.click(rowOf("leaf"));
  rowOf("leaf").focus();
  await settled();
  const row = rowOf("leaf");
  const node = rail.nodes.find(node => node.id === "leaf");
  app.handlers["rail.tree"] = () => tree().map(node => node.id === "leaf" ? { ...node, name: "Renamed leaf" } : node);
  await rail.refresh();
  expect(rail.nodes.find(node => node.id === "leaf")).toBe(node);
  expect(rowOf("Renamed leaf")).toBe(row);
  expect(document.activeElement).toBe(row);
  expect(rail.selected()).toBe("leaf");
  app.handlers["todo.list"] = () => [];
  app.emit(event({ name: "todo.deleted", data: { id: 1 } }));
  await settled();
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("data-selected")).toBe("true");
});
