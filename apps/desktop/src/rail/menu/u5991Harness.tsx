import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect } from "vitest";
import { agent, info, mode, workstream } from "../../testing/nodes";
import { copy as windowCopy } from "../../window/copy";
import { createMove } from "../MovePicker";
import { chooseAction, chooseFooter, exitedTerminal, itemOf, mountRail, rowNames, rowOf, settled } from "../railFixture";

/** U5991a: the Rail actions, one row each, shared by the render test and the frame-budget test. */

export const gone = (name: string) => screen.queryByText(name, { selector: ".name" }) === null;

export const removeByKey = (name: string) => {
  fireEvent.click(rowOf(name));
  rowOf(name).focus();
  fireEvent.keyDown(rowOf(name), { key: "Backspace", code: "Backspace", metaKey: true, shiftKey: true });
};

/** One frame after the action: the Rail has drawn and Solid has flushed, while the fake call stays pending. */
export const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve)));

type Mounted = Awaited<ReturnType<typeof mountRail>>;

export type Action = { name: string; mount: () => Promise<Mounted>; method: "rail.remove" | "rail.rename" | "rail.move" | "agent.stop" | "agent.resume" | "agent.spawn" | "agent.createMode" | "rail.createWorkstream" | "rail.group" | "rail.restore" | "rail.redo"; prepare?: (mounted: Mounted) => Promise<void>; fire: (mounted: Mounted) => Promise<void> | void; shown: (mounted: Mounted) => void; call: unknown };

const resumable = (id: string) => agent(id, "done", "done", { can_resume: true });

const menuLabels = (app: Mounted["app"]) => (app.shownMenus.at(-1)?.items ?? []).filter(item => item.enabled).map(item => item.label);

let level: string | null = null;

/** Two Agents whose removal the Daemon answers at once, so an undo or redo has a receipt to act on; `rail.tree` then lacks the removed one. */
const removed = async () => {
  const gone = new Set<string>();
  const mounted = await mountRail([agent("first", "done", "finished", { terminal_id: null, order: 0 }), agent("second", "done", "finished", { terminal_id: null, order: 1 })]);
  const tree = mounted.app.handlers["rail.tree"]!;

  mounted.app.handlers["rail.tree"] = async params => (await tree(params)).filter(node => !gone.has(node.id));

  mounted.app.handlers["rail.remove"] = ({ id, operation }) => {
    gone.add(id);

    // SAFETY: the fake Daemon's receipt carries only the fields the App reads; its `restoration` is opaque to the App.
    return { removed: [], kept: [], deletion: { project: "p", id, operation: operation!, restored: false, restoration: {} } } as never;
  };

  mounted.app.handlers["rail.restore"] = ({ project, operation }) => {
    gone.clear();

    // SAFETY: as above, a fake receipt with the fields the App reads.
    return { removed: [], kept: [], deletion: { project, id: "first", operation, restored: true, restoration: {} } } as never;
  };

  return mounted;
};

/** Removes "first" by its key and waits until the Daemon has answered and the Rail has refreshed without it. */
const removeAndSettle = async (_mounted?: Mounted) => {
  removeByKey("first");
  await waitFor(() => expect(gone("first")).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 50));
};

export const actions: Action[] = [
  {
    name: "remove",
    mount: () => mountRail([agent("first", "done", "finished", { terminal_id: null }), agent("second", "done", "finished", { terminal_id: null })]),
    method: "rail.remove",
    fire: () => removeByKey("first"),
    // The row is gone and its sibling stays.
    shown: () => { expect(gone("first")).toBe(true); expect(rowOf("second")).toBeTruthy(); },
    call: { id: "first", operation: expect.any(String) },
  },
  {
    name: "rename",
    mount: () => mountRail([agent("a", "idle", "ready", { name: "Original" })]),
    method: "rail.rename",
    fire: () => {
      fireEvent.dblClick(screen.getByText("Original"));
      const field = screen.getByLabelText<HTMLInputElement>("Name");
      fireEvent.input(field, { target: { value: "Renamed" } });
      fireEvent.keyDown(field, { key: "Enter" });
    },
    // The name field stays open while its draft is pending (U2773b); the Rail's row data and the field already hold the new name.
    shown: ({ rail }) => { expect(rail.nodes.map(node => node.name)).toEqual(["Renamed"]); expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Renamed"); },
    call: { id: "a", name: "Renamed" },
  },
  {
    name: "move",
    mount: () => mountRail([workstream("Research"), agent("free", "idle", "ready", { terminal_id: null })]),
    method: "rail.move",
    fire: async ({ app }) => {
      level = itemOf("free").getAttribute("aria-level");
      await chooseAction(app, "free", "Move to…");
      fireEvent.click(await screen.findByRole("option", { name: "Research" }));
    },
    // The Agent sits under the Workstream, one level deeper.
    shown: () => expect(Number(itemOf("free").getAttribute("aria-level"))).toBe(Number(level) + 1),
    call: { id: "free", parent: "Research", index: 0 },
  },
  {
    name: "stop",
    mount: () => mountRail([resumable("a")], [info("t-a", { owner: "a" })]),
    method: "agent.stop",
    fire: async ({ app }) => { fireEvent.contextMenu(rowOf("a")); await app.pickMenu("Stop"); },
    // The row now offers Resume, not Stop.
    shown: ({ app }) => { fireEvent.contextMenu(rowOf("a")); expect(menuLabels(app)).toContain("Resume"); expect(menuLabels(app)).not.toContain("Stop"); },
    call: { id: "a" },
  },
  {
    name: "resume",
    mount: () => mountRail([resumable("a")], [exitedTerminal("a", 0)]),
    method: "agent.resume",
    fire: async ({ app }) => { fireEvent.contextMenu(rowOf("a")); await app.pickMenu("Resume"); },
    shown: ({ app }) => { fireEvent.contextMenu(rowOf("a")); expect(menuLabels(app)).toContain("Stop"); expect(menuLabels(app)).not.toContain("Resume"); },
    call: { id: "a" },
  },
  {
    name: "reorder",
    mount: () => mountRail([agent("first", "idle", "ready", { terminal_id: null, order: 0 }), agent("second", "idle", "ready", { terminal_id: null, order: 1 })]),
    method: "rail.move",
    // Rail's drag lands in this function (`moveTo`); a drag needs layout the test document lacks.
    fire: ({ connected }) => { void createMove(connected, () => undefined).move({ id: "second", parent: null, index: 0 }); },
    shown: () => expect(rowNames()).toEqual(["second", "first"]),
    call: { id: "second", parent: null, index: 0 },
  },
  {
    name: "make Workstream",
    mount: () => mountRail([agent("a", "idle", "ready", { terminal_id: null, order: 0 }), agent("c", "idle", "ready", { terminal_id: null, order: 1 })]),
    method: "rail.group",
    fire: async ({ app }) => {
      for (const id of ["a", "c"]) fireEvent.click(rowOf(id), { metaKey: true });
      await settled();
      fireEvent.contextMenu(rowOf("a"));
      await app.pickMenu("Group");
    },
    // Both Agents sit one level under a new Workstream row.
    shown: () => { expect(rowNames()).toContain(windowCopy.newWorkstreamTitle); expect(Number(itemOf("a").getAttribute("aria-level"))).toBe(Number(itemOf(windowCopy.newWorkstreamTitle).getAttribute("aria-level")) + 1); },
    call: { ids: ["a", "c"] },
  },
  {
    name: "new Agent",
    mount: () => mountRail([agent("a", "idle", "ready", { terminal_id: null })]),
    method: "agent.spawn",
    fire: () => chooseFooter("Agent"),
    shown: () => expect(rowNames()).toEqual(["a", windowCopy.newAgent]),
    call: { cwd: "/p", prompt: null, parent: null, model: null, effort: null },
  },
  {
    name: "new Workstream",
    mount: () => mountRail([agent("a", "idle", "ready", { terminal_id: null })]),
    method: "rail.createWorkstream",
    fire: () => chooseFooter("Workstream"),
    shown: () => expect(rowNames()).toHaveLength(2),
    call: { name: expect.any(String), parent: null },
  },
  {
    name: "new Mode",
    mount: () => mountRail([agent("a", "idle", "ready", { terminal_id: null })]),
    method: "agent.createMode",
    fire: async () => {
      await chooseFooter("Mode");
      fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Review" } });
      fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "Look" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
    },
    // The dialog stays modal over the Rail while its call is pending, so the Rail's row data holds the new Mode.
    shown: ({ rail }) => expect(rail.nodes.map(node => node.name)).toContain("Review"),
    call: { name: "Review", prompt: "Look" },
  },
  {
    name: "undo",
    mount: removed,
    method: "rail.restore",
    prepare: removeAndSettle,
    fire: ({ connected }) => { void connected.drafts.undo.undo("rail"); },
    shown: () => { expect(rowOf("first")).toBeTruthy(); expect(rowOf("second")).toBeTruthy(); },
    call: { project: "p", operation: expect.any(String) },
  },
  {
    name: "redo",
    mount: removed,
    method: "rail.redo",
    prepare: async ({ connected }) => { await removeAndSettle(); await connected.drafts.undo.undo("rail"); },
    fire: ({ connected }) => { void connected.drafts.undo.redo("rail"); },
    shown: () => { expect(gone("first")).toBe(true); expect(rowOf("second")).toBeTruthy(); },
    call: { project: "p", operation: expect.any(String), source: expect.any(String), restoration: expect.anything() },
  },
];
