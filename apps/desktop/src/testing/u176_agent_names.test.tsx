// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { App } from "../App";
import { RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

import { Rail } from "../rail/Rail";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";

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
      const add = await within(rail).findByLabelText("Add Agent", {}, { timeout: 30_000 });

      await waitFor(() => expect(add.matches('[aria-disabled="true"]')).toBe(false), { timeout: 30_000 });
      fireEvent.click(add);
      await waitFor(async () => expect(await agents()).toHaveLength(count), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.status?.label).not.toBe("starting"), { timeout: 30_000 });
      await waitFor(async () => expect(await app.rpc("agent.prompt", { id: (await agents())[count - 1]!.id, text: "what should this do" })).toBeNull(), { timeout: 30_000 });
      await waitFor(async () => expect((await agents())[count - 1]!.name).not.toBe("new-agent"), { timeout: 60_000 });

      // Only the second Agent keeps a pending Decision; the first one's is allowed.
      if (count === 1) {
        const first = (await agents())[0]!.id;

        await waitFor(async () => {
          for (const decision of await app.rpc("decision.list", null)) if (decision.agent === first) await app.rpc("decision.answer", { id: decision.id, answer: "allow", proof: await app.daemonProof() });
          expect((await app.rpc("decision.list", null)).filter((decision) => decision.agent === first)).toHaveLength(0);
        }, { timeout: 60_000 });
      }
    }

    const nodes = await agents();
    const names = nodes.map((node) => node.name);

    expect(new Set(names).size).toBe(2);
    await waitFor(() => {
      for (const name of names) expect(within(rail).getAllByText(name).length).toBeGreaterThan(0);
    });

    const second = nodes[1]!;

    await waitFor(async () => expect((await app.rpc("decision.list", null)).map((decision) => decision.agent)).toContain(second.id), { timeout: 60_000 });
    fireEvent.click(rail.querySelector(`[data-id="${second.id}"] .name`) ?? rail);
    expect(await screen.findByRole("region", { name: `Decision for ${second.name}` }, { timeout: 30_000 })).toBeTruthy();
    await real.model!.assertMatched();
  }, 180_000);

});

describe("u2773 retained Rail names", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("u2773a_rail_real_projects_keep_name_destinations_on_reopen", async () => {
    const first = await startRealDaemon({});
    const second = await startRealDaemon({});

    try {
      const sources = [first, second];
      const records = [];

      for (const [index, real] of sources.entries()) {
        const app = createServedApp(real.base);

        if (index === 1) await app.rpc("rail.createWorkstream", { name: "other", parent: null });
        const target = await app.rpc("rail.createWorkstream", { name: "same", parent: null });
        const mounted = await connectProject(app, { name: "same", path: real.dir }, () => false, Date.now, () => null);

        render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
        fireEvent.dblClick(await screen.findByText("same"));
        fireEvent.input(screen.getByLabelText("Name"), { target: { value: ` exact ${index}\u0301 😀 ` } });
        records.push({ real, app, target, text: ` exact ${index}\u0301 😀 ` });
        cleanup();
      }

      expect(records[0]!.target.id).not.toBe(records[1]!.target.id);

      for (const { real, app, target, text } of records) {
        const calls = vi.spyOn(app, "rpc");
        const mounted = await connectProject(app, { name: "same", path: real.dir }, () => false, Date.now, () => null);

        render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
        fireEvent.dblClick(await screen.findByText("same"));
        expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(text);
        expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([]);
        fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
        await waitFor(async () => expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe(text.trim()));
        expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([["rail.rename", { id: target.id, name: text.trim() }]]);
        cleanup();
      }
    } finally {
      cleanup();
      await first.stop();
      await second.stop();
    }
  }, 120_000);

  it("u2773c_rail_real_external_name_change_refuses_overwrite", async () => {
    const real = await startRealDaemon({});

    try {
      const app = createServedApp(real.base);
      const target = await app.rpc("rail.createWorkstream", { name: "original", parent: null });
      const mounted = await connectProject(app, { name: "project", path: real.dir }, () => false, Date.now, () => null);

      render(() => <ConnectedProjectContext.Provider value={mounted}><Rail /></ConnectedProjectContext.Provider>);
      fireEvent.dblClick(await screen.findByText("original"));
      fireEvent.input(screen.getByLabelText("Name"), { target: { value: " exact dirty name 😀 " } });
      await app.rpc("rail.rename", { id: target.id, name: "external" });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("original name changed"));
      const calls = vi.spyOn(app, "rpc");

      fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(" exact dirty name 😀 ");
      expect(calls.mock.calls.filter(([method]) => method === "rail.rename")).toEqual([]);
      expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe("external");
    } finally {
      cleanup();
      await real.stop();
    }
  }, 120_000);

});

// The public Daemon owns identities and mutations; only reply timing is controlled here.
describe("u2773 Rail task destinations", () => {
  let first: StartedDaemon;
  let second: StartedDaemon;
  let app: AppSeam;
  let left: AppSeam;
  let right: AppSeam;
  let home: string;
  let other: string;

  beforeEach(async () => {
    localStorage.clear();
    first = await startRealDaemon({});
    second = await startRealDaemon({});
    left = createServedApp(first.base);
    right = createServedApp(second.base);
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

  afterEach(async () => {
    cleanup();
    await first?.stop();
    await second?.stop();
    localStorage.clear();
  });

  const mount = async () => {
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findByRole("region", { name: "Rail" });
    await switchTo("Left");
  };

  const switchTo = async (name: string) => {
    fireEvent.click(screen.getByRole("tab", { name }));
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

  it.each(["acknowledged", "failed", "unknown"] as const)("u2773b_rail_settlement_preserves_other_revisions_late_%s", async (outcome) => {
    const rpc = left.rpc.bind(left);
    const replies: (() => Promise<void>)[] = [];

    const spy = vi.spyOn(left, "rpc").mockImplementation(<M extends RpcMethodName>(method: M, params: RpcMethods[M]["params"]): Promise<RpcMethods[M]["result"]> => {
      if (method !== "agent.spawn") return rpc(method, params);

      return new Promise<RpcMethods[M]["result"]>((resolve, reject) => {
        replies.push(async () => {
          if (outcome === "failed") reject(new RpcError(-32003, "refused"));
          else {
            const result = await rpc(method, params);

            if (outcome === "unknown") reject(new RpcError(-32603, "reply lost"));
            else resolve(result);
          }
        });
      });
    });

    await mount();
    await select(home);
    await openTask(); type("A"); submit(); type("B");
    fireEvent.keyDown(task(), { key: "Escape" });
    await switchTo("Right");
    await switchTo("Left");
    await openTask(); submit(); type("C");
    expect(replies).toHaveLength(2);
    fireEvent.keyDown(task(), { key: "Escape" });
    await switchTo("Right");
    await openTask(); type("right work");
    await replies[1]!();
    await replies[0]!();
    await waitFor(() => expect(task().value).toBe("right work"));
    await switchTo("Left");
    await openTask();
    expect(task().value).toBe("C");
    await waitFor(() => expect(screen.queryAllByLabelText("Retained rail input")).toHaveLength(outcome === "acknowledged" ? 0 : 2));
    expect((await rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(outcome === "failed" ? 0 : 2);

    if (outcome !== "acknowledged") {
      expect(screen.getAllByLabelText<HTMLTextAreaElement>("Retained rail input").map((field) => [field.value, field.parentElement?.dataset.state])).toEqual([["A", outcome], ["B", outcome]]);
      fireEvent.click(screen.getAllByRole("button", { name: "Discard this revision" })[0]!);
    }

    cleanup(); await mount(); await openTask();
    expect(task().value).toBe("C");
    expect(screen.queryAllByLabelText<HTMLTextAreaElement>("Retained rail input").map((field) => field.value)).toEqual(outcome === "acknowledged" ? [] : ["B"]);
    expect(spy.mock.calls.filter(([method]) => method === "agent.spawn")).toHaveLength(2);
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

it("u2773a_rail_restores_exact_work_in_real_harness_reload_and_project_reopen", async () => {
  const first = await startRealDaemon({}, true);
  const second = await startRealDaemon({}, true);
  const lane = await openLane(1512, "dark", "u2773-rail");

  try {
    for (const [index, real] of [first, second].entries()) {
      const app = createServedApp(real.base);

      if (index) await app.rpc("rail.createWorkstream", { name: "padding", parent: null });
      const target = await app.rpc("rail.createWorkstream", { name: "same", parent: null });
      const text = ` exact ${index}\ne\u0301 😀 `;
      const url = `${real.base}/harness.html?daemon=1`;
      const field = 'document.querySelector("textarea[aria-label=Task]")';
      const open = `document.dispatchEvent(new KeyboardEvent('keydown', {key:'n',metaKey:true,shiftKey:true,bubbles:true}))`;
      await lane.browser("open", url);
      await lane.until(`!!document.querySelector('[data-id="${target.id}"] .name')`);
      await lane.browser("click", `[data-id="${target.id}"] .name`);
      await lane.evaluate(open);
      await lane.until(`!!${field}`);
      await lane.evaluate(`(() => { const field = ${field}; field.value = ${JSON.stringify(text)}; field.dispatchEvent(new Event('input',{bubbles:true})); field.setSelectionRange(2,7,'backward'); field.dispatchEvent(new Event('select',{bubbles:true})); return true; })()`);
      await lane.browser("press", "Escape");

      for (const action of ["reload", "reopen"] as const) {
        if (action === "reload") await lane.browser("reload");
        else {
          await lane.browser("open", "about:blank");
          await real.restart();
          await lane.browser("open", url);
        }

        await lane.until(`!!document.querySelector('[data-id="${target.id}"] .name')`);
        await lane.evaluate(open);
        await lane.until(`!!${field}`);
        expect(await lane.evaluate(`(() => { const f = ${field}; return [f.value,f.selectionStart,f.selectionEnd,f.selectionDirection]; })()`)).toEqual([text, 2, 7, "backward"]);
        expect((await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(0);
        await lane.browser("press", "Escape");
      }

      // D2/D5/D6 observer on the real surface with a retention failure visible.
      await lane.evaluate(`(() => { Storage.prototype.setItem = () => { throw new Error('disk full'); }; return true; })()`);
      await lane.evaluate(open);
      await lane.until(`!!${field}`);
      await lane.evaluate(`(() => { const f = ${field}; f.value += ' newer'; f.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
      await lane.until(`!!document.querySelector('.rail-recovery [role=alert]')`);
      await lane.capture("u2773-rail", `real-${index}-retention-failure`);
    }

    await lane.seedTodos(["first", "second", "third"]);
    await lane.evaluate(`(() => { Storage.prototype.setItem = () => { throw new Error('disk full'); }; document.dispatchEvent(new KeyboardEvent('keydown', {key:'n',metaKey:true,shiftKey:true,bubbles:true})); return true; })()`);
    await lane.until('!!document.querySelector("textarea[aria-label=Task]")');
    await lane.evaluate(`(() => { const f = document.querySelector('textarea[aria-label=Task]'); f.value = ' exact dense\\né 😀 '; f.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await lane.until(`!!document.querySelector('.rail-recovery [role=alert]')`);
    await lane.capture("u2773-rail", "tree-40-retention-failure");
  } finally {
    await lane.close();
    await first.stop();
    await second.stop();
  }
}, 240_000);
