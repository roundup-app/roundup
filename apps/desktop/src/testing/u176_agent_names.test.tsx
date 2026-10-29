// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { draftStorage } from "../state/storage";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import { menuProbe } from "./menuProbe";
import type { StartedDaemon } from "./realDaemonFixture";

describe("u176 Agent names", () => {
  let real: StartedDaemon;

  beforeEach(async () => {
    // E10: the Agent's Claude is the pinned one, its model aimock serving this file's turns.
    real = await startRealDaemon({}, false, undefined, resolve(process.cwd(), "src/testing/fixtures/u176_agent_names.json"));
  }, 120_000);

  afterEach(async () => {
    cleanup();
    await real?.stop();
  });

  it("u176_two_agents_added_to_one_workstream_are_told_apart_in_the_rail", async () => {
    const app: AppSeam = createServedApp(real.base);

    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);

    const rail = await screen.findByRole("region", { name: "Rail" });
    const agents = async () => (await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent");

    fireEvent.click((await screen.findAllByRole("button", { name: /^(New Workstream|Add Workstream)$/ }))[0]!);

    for (const count of [1, 2]) {
      await waitFor(() => expect(within(rail).getByRole("button", { name: "Add Workstream" }).getAttribute("aria-disabled")).not.toBe("true"));
      const home = (await app.rpc("rail.tree", null)).find(node => node.kind === "workstream")!;
      fireEvent.contextMenu(await within(rail).findByText(home.name, { selector: ".rail-row .name" }));
      await waitFor(() => expect(menuProbe.shown?.find(item => item.id === "add")?.children?.some(item => item.id === "add-agent" && item.enabled)).toBe(true));
      menuProbe.answer!("add-agent");
      await waitFor(async () => expect(await agents()).toHaveLength(count), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.status?.label).not.toBe("starting"), { timeout: 30_000 });
      await waitFor(async () => expect(await app.rpc("agent.prompt", { id: (await agents())[count - 1]!.id, text: "what should this do" })).toBeNull(), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.name).not.toBe("new-agent"), { timeout: 60_000 });
    }

    const nodes = await agents();
    const names = nodes.map((node) => node.name);

    expect(new Set(names).size).toBe(2);
    await waitFor(() => {
      for (const name of names) expect(within(rail).getAllByText(name).length).toBeGreaterThan(0);
    });

    await real.model!.assertMatched();
  }, 180_000);

});

// Reuse both Project authorities across the Rail probes; each probe still creates fresh objects.
let first: StartedDaemon;

let second: StartedDaemon;

beforeAll(async () => {
  first = await startRealDaemon({});
  second = await startRealDaemon({});
}, 180_000);

afterAll(async () => {
  await first?.stop();
  await second?.stop();
});

// The public Daemon owns identities and mutations; only reply timing is controlled here.
describe("u2773 Rail task destinations", () => {
  let app: AppSeam;
  let left: AppSeam;
  let right: AppSeam;
  let home: string;
  let other: string;

  beforeEach(async () => {
    localStorage.clear();
    left = createServedApp(first.base);
    right = createServedApp(second.base);

    // Keep real Project authorities, but give each probe fresh objects and no prior Agents.
    for (const source of [left, right]) {
      for (const node of await source.rpc("rail.tree", null)) {
        if (node.kind === "workstream" && node.parent === null) await source.rpc("rail.remove", { id: node.id, scope: "all" });
      }
    }

    home = (await left.rpc("rail.createWorkstream", { name: "same", parent: null })).id;
    await right.rpc("rail.createWorkstream", { name: "padding", parent: null });
    other = (await right.rpc("rail.createWorkstream", { name: "same", parent: null })).id;
    app = {
      ...left,
      projects: async () => [{ name: "Left", path: first.dir, running: true }, { name: "Right", path: second.dir, running: true }],
      forProject: (path) => path === first.dir ? left : right,
      openProject: async (path) => ({ name: path === first.dir ? "Left" : "Right", path }),
    };
  }, 120_000);

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

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

  const task = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

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
    const sibling = await left.rpc("agent.spawn", { cwd: first.dir, parent: home, name: "same", prompt: null });
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
    await left.rpc("rail.rename", { id: home, name: "incoming" });
    await right.rpc("rail.rename", { id: other, name: "incoming" });
    await screen.findByText("incoming", { selector: ".rail .name" });
    replays.forEach((replay) => { replay(); replay(); });
    expect(document.activeElement).toBe(focused);
    expect(task().value).toBe(" right\n別 😀 ");
    fireEvent.keyDown(task(), { key: "Escape" });
    await switchTo("Left");
    await openTask();
    expect(task().value).toBe(" left\ne\u0301 😀 ");
    expect([task().selectionStart, task().selectionEnd, task().selectionDirection]).toEqual([2, 7, "backward"]);
    expect(home).not.toBe(other);

    for (const spy of [calls, rightCalls]) expect(spy.mock.calls.filter(([method]) => ["agent.spawn", "message.send"].includes(method))).toEqual([]);
    submit();
    await waitFor(async () => expect((await left.rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(2));
    expect(calls.mock.calls.find(([method]) => method === "agent.spawn")?.[1]).toMatchObject({ parent: home, prompt: "left\ne\u0301 😀" });
    expect((await right.rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(0);
  }, 120_000);

  it("u2773c_rail_external_change_keeps_original_removed_parent", async () => {
    await mount(); await select(home); await openTask(); type(" exact removed\n😀 ");
    await left.rpc("rail.remove", { id: home });
    await waitFor(() => expect(document.querySelector(`[data-id="${home}"]`)).toBeNull());
    const replacement = await left.rpc("rail.createWorkstream", { name: "same", parent: null });
    await waitFor(() => expect(document.querySelector(`[data-id="${replacement.id}"] .name`)).not.toBeNull());
    const calls = vi.spyOn(left, "rpc");
    submit();
    expect(screen.getByRole("alert").textContent).toContain("unavailable");
    expect(task().value).toBe(" exact removed\n😀 ");
    expect(replacement.id).not.toBe(home);
    expect(calls.mock.calls.filter(([method]) => method === "agent.spawn" || method === "message.send")).toEqual([]);
    expect((await left.rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(0);
  }, 120_000);
});

// Rail continuity probes share the audited real-Daemon launch site.
describe("u2773 Rail persisted edits", () => {
  beforeEach(async () => {
    localStorage.clear();

    // Reuse authorities, not prior probe objects or the acknowledged root Agent.
    for (const real of [first, second]) {
      const app = createServedApp(real.base);

      for (const node of await app.rpc("rail.tree", null)) {
        if (node.parent === null) await app.rpc("rail.remove", { id: node.id, scope: node.kind === "workstream" ? "all" : null });
      }
    }
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("u2773c_rail_real_external_rename_and_removal_keep_original_edit", async () => {
    const app = createServedApp(first.base);
    const node = await app.rpc("rail.createWorkstream", { name: "Original target", parent: null });
    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    fireEvent.dblClick(await screen.findByText("Original target", { selector: ".rail-row .name" }));
    const name = screen.getByLabelText<HTMLInputElement>("Name");
    fireEvent.input(name, { target: { value: " exact e\u0301 😀 " } });
    await app.rpc("rail.rename", { id: node.id, name: "Changed elsewhere" });
    expect((await screen.findByRole("alert")).tabIndex).toBe(-1);
    expect(name.value).toBe(" exact e\u0301 😀 ");
    fireEvent.keyDown(name, { key: "Enter" });
    expect((await app.rpc("rail.tree", null)).find((entry) => entry.id === node.id)?.name).toBe("Changed elsewhere");
    await app.rpc("rail.remove", { id: node.id });
    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    expect(screen.getAllByLabelText<HTMLTextAreaElement>("Recovered rail draft").map((field) => field.value)).toContain(" exact e\u0301 😀 ");
    expect(draftStorage(first.dir).list().find((entry) => entry.value.text === " exact e\u0301 😀 ")?.destination.object).toBe(node.id);
    expect(document.body.textContent).toContain("unavailable");
  }, 120_000);

  it("u2773a_rail_real_names_keep_original_project_and_object_on_reopen", async () => {
    const one = first;
    const two = second;

    try {
      const records = [];

      for (const [index, real] of [one, two].entries()) {
        const app = createServedApp(real.base);

        if (index === 1) await app.rpc("rail.createWorkstream", { name: "Spacer", parent: null });
        const target = await app.rpc("rail.createWorkstream", { name: "Same name", parent: null });
        render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
        fireEvent.dblClick(await screen.findByText("Same name", { selector: ".rail-row .name" }));
        fireEvent.input(screen.getByLabelText("Name"), { target: { value: ` exact ${index} e\u0301 😀 ` } });
        records.push({ app, target, text: ` exact ${index} e\u0301 😀 ` });
        cleanup();
      }

      expect(records[0]!.target.id).not.toBe(records[1]!.target.id);

      for (const { app, target, text } of records) {
        const renames: string[] = [];
        const rpc = app.rpc;
        app.rpc = (method, params) => {
          if (method === "rail.rename") renames.push(JSON.stringify(params));

          return rpc(method, params);
        };

        render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
        fireEvent.dblClick(await screen.findByText("Same name", { selector: ".rail-row .name" }));
        const field = screen.getByLabelText<HTMLInputElement>("Name");
        expect(field.value).toBe(text);
        expect(renames).toEqual([]);
        fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
        await waitFor(() => expect(field.isConnected).toBe(false));
        expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe(text.trim());
        expect(renames).toEqual([JSON.stringify({ id: target.id, name: text.trim() })]);
        cleanup();
      }
    } finally {
      cleanup();
    }
  }, 120_000);
});
