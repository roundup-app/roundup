import { App } from "../App";
import { RpcError } from "../app/seam";
import type { AppSeam } from "../app/seam";
import type { Order } from "@contracts/agent/Order";
import { fakeEmulators } from "../terminal/paneHarness";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asking, card, gate, mountApp, select } from "../decisions/decisionsFixture";
import { runChecks } from "../testing/checks";
import { agent, door } from "../testing/nodes";

const long = "Change no file in the repo ".repeat(12).trim();

const work = { kind: "work" as const, ask: long, limits: [] };

const meetsD2 = () => {
  // the test container and portal roots are outside the app's stylesheet and hold no text of their own
  for (const root of document.body.children) root.setAttribute("style", "font-size: var(--text-body)");

  const checks = runChecks();
  expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
};

describe("Q2, Q3: generated text is laid out as hold:Plain asks", () => {
  it("q2_order_drawer", async () => {
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() =>
      expect(document.querySelector(".order-line")).not.toBeNull(),
    );
    fireEvent.click(document.querySelector(".order-line")!);
    const drawer = await screen.findByLabelText("Full order of alpha");
    expect(drawer.textContent).toContain(long);
  });

  it("q3_decision_card_meets_d2_d5", async () => {
    await mountApp([asking("d1", "a", "Which folder should I use?", ["src", "docs"])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    // D5 needs painted layout: src/testing/u197_column.test.ts::q3_decision_card_meets_d2_d5_on_painted_layout.
    meetsD2();
  });

  it.each([1280])("q3_the_surfaces_wrap_and_meet_d2_d5 at %i", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
    fireEvent.click(document.querySelector(".order-line")!);
    await screen.findByLabelText("Full order of alpha");

    // the test container and portal roots are outside the app's stylesheet and hold no text of their own
    for (const root of document.body.children) root.setAttribute("style", "font-size: var(--text-body)");

    // D5 needs painted layout: src/testing/u197_column.test.ts::q3_long_drawer_wraps_and_meets_d2_d5_on_painted_layout.
    const checks = runChecks();
    expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
  });
});

const full: Order = {
  kind: "work",
  title: "Give a Drawer tour",
  ask: "Give a tour of the Drawer",
  done: "The tour is written",
  limits: ["Change no file", "Keep it short", "Ask before deleting", "Use no network"],
};

describe("U2773 Order forms on real Projects", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  let first: StartedDaemon;
  let second: StartedDaemon;
  beforeAll(async () => {
    first = await startRealDaemon({});
    second = await startRealDaemon({});
  }, 240_000);
  afterAll(async () => { await first?.stop(); await second?.stop(); });
  const mount = (app: AppSeam) => render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);

  const open = async (id: string) => {
    await waitFor(() => expect(document.querySelector(`[data-id="${id}"]`)?.textContent).toContain("same name"));
    fireEvent.click(document.querySelector(`[data-id="${id}"]`)!);
    await waitFor(() => expect(document.querySelector(".order-line, .order-overview [aria-label='Edit order']")).not.toBeNull());
    const line = document.querySelector(".order-line");

    if (line) fireEvent.click(line);
    fireEvent.click(await screen.findByRole("button", { name: "Edit order" }));

    return screen.getByLabelText<HTMLTextAreaElement>("Ask");
  };

  it("u2773a_orders_restores_exact_work_across_projects_and_reload", async () => {
    const one = createServedApp(first.base);
    const two = createServedApp(second.base);

    await two.rpc("rail.createWorkstream", { name: "different original", parent: null });

    const originals = await Promise.all([one, two].map((app, index) =>
      app.rpc("agent.spawn", { cwd: index ? second.dir : first.dir, name: "same name", parent: null, prompt: null, order: full })));

    expect(originals[0]!.id).not.toBe(originals[1]!.id);
    const paths = [first.dir, second.dir];

    const app: AppSeam = { ...one,
      projects: async () => paths.map((path, index) => ({ name: index ? "second" : "first", path, running: true })),
      forProject: (path) => path === first.dir ? one : two,
    };

    const calls = [vi.spyOn(one, "rpc"), vi.spyOn(two, "rpc")];
    mount(app);
    const values = ["  Project one 👋\né  ", "  Project two 🧭\nother  "];

    for (let index = 0; index < 2; index++) {
      fireEvent.click(await screen.findByRole("tab", { name: index ? "second" : "first" }));
      const ask = await open(originals[index]!.id);
      fireEvent.input(screen.getByLabelText("Title"), { target: { value: `  title ${index}  ` } });
      fireEvent.input(screen.getByLabelText("Done when"), { target: { value: `  done ${index}\n` } });
      fireEvent.input(ask, { target: { value: values[index] } });
      ask.focus();
      ask.setSelectionRange(2, 8, "backward");
      fireEvent.select(ask);
    }

    cleanup();
    mount(app);

    for (let index = 0; index < 2; index++) {
      fireEvent.click(await screen.findByRole("tab", { name: index ? "second" : "first" }));
      const ask = await open(originals[index]!.id);
      expect([ask.value, ask.selectionStart, ask.selectionEnd, ask.selectionDirection]).toEqual([values[index], 2, 8, "backward"]);
      expect(["Title", "Done when"].map((label) => screen.getByLabelText<HTMLTextAreaElement>(label).value))
        .toEqual([`  title ${index}  `, `  done ${index}\n`]);
    }

    expect(calls.flatMap((spy) => spy.mock.calls.filter(([method]) => method === "agent.setOrder" || method === "agent.prompt" || method === "terminal.write"))).toEqual([]);
    vi.restoreAllMocks();
  }, 120_000);

  it("u2773c_orders_external_change_keeps_original", async () => {
    const app = createServedApp(first.base);
    const original = await app.rpc("agent.spawn", { cwd: first.dir, name: "same name", parent: null, prompt: null, order: full });
    const writes = vi.spyOn(app, "rpc");
    mount(app);
    const ask = await open(original.id);
    fireEvent.input(ask, { target: { value: "  my exact edit é\n" } });
    ask.focus();
    const external: Order = { kind: "work", ask: "another Actor's order", limits: ["external limit"] };
    await app.rpc("agent.setOrder", { id: original.id, order: external });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("changed"));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  my exact edit é\n");
    expect(document.activeElement).toBe(ask);
    writes.mockClear();
    fireEvent.submit(ask.closest("form")!);
    expect(writes.mock.calls.filter(([method]) => method === "agent.setOrder")).toEqual([]);
    const tree = await app.rpc("rail.tree", null);
    expect(tree.find((node) => node.id === original.id)?.work).toEqual(external);
    vi.restoreAllMocks();
  }, 60_000);
  it("u2773b_orders_acknowledgement_reaches_original_once", async () => {
    const app = createServedApp(first.base);
    const original = await app.rpc("agent.spawn", { cwd: first.dir, name: "same name", parent: null, prompt: null, order: full });
    const calls = vi.spyOn(app, "rpc");
    mount(app);
    const ask = await open(original.id);
    fireEvent.input(ask, { target: { value: "  submitted order 👋\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
    expect(calls.mock.calls.filter(([method]) => method === "agent.setOrder")).toEqual([["agent.setOrder", {
      id: original.id, order: { ...full, ask: "submitted order 👋" }, captured: { order: full },
    }]]);
    expect((await app.rpc("rail.tree", null)).find((node) => node.id === original.id)?.work).toEqual({ ...full, ask: "submitted order 👋" });
    expect(screen.queryByRole("button", { name: "Recover unfinished work" })).toBeNull();
    vi.restoreAllMocks();
  }, 60_000);

  it("u2773c_orders_removed_original_keeps_form_in_project_recovery", async () => {
    const app = createServedApp(first.base);
    const original = await app.rpc("agent.spawn", { cwd: first.dir, name: "same name", parent: null, prompt: null, order: full });
    const calls = vi.spyOn(app, "rpc");
    mount(app);
    const ask = await open(original.id);
    fireEvent.input(ask, { target: { value: "  unavailable original 🧭\n" } });
    await app.rpc("agent.stop", { id: original.id });
    await app.rpc("rail.remove", { id: original.id });
    fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByLabelText("Unfinished work");
    expect(recovery.textContent).toContain("  unavailable original 🧭\n");
    expect(recovery.textContent).toContain(original.id);
    await waitFor(() => expect(recovery.querySelector("[data-state=unavailable]")).not.toBeNull());
    calls.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
    expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(0);
    expect(calls.mock.calls.filter(([method]) => method === "agent.setOrder" || method === "agent.spawn")).toEqual([]);
    vi.restoreAllMocks();
  }, 60_000);

  it("u2773b_orders_late_failure_stays_in_original_project", async () => {
    const one = createServedApp(first.base);
    const two = createServedApp(second.base);
    const original = await one.rpc("agent.spawn", { cwd: first.dir, name: "same name", parent: null, prompt: null, order: full });
    const reply = gate<never>();
    let sends = 0;

    const bound: AppSeam = { ...one, rpc: (method, params) => {
      if (method === "agent.setOrder") { sends++;

 return reply.promise; }

      return one.rpc(method, params);
    } };

    const app: AppSeam = { ...one,
      projects: async () => [{ name: "first", path: first.dir, running: true }, { name: "second", path: second.dir, running: true }],
      forProject: (path) => path === first.dir ? bound : two,
    };

    mount(app);
    fireEvent.click(await screen.findByRole("tab", { name: "first" }));
    const ask = await open(original.id);
    fireEvent.input(ask, { target: { value: "  failed original A 🧭\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.input(ask, { target: { value: "  newer original B é\n" } });
    fireEvent.click(screen.getByRole("tab", { name: "second" }));
    await waitFor(() => expect(screen.queryByLabelText("Done when")).toBeNull());
    reply.reject(new RpcError(-32003, "original Project refused"));
    fireEvent.click(screen.getByRole("tab", { name: "first" }));
    fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByLabelText("Unfinished work");
    await waitFor(() => expect(recovery.textContent).toContain("Failed"));
    expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(2);
    expect(recovery.textContent).toContain("  newer original B é\n");
    expect(recovery.textContent).toContain(original.id);
    expect(sends).toBe(1);
    expect((await one.rpc("rail.tree", null)).find((node) => node.id === original.id)?.work).toEqual(full);
  }, 60_000);

  it("u2773a_orders_project_reopen_keeps_memory_after_retention_failure", async () => {
    let served = createServedApp(first.base);
    let calls = vi.spyOn(served, "rpc");
    const original = await served.rpc("agent.spawn", { cwd: first.dir, name: "same name", parent: null, prompt: null, order: full });

    const app: AppSeam = { ...served,
      projects: async () => [{ name: "first", path: first.dir, running: true }],
      forProject: () => served,
      closeProject: async () => { first.daemon.kill(); },
      chooseProjectPath: async () => first.dir,
      openProject: async () => {
        await first.restart();
        served = createServedApp(first.base);
        calls = vi.spyOn(served, "rpc");

        return { name: "first", path: first.dir };
      },
    };

    mount(app);
    const ask = await open(original.id);
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
    fireEvent.input(ask, { target: { value: "  memory through closed Project é 🧭\n" } });
    await screen.findByRole("alert");
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "first" }).closest(".project-tab")!);
    fireEvent.click(screen.getByRole("button", { name: "Close first" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop and close" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "first" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "first" });
    const restored = await open(original.id);
    expect(restored.value).toBe("  memory through closed Project é 🧭\n");
    writes.mockRestore();
    calls.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(calls.mock.calls.filter(([method]) => method === "agent.setOrder" || method === "agent.spawn" || method === "terminal.write")).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    vi.restoreAllMocks();
  }, 90_000);

});
