import { copy as recoveryCopy } from "../sharedCopy";
import { copy as railCopy } from "../rail/copy";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { draftStorage } from "../state/storage";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { agent, workstream, event } from "./nodes";
import type { RailNode } from "@contracts/agent/RailNode";
import { menuProbe } from "./menuProbe";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("u176_two_agents_added_to_one_workstream_are_told_apart_in_the_rail", async () => {
  const app = createFakeApp();
  app.add("/project", "Project");
  const home = workstream("home");
  const tree = [home];
  app.handlers["rail.tree"] = () => tree;
  app.handlers["agent.spawn"] = () => agent(`child-${tree.length}`, "idle", "ready", { parent: home.id });
  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  const rail = await screen.findByRole("region", { name: "Rail" });

  for (const [index, name] of ["what-should-this", "what-should-this-2"].entries()) {
    await waitFor(() => expect(within(rail).getByRole("button", { name: "Add Workstream" }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.contextMenu(await within(rail).findByText(home.name, { selector: ".rail-row .name" }));
    await waitFor(() => expect(menuProbe.shown?.find(item => item.id === "add")?.children?.some(item => item.id === "add-agent" && item.enabled)).toBe(true));
    menuProbe.answer!("add-agent");
    await waitFor(() => expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(index + 1));
    // Production naming is proved by agents::u176_agents_with_one_prompt_are_numbered_among_their_siblings.
    // Here the Daemon supplies names; the App must show each on its own row.
    tree.push(agent(`child-${index + 1}`, "idle", "ready", { parent: home.id, name }));
    app.emit(event({ name: "rail.changed" }));
    await within(rail).findByText(name, { selector: `.rail-row[data-id="child-${index + 1}"] .name` });
  }

  expect(app.calls.filter(call => call.method === "agent.spawn").map(call => call.params)).toEqual([
    expect.objectContaining({ parent: home.id }), expect.objectContaining({ parent: home.id }),
  ]);
}, 180_000);

// Incoming trees are supplied facts; the mounted App owns draft identity and submission.
describe("u2773 Rail task destinations", () => {
  let app: ReturnType<typeof createFakeApp>;
  let left: AppSeam;
  let right: AppSeam;
  let tree: RailNode[];
  let otherTree: RailNode[];
  let home: string;
  let other: string;

  beforeEach(async () => {
    localStorage.clear();
    const fake = createFakeApp();
    fake.add("/left", "Left");
    fake.add("/right", "Right");
    const leftApp = fake.of("/left");
    const rightApp = fake.of("/right");
    home = "left-home";
    other = "right-home";
    tree = [workstream(home, { name: "same" })];
    otherTree = [workstream(other, { name: "same" })];
    leftApp.handlers["rail.tree"] = () => tree;
    rightApp.handlers["rail.tree"] = () => otherTree;
    leftApp.handlers["agent.spawn"] = () => agent("accepted", "idle", "ready", { parent: home });
    left = leftApp;
    right = rightApp;
    app = fake;
  }, 120_000);

  const mount = async () => {
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findByRole("region", { name: "Rail" });
    await switchTo("Left");
  };

  const switchTo = async (name: string) => {
    fireEvent.click(await screen.findByRole("tab", { name }));
    await waitFor(() => expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true"));
    await screen.findByRole("region", { name: "Rail" });
  };

  const task = () => screen.getByLabelText<HTMLTextAreaElement>("Work");

  const openTask = async () => {
    await screen.findByRole("button", { name: "Add Workstream" });
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(task()));
  };

  const type = (text: string) => fireEvent.input(task(), { target: { value: text } });
  const submit = () => fireEvent.keyDown(task(), { key: "Enter" });

  const select = async (id: string) => {
    await waitFor(() => expect(document.querySelector(`[data-id="${id}"] .name`)).not.toBeNull());
    fireEvent.click(document.querySelector(`[data-id="${id}"] .name`)!);
  };

  it("u2773a_rail_restores_exact_work_on_project_agent_switch_and_events", async () => {
    const sibling = agent("sibling", "idle", "ready", { parent: home, name: "same" });
    tree.push(sibling);
    const replays: (() => void)[] = [];

    for (const source of [left, right]) {
      const subscribe = source.subscribe.bind(source);
      let replay = () => {};

      vi.spyOn(source, "subscribe").mockImplementation((receive) => subscribe((event) => {
        replay = () => receive(event);
        receive(event);
      }));
      replays.push(() => replay());
    }

    const calls = vi.spyOn(left, "rpc");
    const rightCalls = vi.spyOn(right, "rpc");
    await mount();
    await select(home);
    await openTask();
    type(" left\ne\u0301 😀 ");
    task().setSelectionRange(2, 7, "backward");
    fireEvent.select(task());
    fireEvent.keyDown(task(), { key: "Escape" });
    await select(sibling.id);
    await openTask();
    expect(task().value).toBe(" left\ne\u0301 😀 ");
    expect([task().selectionStart, task().selectionEnd, task().selectionDirection]).toEqual([2, 7, "backward"]);
    fireEvent.keyDown(task(), { key: "Escape" });
    await switchTo("Right");
    await select(other);
    await openTask();
    expect(task().value).toBe("");
    type(" right\n別 😀 ");
    const focused = document.activeElement;
    tree[0] = { ...tree[0]!, name: "incoming" };
    otherTree[0] = { ...otherTree[0]!, name: "incoming" };
    // Replay the same supplied incoming facts through each subscribed Project.
    app.of("/left").emit(event({ name: "rail.changed" }));
    app.of("/right").emit(event({ name: "rail.changed" }));
    await screen.findByText("incoming", { selector: ".rail .name" });
    replays.forEach((replay) => { replay(); replay(); });
    expect(document.activeElement).toBe(focused);
    expect(task().value).toBe(" right\n別 😀 ");
    fireEvent.keyDown(task(), { key: "Escape" });
    await switchTo("Left");
    await openTask();
    expect(task().value).toBe(" left\ne\u0301 😀 ");
    expect([task().selectionStart, task().selectionEnd, task().selectionDirection]).toEqual([2, 7, "backward"]);

    for (const spy of [calls, rightCalls]) expect(spy.mock.calls.filter(([method]) => ["agent.spawn", "message.send"].includes(method))).toEqual([]);
    submit();
    await waitFor(() => expect(calls.mock.calls.filter(([method]) => method === "agent.spawn")).toHaveLength(1));
    expect(calls.mock.calls.find(([method]) => method === "agent.spawn")?.[1]).toMatchObject({ parent: home, prompt: "left\ne\u0301 😀" });
    expect(rightCalls.mock.calls.filter(([method]) => ["agent.spawn", "message.send"].includes(method))).toEqual([]);
  }, 120_000);

  it("u2773c_rail_external_change_keeps_original_removed_parent", async () => {
    await mount(); await select(home); await openTask(); type(" exact removed\n😀 ");
    tree = [];
    app.of("/left").emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(document.querySelector(`[data-id="${home}"]`)).toBeNull());
    const replacement = workstream("replacement", { name: "same" });
    tree = [replacement];
    app.of("/left").emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(document.querySelector(`[data-id="${replacement.id}"] .name`)).not.toBeNull());
    const calls = vi.spyOn(left, "rpc");
    submit();
    expect(screen.getByRole("alert").textContent).toContain(railCopy.railDraftUnavailable);
    expect(task().value).toBe(" exact removed\n😀 ");
    expect(calls.mock.calls.filter(([method]) => method === "agent.spawn" || method === "message.send")).toEqual([]);
  }, 120_000);
});

describe("u2773 Rail persisted edits", () => {
  it("u2773c_rail_external_rename_and_removal_keep_original_edit", async () => {
    const app = createFakeApp();
    app.add("/project", "Project");
    const node = workstream("original", { name: "Original target" });
    let tree = [node];
    app.handlers["rail.tree"] = () => tree;
    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.dblClick(await screen.findByText("Original target", { selector: ".rail-row .name" }));
    const name = screen.getByLabelText<HTMLInputElement>("Name");
    fireEvent.input(name, { target: { value: " exact e\u0301 😀 " } });
    tree = [{ ...node, name: "Changed elsewhere" }];
    app.emit(event({ name: "rail.changed" }));
    expect((await screen.findByRole("alert")).tabIndex).toBe(-1);
    const conflicted = screen.getByLabelText<HTMLInputElement>("Name", { selector: "input" });
    expect(conflicted.value).toBe(" exact e\u0301 😀 ");
    fireEvent.keyDown(conflicted, { key: "Enter" });
    // A refused save emits no acknowledgement; observe that no asynchronous rename starts.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(app.calls.filter(call => call.method === "rail.rename")).toEqual([]);
    tree = [];
    app.emit(event({ name: "rail.changed" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: recoveryCopy.draftField("name") })).toBeNull());
    expect(screen.getByText(railCopy.railDraftUnavailable)).toBeDefined();
    fireEvent.keyDown(screen.getByLabelText(recoveryCopy.unfinishedWork), { key: "Enter" });
    expect(screen.getAllByLabelText<HTMLTextAreaElement>(recoveryCopy.unfinishedWork).map((field) => field.value)).toContain(" exact e\u0301 😀 ");
    expect(draftStorage("/project").list().find((entry) => entry.value.text === " exact e\u0301 😀 ")).toMatchObject({
      destination: { object: node.id }, value: { text: " exact e\u0301 😀 ", base: "Original target" },
    });
    expect(app.calls.filter(call => call.method === "rail.rename")).toEqual([]);
  }, 120_000);
});
