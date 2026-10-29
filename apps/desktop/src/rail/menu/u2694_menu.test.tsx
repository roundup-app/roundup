import { copy } from "../../copy";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTodos, todo } from "../../todos/testHarness";
import { RpcError } from "../../app/seam";
import { agent, door, event, workstream, USER, info } from "../../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf } from "../railFixture";

import { openShelf, padOf } from "../../pads/padsFixture";
import { mountBubbles } from "../../bubbles/bubblesFixture";
import { mountAskBar } from "../../ask/askFixture";
import { mountApp, rpcCalls, select } from "../../testing/appFixture";
import { openTabs, tab } from "../../header/stripFixture";
import { openLane } from "../../todos/laneBrowser";

afterEach(cleanup);

const open = (name: string) => fireEvent.contextMenu(rowOf(name), { clientX: 120, clientY: 80 });

const entry = (app: { shownMenus: { items: { label: string; enabled: boolean; children?: { id: string; label: string; enabled: boolean }[] }[] }[] }, label: string) =>
  app.shownMenus.at(-1)!.items.find((item) => item.label === label)!;

describe("u2694 the Rail's system menu", () => {
  it("u2694b_the_menu_shows_rename_and_remove_shortcuts", async () => {
    const { app } = await mountRail([door("w", "idle", "idle"), agent("a", "working", "busy")]);

    open("w");
    expect(app.menuLabels()).toEqual([copy.workProgress, copy.startYolo, copy.stop, copy.openFolder, copy.openInEditor, copy.sendToAgentMenu, copy.copyLink, copy.rename, copy.openingPromptMenu, copy.addMenu, copy.remove]);
    expect(entry(app, copy.rename)).toMatchObject({ shortcut: "F2" });
    expect(entry(app, copy.remove)).toMatchObject({ shortcut: "⌘⌫" });

    open("a");
    expect(app.menuLabels()).toEqual([copy.workProgress, copy.startYolo, copy.stop, copy.openFolder, copy.openInEditor, copy.sendToAgentMenu, copy.copyLink, copy.rename, copy.remove]);
  });

  it("u2694b_stopping_a_door_calls_agent_stop", async () => {
    const { app } = await mountRail([door("w", "idle", "ready")]);
    app.handlers["agent.stop"] = () => null;

    open("w");
    await app.pickMenu(copy.stop);

    expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "w" }]);
    expect(railCallsTo(app, "terminal.kill")).toEqual([]);
  });

  it("u2694b_a_group_offers_remove_only", async () => {
    const { app } = await mountRail([workstream("g")]);

    open("g");

    expect(app.menuLabels()).toEqual([copy.startDoor, copy.openFolder, copy.openInEditor, copy.openingPromptMenu, copy.addMenu, copy.remove]);

  });

  it.each([
    [copy.restart, true, "normal"],
    [copy.startYolo, false, "yolo"],
  ] as const)("u2694d_%s_resumes_in_the_requested_mode", async (action, yolo, mode) => {
    const { app } = await mountRail([agent("a", "working", "busy", { yolo })]);
    app.handlers["agent.resume"] = () => {
      const resumed = agent("a", "working", "busy", { yolo: !yolo });
      app.handlers["rail.tree"] = () => [resumed];

      return resumed;
    };

    open("a");
    await app.pickMenu(action);
    open("a");

    expect(app.menuLabels()).not.toContain(action);
    expect(railCallsTo(app, "agent.resume")).toEqual([{ id: "a", mode }]);
  });

  it.each([
    ["stopped", false, false, false, [copy.startYolo]],
    ["running", true, false, true, [copy.startYolo, copy.stop]],
    ["yolo", true, true, false, [copy.restart, copy.stop]],
    ["stopped-yolo", false, true, false, []],
    ["resumable", false, false, true, [copy.startYolo, copy.resume]],
  ] as const)("u3812_a_row_menu_lists_only_the_actions_its_state_allows_%s", async (_state, running, yolo, can_resume, actions) => {
    const { app } = await mountRail([door("w", running ? "idle" : "done", "ready", { yolo, can_resume })], running ? [] : [exitedTerminal("w", 0)]);

    open("w");

    expect(app.menuLabels()).toEqual([copy.workProgress, ...(!running ? [copy.startDoor] : []), ...actions, copy.openFolder, copy.openInEditor, copy.copyLink, copy.rename, copy.openingPromptMenu, copy.addMenu, copy.remove]);
  });

  it("u4322a_inapplicable_actions_are_absent", async () => {
    const { app } = await mountRail([door("w", "done", "stopped", { yolo: true })], [exitedTerminal("w", 0)]);

    open("w");

    const items = app.shownMenus.at(-1)!.items;
    expect(items.some(item => item.id === "send")).toBe(false);
    expect(items.every(item => item.enabled)).toBe(true);
  });

  it("u2694d_a_failed_resume_shows_the_failure_line", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    const failure = new RpcError(-32003, "already running");

    app.handlers["agent.resume"] = () => { throw failure; };

    open("a");
    await app.pickMenu(copy.startYolo);

    await waitFor(() => expect(document.body.textContent).toContain(failure.message));
  });

  it("u4322b_native_choice_dispatches_once", async () => {
    const { app } = await mountRail([workstream("w1"), agent("a", "working", "busy", { parent: "w1" }), workstream("w2", { order: 1 }), agent("c", "working", "busy", { parent: "w2" }), agent("x", "done", "done")], [exitedTerminal("x", 0)]);
    app.handlers["daemon.ping"] = () => ({ pong: true, pid: 1, project: "/p", projectKey: "p-1", contract: { fingerprint: "", methods: [] } });
    // SAFETY: the Message of the answer is never read by the menu.
    app.handlers["message.send"] = () => ({}) as never;

    open("a");
    await app.pickMenu(copy.sendToAgentMenu);
    expect(railCallsTo(app, "message.send")).toEqual([]);
    await app.closeMenu();
    open("a");
    await app.pickMenu("c");

    await waitFor(() => expect(railCallsTo(app, "message.send")).toEqual([
      { to: "c", kind: "note", body: "roundup://agent/a?project=p-1\nrup link read roundup://agent/a?project=p-1", replyTo: null },
    ]));
    expect(app.calls.filter(call => ["terminal.write", "agent.spawn", "agent.resume", "rail.startDoor"].includes(call.method))).toEqual([]);
  });

  it("u2694c_copy_link_writes_the_link", async () => {
    const { app } = await mountRail([agent("a", "working", "busy")]);
    const write = vi.fn(async () => {});
    vi.spyOn(app, "clipboardWrite").mockImplementation(write);
    app.handlers["daemon.ping"] = () => ({ pong: true, pid: 1, project: "/p", projectKey: "p-1", contract: { fingerprint: "", methods: [] } });

    open("a");
    await app.pickMenu(copy.copyLink);

    await waitFor(() => expect(write).toHaveBeenCalledWith("roundup://agent/a?project=p-1"));
  });

  it("u2694a_choosing_an_item_runs_its_action_and_null_runs_nothing", async () => {
    const { app } = await mountRail([agent("a", "idle", "idle")]);
    app.handlers["agent.stop"] = () => null;

    open("a");
    await app.closeMenu();
    expect(railCallsTo(app, "agent.stop")).toEqual([]);
    open("a");
    await app.pickMenu(copy.stop);

    await waitFor(() => expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "a" }]));
  });
});

it("u3515a_send_offers_other_project_receivers_in_rail_order", async () => {
  const foreign = await mountRail([agent("foreign", "idle", "ready")], [], undefined, () => true, {}, [], { name: "B", path: "/b" });

  const { app, rail } = await mountRail([
    door("w1", "idle", "ready"),
    agent("a", "idle", "ready", { parent: "w1" }),
    agent("b", "idle", "ready", { parent: "w1", order: 1 }),
    door("w2", "idle", "ready", { order: 1 }),
    agent("c", "idle", "ready", { parent: "w2" }),
    agent("root", "idle", "ready", { order: 2 }),
  ], [], undefined, () => true, {}, [], { name: "A", path: "/a" });

  rail.select("b");
  rail.toggleCollapsed("w2");
  fireEvent.contextMenu(document.querySelector('.rail-row[data-id="a"]')!, { clientX: 120, clientY: 80 });
  expect(entry(app, copy.sendToAgentMenu).children?.map(child => child.label)).toEqual(["w1", "b", "w2", "c", "root"]);
  expect(foreign.app.shownMenus).toEqual([]);
});


it("u3515a_source_identity_follows_the_object_not_selection", async () => {
  for (const kind of ["shell", "run", "publication"]) {
    if (kind === "publication") {
      const { app } = await mountAskBar([], null, [agent("a", "idle", "ready")]);
      app.handlers["deliverable.list"] = () => [{
        id: "publication", project: "p", maker: { kind: "agent", id: "a", parent: null }, maker_name: "a", home: null,
        title: "Result", published_at: 1792713600000,
        target: { kind: "external", url: "https://example.com/result", availability: "not-checked" },
      }];
      window.dispatchEvent(new Event("focus"));
      const made = await screen.findByRole("region", { name: copy.deliverables });
      fireEvent.contextMenu(await within(made).findByRole("listitem"));
      expect(entry(app, copy.sendToAgentMenu).children?.map(child => child.id)).toEqual(["send:a"]);
      await app.closeMenu();
    } else {
      const tree = kind === "shell" ? [workstream("w"), agent("a", "idle", "ready", { parent: "w" })] : [agent("a", "idle", "ready")];
      const { app } = await mountBubbles(kind === "shell" ? "w" : "a", [info(kind, { owner: kind === "shell" ? "w" : "a" })], tree);
      fireEvent.contextMenu(await waitFor(() => document.querySelector(".terminal-tab-pair") ?? Promise.reject(new Error("No Terminal tab"))));
      expect(entry(app, copy.sendToAgentMenu).children?.map(child => child.id)).toEqual(["send:a"]);
      await app.closeMenu();
    }

    cleanup(); window.localStorage.clear();
  }
});

it("u3515d_exhausted_targets_preserve_picker_policy_and_native_omission", async () => {
  // Each row mounts the real caller. Creation alternatives remain changing actions.
  const actionCalls = (app: { calls: { method: string }[] }) => app.calls.filter(call => ["message.send", "terminal.write", "agent.spawn", "agent.resume", "rail.startDoor", "todo.move", "todo.assign", "todo.setBlockers", "todo.reorder", "rail.move", "pad.setOwner"].includes(call.method));

  const cases: { name: string; run: () => Promise<void> }[] = [
    ...([["agent", false], ["agent", true], ["door", false], ["door", true]] as const).map(([kind, exited]) => ({ name: `${kind} link: only source is eligible${exited ? "; peer exited" : ""}`, run: async () => {
      const { app } = await mountRail([kind === "agent" ? agent("a", "idle", "ready") : door("a", "idle", "ready"), ...(exited ? [agent("x", "done", "ended", { order: 1 })] : [])], exited ? [exitedTerminal("x", 0)] : []);
      open("a");
      expect(app.menuLabels()).not.toContain(copy.sendToAgentMenu);
      await app.closeMenu();
      expect(actionCalls(app)).toEqual([]);
    } })),
    { name: "Rail reparent keys: only itself at the current root", run: async () => {
      const { app } = await mountRail([workstream("w")]);
      const source = within(rowOf("w")).getByRole("button", { name: "Move w" });

      // jsdom lacks these platform APIs; without them the DnD keyboard sensor throws before lifting.
      const animations = Object.getOwnPropertyDescriptor(document, "getAnimations");
      const elementAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");

      document.getAnimations = () => [];
      Element.prototype.getAnimations = () => [];
      vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
      vi.stubGlobal("IntersectionObserver", class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });

      try {
        source.focus();
        fireEvent.keyDown(source, { key: " ", code: "Space" });
        await waitFor(() => expect(document.querySelector('[data-dnd-placeholder]')).not.toBeNull());
        fireEvent.keyDown(source, { key: "ArrowRight", code: "ArrowRight" });
        fireEvent.keyDown(source, { key: " ", code: "Space" });
        await waitFor(() => expect(document.querySelector('[data-dnd-placeholder]')).toBeNull());
        expect(actionCalls(app)).toEqual([]);
      } finally {
        cleanup();

        if (animations) Object.defineProperty(document, "getAnimations", animations);
        else Reflect.deleteProperty(document, "getAnimations");

        if (elementAnimations) Object.defineProperty(Element.prototype, "getAnimations", elementAnimations);
        else Reflect.deleteProperty(Element.prototype, "getAnimations");
        vi.unstubAllGlobals();
      }
    } },
    { name: "Terminal tab: no eligible receiver", run: async () => {
      const { app } = await mountBubbles(null, [info("shell", { owner: "/p" })], []);
      const tab = await waitFor(() => document.querySelector(".terminal-tab-pair") ?? Promise.reject(new Error("No Terminal tab")));
      fireEvent.contextMenu(tab);
      expect(app.menuLabels()).not.toContain(copy.sendToAgentMenu);
      await app.closeMenu();
      expect(actionCalls(app)).toEqual([]);
    } },
    { name: "Published output: no eligible receiver", run: async () => {
      const { app } = await mountAskBar([], null, []);
      app.handlers["deliverable.list"] = () => [{
        id: "publication", project: "p", maker: USER, maker_name: "Me", home: null,
        title: "Result", published_at: 1792713600000,
        target: { kind: "external", url: "https://example.com/result", availability: "not-checked" },
      }];
      window.dispatchEvent(new Event("focus"));
      const made = await screen.findByRole("region", { name: copy.deliverables });
      fireEvent.contextMenu(await within(made).findByRole("listitem"));
      expect(app.menuLabels()).not.toContain(copy.sendToAgentMenu);
      await app.closeMenu();
      expect(actionCalls(app)).toEqual([]);
    } },
    { name: "Todo and Pad owner drags: the current owner is never a drop target", run: async () => {
      // The pointer-only owner destinations use U3515d's isolated rendered App observer.
      const lane = await openLane(1512, "dark", "u3515-owner-guard");

      try {
        await lane.seedTodos(["one"], false);
        await lane.evaluate(`(async () => {
          const app = window.__fake.app;
          const todo = (await app.rpc('todo.list', null))[0];
          await app.rpc('todo.assign', { id: todo.id, owner: { kind: 'user', id: 'you', parent: null } });
          const pad = (await app.rpc('pad.list', null))[0];
          const pads = await app.rpc('pad.list', null);
          app.handlers['pad.list'] = () => pads.filter(item => item.name === pad.name);
          app.handlers['rail.tree'] = () => [];
          app.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'rail.changed' });
          app.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'pad.changed', data: { name: pad.name } });
          return true;
        })()`);

        for (const [tab, row] of [["todos", ".todo-row-button"], ["pads", ".sortable-handle"]]) {
          await lane.evaluate(`(() => { const tab = document.querySelector('#shelf-tab-${tab}'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()`);
          const group = tab === "pads" ? "unassigned" : "me";
          await lane.until(`!!document.querySelector('.shelf [data-shelf-group="${group}"] ${row}')`);
          await lane.evaluate(`(() => { const group = document.querySelector('.shelf [data-shelf-group="${group}"]'); if (group.getAttribute('aria-expanded') === 'false') group.querySelector('[data-part="branch-control"]').click(); return true; })()`);

          const points = await lane.evaluate<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`(() => {
            const point = element => { const box = element.getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }; };
            return { from: point(document.querySelector('.shelf ${row}').closest('[data-shelf-row]').querySelector('.sortable-handle')), to: point(document.querySelector('.shelf [data-shelf-group="${group}"] .shelf-group-head')) };
          })()`);

          await lane.resetCalls();
          await lane.browser("mouse", "move", String(points.from.x), String(points.from.y));
          await lane.browser("mouse", "down");
          await lane.browser("mouse", "move", String(points.from.x + 6), String(points.from.y - 6));
          await lane.until("!!document.querySelector('[data-dnd-placeholder]')");
          await lane.browser("mouse", "move", String(points.to.x), String(points.to.y));
          expect(await lane.evaluate<boolean>(`!document.querySelector('.shelf [data-shelf-group="${group}"][data-drop-target]')`)).toBe(true);
          await lane.browser("mouse", "up");
          await lane.until("!document.querySelector('[data-dnd-placeholder]')");
          expect((await lane.calls()).filter(call => ["todo.assign", "todo.reorder", "pad.setOwner", "pad.reorder"].includes(call.method))).toEqual([]);
        }
      } finally { await lane.close(); }
    } },
    { name: "blocker: only the Todo itself", run: async () => {
      const { app } = await mountTodos([todo(1)]);
      fireEvent.keyDown(await screen.findByRole("button", { name: /Idle #1 / }), { key: "Enter" });
      const trigger = await within(await screen.findByRole("complementary", { name: copy.drawer })).findByRole<HTMLButtonElement>("button", { name: /Blocker/ });
      expect(trigger.disabled).toBe(false);
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
      expect(trigger.title).not.toBe("");
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      for (const key of ["Enter", " ", "ArrowDown", "ArrowUp"]) fireEvent.keyDown(trigger, { key });
      fireEvent.click(trigger);
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(actionCalls(app)).toEqual([]);
    } },
    { name: "Shared Pads offer no assignment", run: async () => {
      const { app, connected } = await openShelf([padOf("mine", USER)]);
      app.handlers["rail.tree"] = () => [];
      await connected.rail.refresh();
      const me = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]');

      if (me?.closest('[data-shelf-group]')?.querySelector('[data-part="branch-content"]')?.hasAttribute("hidden")) fireEvent.click(me);
      screen.getByRole("button", { name: "mine" }).focus();
      const button = screen.getByRole("button", { name: "mine" });
      fireEvent.contextMenu(button);
      expect(app.menuLabels()).not.toContain(copy.assign);
      await app.closeMenu();
      expect(actionCalls(app)).toEqual([]);
      fireEvent.contextMenu(button);
      expect(app.menuLabels()).not.toContain(copy.sendToAgentMenu);
      await app.closeMenu();
      button.focus();
      fireEvent.keyDown(button, { key: "o", code: "KeyO" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(actionCalls(app)).toEqual([]);
    } },
    { name: "Todo Home and nesting keys: root and itself only; assignment keeps New Workstream", run: async () => {
      // U3787c reserves matching prefixes; this fixture exercises T's unmatched triage command.
      const { app, connected } = await mountTodos([todo(1, { owner: USER, title: "review" })]);
      app.handlers["rail.tree"] = () => [];
      await connected.rail.refresh();
      const me = document.querySelector<HTMLElement>('[data-shelf-group="unassigned"] [data-part="branch-control"]');

      if (me?.closest('[data-shelf-group]')?.querySelector('[data-part="branch-content"]')?.hasAttribute("hidden")) fireEvent.click(me);
      const button = await screen.findByRole("button", { name: /Idle #1 / });
      fireEvent.contextMenu(button);
      expect(app.menuLabels()).not.toContain(copy.sendToAgentMenu);
      await app.closeMenu();
      button.focus();
      fireEvent.keyDown(button, { key: "Tab" });
      fireEvent.keyDown(button, { key: "Tab", shiftKey: true });
      fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
      fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
      fireEvent.keyDown(button, { key: "Escape", code: "Escape" });
      fireEvent.keyDown(button, { key: "t", code: "KeyT" });
      await waitFor(() => expect(document.querySelector("[data-triage=on]")).not.toBeNull());
      fireEvent.keyDown(button, { key: "w", code: "KeyW" });
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.keyDown(button, { key: "a", code: "KeyA" });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getAllByRole("menuitem").map(item => item.getAttribute("data-value"))).not.toContain("me");
      expect(within(menu).getByRole("menuitem", { name: copy.newWorkstreamOffer }).getAttribute("aria-disabled")).not.toBe("true");
      expect(actionCalls(app)).toEqual([]);
    } },
  ];

  for (const each of cases) {
    try { await each.run(); }
    catch (error) { throw new Error(each.name, { cause: error }); }
    finally { cleanup(); window.localStorage.clear(); }
  }
}, 60_000);


it.each([
  {
    name: "Workstream row",
    expected: [["progress", "0"], ["yolo", "2"], ["stop", "2"], ["folder", "4"], ["editor", "4"], ["send", "4"], ["copy-link", "4"], ["rename", "5"], ["opening-prompt", "5"], ["add", "6"], ["remove", "7"]],
    receivers: ["a"],
    mount: async () => {
      const { app } = await mountRail([door("w", "idle", "ready"), agent("a", "idle", "ready")]);

      return { app, target: rowOf("w") };
    },
  },
  {
    name: "Agent row",
    expected: [["progress", "0"], ["yolo", "2"], ["stop", "2"], ["folder", "4"], ["editor", "4"], ["send", "4"], ["copy-link", "4"], ["rename", "5"], ["remove", "7"]],
    receivers: ["b"],
    mount: async () => {
      const { app } = await mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready", { order: 1 })]);

      return { app, target: rowOf("a") };
    },
  },
  {
    name: "Queued Workstream row",
    expected: [["start-now", "1"], ["dequeue", "1"], ["move-up", "1"], ["move-down", "1"], ["folder", "4"], ["editor", "4"], ["opening-prompt", "5"], ["add", "6"], ["remove", "7"]],
    receivers: [],
    mount: async () => {
      const { app, connected } = await mountRail([workstream("first"), workstream("middle", { order: 1 }), workstream("last", { order: 2 })]);
      app.handlers["workstream.queue"] = () => ({ running: 1, cap: 1, entries: ["first", "middle", "last"].map(workstream => ({ workstream, start: { kind: "queued" as const } })) });
      await connected.queue.refresh();

      return { app, target: rowOf("middle") };
    },
  },
  {
    name: "Project tab",
    expected: [["copy", "4"], ["rename", "5"], ["close", "7"]],
    receivers: [],
    mount: async () => {
      const { app } = await openTabs({ api: [agent("a", "idle", "ready")] });

      return { app, target: tab("api") };
    },
  },
  {
    name: "Terminal tab",
    expected: [["send", "4"], ["copy-link", "4"], ["rename", "5"], ["close", "7"]],
    receivers: ["a"],
    mount: async () => {
      const { app, container } = await mountBubbles("w", [info("shell", { owner: "w" })], [workstream("w"), agent("a", "idle", "ready", { parent: "w" })]);

      return { app, target: container.querySelector(".terminal-tab-pair")! };
    },
  },
  {
    name: "Terminal Bubble bar",
    expected: [["send", "4"], ["copy-link", "4"], ["rename", "5"], ["close", "7"]],
    receivers: ["a"],
    mount: async () => {
      const { app } = await mountBubbles("w", [info("shell", { owner: "w" })], [workstream("w"), agent("a", "idle", "ready", { parent: "w" })]);

      return { app, target: document.querySelector(".bubble:not([hidden]) .bubble-header")! };
    },
  },
  {
    name: "Work-item Pad",
    expected: [["open", "0"], ["send", "4"], ["copy-link", "4"], ["rename", "5"], ["assign", "5"], ["make-yours", "5"], ["delete", "7"]],
    receivers: ["a", "b"],
    mount: async () => {
      const { app, connected } = await openShelf([padOf("notes", { kind: "agent", id: "a", parent: null })]);
      app.handlers["rail.tree"] = () => [agent("a", "idle", "ready"), agent("b", "idle", "ready", { order: 1 })];
      await connected.rail.refresh();
      const disclosure = document.querySelector<HTMLElement>('[data-shelf-group="a"] [data-part="branch-control"]');

      if (disclosure?.getAttribute("aria-expanded") === "false") fireEvent.click(disclosure);

      return { app, target: (await screen.findByText("notes")).closest("[data-shelf-row]")! };
    },
  },
  {
    name: "Work-item Todo",
    expected: [["open", "0"], ["complete", "3"], ["send", "4"], ["copy-link", "4"], ["rename", "5"], ["assign", "5"], ["move", "5"], ["move-up", "5"], ["move-down", "5"], ["delete", "7"]],
    receivers: ["a", "b"],
    mount: async () => {
      const owner = { kind: "agent" as const, id: "a", parent: null };
      const { app } = await mountTodos([1, 2, 3].map(id => todo(id, { owner, creator: owner })), true, [agent("a", "idle", "ready"), agent("b", "idle", "ready", { order: 1 }), workstream("other", { order: 2 })]);
      const disclosure = document.querySelector<HTMLElement>('[data-shelf-group="a"] [data-part="branch-control"]');

      if (disclosure?.getAttribute("aria-expanded") === "false") fireEvent.click(disclosure);
      const todos = screen.getByRole("region", { name: copy.todos });

      return { app, target: (await within(todos).findByText("todo 2")).closest("[data-todo]")! };
    },
  },
  {
    name: "Ask published output",
    expected: [["send", "4"], ["copy-link", "4"]],
    receivers: ["a"],
    mount: async () => {
      const { app } = await mountAskBar([], null, [agent("a", "idle", "ready")]);
      app.handlers["deliverable.list"] = () => [{
        id: "publication", project: "p", maker: USER, maker_name: "Me", home: null,
        title: "Result", published_at: 1792713600000,
        target: { kind: "external", url: "https://example.com/result", availability: "not-checked" },
      }];
      window.dispatchEvent(new Event("focus"));
      const made = await screen.findByRole("region", { name: copy.deliverables });

      return { app, target: await within(made).findByRole("listitem") };
    },
  },
])("u4409a_each_surface_projects_ordered_nonempty_groups: $name", async ({ mount, expected, receivers }) => {
  const { app, target } = await mount();
  const before = app.calls.length;
  const clipboard = [...app.clipboardWrites];

  fireEvent.contextMenu(target, { clientX: 120, clientY: 80 });
  await waitFor(() => expect(app.shownMenus).toHaveLength(1));
  const items = app.shownMenus[0]!.items;

  expect(items.map(item => [item.id, item.group])).toEqual(expected);
  expect(items.find(item => item.id === "send")?.children?.map(item => item.label) ?? []).toEqual(receivers);

  if (expected.some(([id]) => id === "add")) {
    expect(items.find(item => item.id === "add")?.children?.map(item => item.id)).toEqual(["add-agent", "add-todo", "add-pad", "add-terminal"]);
  }

  await app.closeMenu();
  // These are the read-only refreshes the mounted surfaces may perform; every action RPC fails this assertion.
  expect(app.calls.slice(before).filter(call => !["rail.tree", "terminal.list", "terminal.snapshot", "todo.list", "pad.list", "workstream.queue", "deliverable.list", "ask.list", "reaction.list"].includes(call.method))).toEqual([]);
  expect(app.clipboardWrites).toEqual(clipboard);
});

it.each([copy.addAgentMenu, copy.todo, copy.pad, copy.addTerminalMenu])("u4322a_add_uses_the_clicked_workstream_%s", async child => {
  const { app } = await mountApp(app => {
    app.handlers["rail.tree"] = () => [workstream("selected"), workstream("clicked", { order: 1 }), agent("peer", "idle", "ready", { order: 2 })];
    app.handlers["agent.spawn"] = () => agent("new", "idle", "ready", { parent: "clicked" });
    app.handlers["todo.create"] = () => todo(42);
    app.handlers["todo.move"] = () => todo(42, { home: "clicked" });
    app.handlers["pad.create"] = () => padOf("created", USER);
    app.handlers["pad.move"] = () => ({ ...padOf("created", USER), home: "clicked" });
    app.handlers["terminal.open"] = () => ({ terminal_id: "created-terminal" });
  });

  select("selected");
  open("clicked");
  await app.pickMenu(child);

  if (child === copy.todo) {
    const field = await screen.findByRole("textbox", { name: copy.newTodoTitle });
    fireEvent.input(field, { target: { value: "created" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(rpcCalls(app, "todo.move")).toEqual([{ id: 42, home: "clicked" }]));
  } else if (child === copy.pad) {
    const field = await screen.findByRole("textbox", { name: copy.padName });
    fireEvent.input(field, { target: { value: "created" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(rpcCalls(app, "pad.move")).toEqual([{ name: "created", home: "clicked" }]));
  } else if (child === copy.addAgentMenu) {
    await waitFor(() => expect(rpcCalls(app, "agent.spawn")).toEqual([{ cwd: "/p", parent: "clicked", prompt: null, model: null, effort: null, cols: 100, rows: 30 }]));
  } else await waitFor(() => expect(rpcCalls(app, "terminal.open")).toEqual([{ workstream: "clicked", cols: 100, rows: 30 }]));
  expect(rpcCalls(app, "rail.startDoor")).toEqual([]);
});
