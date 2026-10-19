import { App } from "../App";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gate, mountApp, select } from "../decisions/decisionsFixture";
import { RpcError } from "../app/seam";
import type { Kind } from "@contracts/Kind";
import type { Order } from "@contracts/agent/Order";
import { agent, clarifying, door } from "../testing/nodes";

beforeEach(() => window.localStorage.clear());

afterEach(() => vi.restoreAllMocks());

const limits = ["Change no file", "Keep it short", "Ask before deleting", "Use no network"];

const prompt = `## Details\n\n${"Walk through each part of the screenshot. ".repeat(60)}\n\n- **bold** item`;

const KINDS: Kind[] = ["error", "needs-you", "blocked", "working", "idle", "done"];

export const openDrawer = async (
  order: Order,
  options: { kind?: Kind; handlers?: Record<string, (params: never) => object | null> } = {},
) => {
  await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", options.kind ?? "working", "editing", { name: "alpha", order: 0, work: order }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt });
    Object.assign(app.handlers, options.handlers ?? {});
  });
  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return await screen.findByLabelText("Full order of alpha");
};

const full: Order = {
  kind: "work",
  title: "Give a Drawer tour",
  ask: "Give a tour of the Drawer",
  done: "The tour is written",
  limits,
};

describe("O15: the Drawer shows a title, the done line and the folded prompt", () => {
  it("o15_the_title_leads_and_the_ask_follows", async () => {
    const drawer = await openDrawer(full);
    const title = drawer.querySelector(".order-title")!;
    const ask = drawer.querySelector(".order-ask")!;
    expect(title.textContent).toContain("Give a Drawer tour");
    expect(ask.textContent).toContain("Give a tour of the Drawer");
  });

  it("o15_an_order_without_a_title_shows_its_ask", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-title")!.textContent).toContain("Give a tour");
    expect(drawer.querySelector(".order-ask")).toBeNull();
  });

  it("o15_the_done_mark_follows_the_agent_kind", async () => {
    for (const kind of KINDS) {
      const drawer = await openDrawer(full, { kind });
      const line = drawer.querySelector<HTMLElement>(".order-done-line")!;
      expect(line.textContent).toContain("The tour is written");

      expect(line.dataset.done, kind).toBe(String(kind === "done"));
      expect(line.querySelector("[role=img]")!.getAttribute("aria-label")).toBe(kind === "done" ? "Done" : "Not done");
      document.body.innerHTML = "";
    }
  });

  it("o15_no_done_no_line", async () => {
    const drawer = await openDrawer({ kind: "work", ask: "Give a tour", limits: [] });
    expect(drawer.querySelector(".order-done-line")).toBeNull();
  });

  it("o15_no_limits_part_is_drawn", async () => {
    const drawer = await openDrawer(full);
    
    for (const limit of limits) expect(drawer.textContent).not.toContain(limit);
    expect(drawer.textContent?.toLowerCase()).not.toContain("limits");
  });

  it("o15_no_list_is_drawn", async () => {
    const drawer = await openDrawer(full);
    await waitFor(() => expect(drawer.querySelector("summary")).not.toBeNull());
    expect(drawer.querySelector(":not(.order-prompt-body) > ul, h3")).toBeNull();
  });
});

describe("O16: the user edits the order in the Drawer", () => {
  const edit = async (order: Order, setOrder: (params: never) => object | null) => {
    const drawer = await openDrawer(order, { handlers: { "agent.setOrder": setOrder } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));

    return drawer;
  };

  const field = (name: string) => document.querySelector<HTMLInputElement>(`[name=${name}]`)!;

  it("o16_edit_opens_fields_with_the_current_text", async () => {
    await edit(full, () => ({}));
    expect(field("title").value).toBe("Give a Drawer tour");
    expect(field("ask").value).toBe("Give a tour of the Drawer");
    expect(field("done").value).toBe("The tour is written");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("o16_save_sends_set_order_with_the_limits_unchanged", async () => {
    const sent: object[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "Tour the Drawer" } });
    fireEvent.input(field("ask"), { target: { value: "Tour it" } });
    fireEvent.input(field("done"), { target: { value: "It is toured" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
    expect(sent).toEqual([
      { id: "a", order: { kind: "work", title: "Tour the Drawer", ask: "Tour it", done: "It is toured", limits }, captured: { order: full } },
    ]);
  });

  it("o16_a_blank_title_or_done_is_sent_absent", async () => {
    const sent: { order: Order }[] = [];
    await edit(full, (params) => (sent.push(params), {}));
    fireEvent.input(field("title"), { target: { value: "   " } });
    fireEvent.input(field("done"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect("title" in sent[0]!.order).toBe(false);
    expect("done" in sent[0]!.order).toBe(false);
  });

  it("o16_a_rejected_save_keeps_the_input_and_shows_the_error", async () => {
    await edit(full, () => {
      throw new Error("order title is over 6 words");
    });
    fireEvent.input(field("title"), { target: { value: "one two three four five six seven" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("order title is over 6 words"));
    expect(field("title").value).toBe("one two three four five six seven");
    expect(screen.getByRole("img", { name: "Error" })).toBeTruthy();
  });

  it("o16_a_clarification_order_has_no_edit_button", async () => {
    await openDrawer(clarifying("which?"));
    expect(screen.queryByRole("button", { name: "Edit order" })).toBeNull();
  });
});

it("u2773a_orders_restores_exact_work_after_escape", async () => {
  const sent: object[] = [];
  await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return {}; } } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const field = screen.getByLabelText<HTMLTextAreaElement>("Ask");
  const exact = "  draft\ncombining é 👋  \n";
  fireEvent.input(field, { target: { value: exact } });
  field.focus();
  field.setSelectionRange(3, 9, "backward");
  fireEvent.select(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(document.querySelector(".order-edit")).toBeNull();
  expect(document.querySelector(".order-title")?.textContent).toContain("Give a Drawer tour");
  expect(sent).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const restored = screen.getByLabelText<HTMLTextAreaElement>("Ask");
  expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([exact, 3, 9, "backward"]);
});

for (const outcome of ["acknowledged", "failed", "unknown"] as const) {
  it(`u2773b_orders_settlement_preserves_other_revisions_${outcome}`, async () => {
    const reply = gate<object>();
    const sent: object[] = [];
    await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return reply.promise; } } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
    const ask = screen.getByLabelText<HTMLTextAreaElement>("Ask");
    fireEvent.input(ask, { target: { value: "  older A 👋\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.input(ask, { target: { value: "  newer B é\n" } });

    if (outcome === "acknowledged") reply.resolve({});
    else reply.reject(outcome === "failed" ? new RpcError(-32003, "refused") : new RpcError(-32603, "disconnected"));

    if (outcome === "acknowledged") await reply.promise;
    else await screen.findByRole("alert");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  newer B é\n");
    expect(sent).toEqual([{ id: "a", order: { kind: "work", title: full.title, ask: "older A 👋", done: full.done, limits }, captured: { order: full } }]);
    cleanup();
    await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sent.push(params);

 return {}; } } });
    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  newer B é\n");
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByLabelText("Unfinished work");
    await waitFor(() => expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(outcome === "acknowledged" ? 1 : 2));
    expect(recovery.textContent).toContain("  newer B é\n");

    if (outcome !== "acknowledged") {
      const inspect = recovery.querySelectorAll<HTMLButtonElement>("li button");
      fireEvent.click(inspect[1]!);
      expect(recovery.textContent).toContain("  older A 👋\n");
      expect(recovery.textContent).toContain(outcome === "failed" ? "Failed" : "Acceptance unknown");
      fireEvent.click(screen.getByRole("button", { name: "Discard this revision" }));
      expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(1);
      expect(recovery.textContent).toContain("  newer B é\n");
    }

    expect(sent).toHaveLength(1);
  });
}

it("u2773b_orders_out_of_order_acknowledgement_keeps_late_failure", async () => {
  const older = gate<object>();
  const newer = gate<object>();
  let calls = 0;
  await openDrawer(full, { handlers: { "agent.setOrder": () => (++calls === 1 ? older.promise : newer.promise) } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "old failed revision" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "new acknowledged revision" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  newer.resolve({});
  await waitFor(() => expect(document.querySelector(".order-edit")).toBeNull());
  older.reject(new RpcError(-32003, "older refused"));
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
  const recovery = await screen.findByLabelText("Unfinished work");
  await waitFor(() => expect(recovery.textContent).toContain("Failed"));
  expect(recovery.querySelectorAll("li[data-revision]")).toHaveLength(1);
  expect(recovery.textContent).toContain("old failed revision");
  expect(recovery.textContent).not.toContain("new acknowledged revision");
  expect(calls).toBe(2);
});

it("u2773e_recovery_actions_keep_surface_draft_orders", async () => {
  const sends: object[] = [];
  await openDrawer(full, { handlers: { "agent.setOrder": (params) => { sends.push(params);

 return {}; } } });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
  fireEvent.input(screen.getByLabelText("Title"), { target: { value: "  unsaved title 👋  " } });
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: "  unsaved ask\n" } });
  fireEvent.input(screen.getByLabelText("Done when"), { target: { value: "  unsaved done é  " } });
  expect(screen.getByRole("alert").textContent).toContain("/p");
  expect(screen.getByRole("alert").textContent).toContain("reload");
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("Ask"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  expect(["Title", "Ask", "Done when"].map((label) => screen.getByLabelText<HTMLTextAreaElement>(label).value))
    .toEqual(["  unsaved title 👋  ", "  unsaved ask\n", "  unsaved done é  "]);
  expect(sends).toEqual([]);
});

describe("U2773 Order forms on real Projects", () => {
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
    const calls = vi.spyOn(app, "rpc");
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
