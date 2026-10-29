import { seedApp } from "../testing/seeds";
import { RequestedApp } from "../testing/requestedApp";
import { showEverythingInApp } from "../testing/showEverything";
import { fakeEmulators } from "../terminal/paneHarness";
import { mountNavigation } from "../testing/navigationFixture";
import { mountSwitcher } from "../switcher/switcherFixture";
import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { CHORDS, LEADER } from "./chords";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs, tab } from "../header/stripFixture";
import { agent } from "../testing/nodes";
import { HintLine } from "./HintLine";
import { Leader } from "./Leader";
import { mountTodos, todo } from "../todos/testHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { RpcError } from "../app/seam";
import { leaderArmed, endLeader } from "./registry";

afterEach(() => { cleanup(); endLeader(); localStorage.clear(); sessionStorage.clear(); });

it.each(["key", "pointer", "button"] as const)("u4690_each_hint_runs_its_key_action_once: Ask %s", async source => {
  const { app } = await openTabs({ api: [agent("a1", "idle", "x")] });
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘/"]')).not.toBeNull());

  if (source === "key") fireEvent.keyDown(row, { key: "/", code: "Slash", metaKey: true });
  else {
    const button = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="⌘/"]')!;

    if (source === "button") button.focus();
    else fireEvent.pointerDown(button);
    fireEvent.click(button);
  }

  await waitFor(() => expect(document.activeElement?.closest(".ask-bar")).not.toBeNull());
  expect(document.querySelectorAll(".ask-input")).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each([1, 9])("u4690d_each_number_assigns_its_key_target_once: %s", async number => {
  for (const source of ["key", "pointer"] as const) {
    const { app, connected } = await mountTodos([todo(1)], true, Array.from({ length: 9 }, (_, at) => agent(`a${at + 1}`, "idle", "x", { name: `Agent ${at + 1}`, order: at })));
    render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);
    const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
    row.focus();
    await waitFor(() => expect(document.querySelector(`.hint-line [data-hint="Digit${number}"]`)).not.toBeNull());

    if (source === "key") fireEvent.keyDown(row, { key: String(number), code: `Digit${number}` });
    else fireEvent.click(document.querySelector(`.hint-line [data-hint="Digit${number}"]`)!);
    await waitFor(() => expect(app.calls.filter(call => call.method === "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner: { kind: "agent", id: `a${number}`, parent: null } }]));
    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
    cleanup();
  }
});

it("u4690c_unavailable_or_stale_hints_run_nothing", async () => {
  const { app, connected } = await mountTodos([todo(1)], true, [agent("a1", "idle", "x")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);
  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="Digit1"]')).not.toBeNull());
  const stale = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="Digit1"]')!;
  fireEvent.pointerDown(stale);
  app.handlers["rail.tree"] = () => [];
  await connected.rail.refresh();
  fireEvent.click(stale);
  expect(app.calls.filter(call => call.method === "todo.assign" || call.method === "terminal.write")).toEqual([]);
});

it.each(["key", "pointer"] as const)("u4690c_rejected_hint_uses_key_failure_path: %s", async source => {
  const { app, connected, store } = await mountTodos([todo(1)], true, [agent("a1", "idle", "x")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);
  app.handlers["todo.assign"] = () => { throw new RpcError(-32003, "Assignment refused: retry after reconnecting"); };

  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="Digit1"]')).not.toBeNull());

  if (source === "key") fireEvent.keyDown(row, { key: "1", code: "Digit1" });
  else fireEvent.click(document.querySelector('.hint-line [data-hint="Digit1"]')!);
  await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  expect(app.calls.filter(call => call.method === "todo.assign")).toHaveLength(1);
  expect(store.todos[0]).toMatchObject({ id: 1, owner: null });
  expect(document.activeElement).toBe(row);
});

it.each(["key", "pointer"] as const)("u4690b_leader_clicks_and_keys_share_one_wait: mixed %s", async source => {
  await openTabs({ api: [agent("a1", "idle", "x")] });
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘K"]')).not.toBeNull());

  if (source === "key") {
    fireEvent.keyDown(row, { key: "k", code: "KeyK", metaKey: true });
    fireEvent.keyDown(row, { key: "k", code: "KeyK", metaKey: true, repeat: true });
    expect(leaderArmed()).toBe(true);
    fireEvent.pointerDown(document.querySelector('.hint-line [data-hint="K"]')!);
    fireEvent.click(document.querySelector('.hint-line [data-hint="K"]')!);
  } else {
    fireEvent.click(document.querySelector('.hint-line [data-hint="⌘K"]')!);
    fireEvent.keyDown(row, { key: "k", code: "KeyK" });
  }

  await waitFor(() => expect(document.querySelectorAll('.switcher input')).toHaveLength(1));
  expect(leaderArmed()).toBe(false);
});

// These cases use the production App owners and the existing fake Daemon seam.
const press = (code: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, {
  key: code === "Slash" ? "/" : code.startsWith("Key") ? code.slice(3).toLowerCase() : code,
  code, ...init,
});

const activate = async (keys: string, source: "key" | "pointer", leader = false) => {
  if (leader) {
    press("KeyK", { metaKey: true });
    await waitFor(() => expect(leaderArmed()).toBe(true));
  }

  const button = await waitFor(() => {
    const found = document.querySelector<HTMLButtonElement>(`.hint-line [data-hint="${keys}"]`);
    expect(found?.disabled).toBe(false);

    return found!;
  });

  if (source === "pointer") { fireEvent.pointerDown(button); fireEvent.click(button); }
  else {
    const row = leader ? LEADER.find(row => row.keys === keys)! : CHORDS.find(row => row.keys === keys)!;
    const parts = ("press" in row ? row.press : row.presses[0]!).split("+");
    press(parts.at(-1)!, { metaKey: parts.includes("meta"), shiftKey: parts.includes("shift") || parts.includes("Shift") });
  }
};

it.each(["A", "P", "C", "J", "S", "T", "I"].flatMap(keys => (["key", "pointer"] as const).map(source => ({ keys, source }))))(
  "u4690b_leader_clicks_and_keys_share_one_wait: $keys $source", async ({ keys, source }) => {
    const { daemon, connected } = await mountNavigation(false, 1);
    connected().showView("workstreams");
    connected().showView("terminal-tabs");
    connected().rail.select("a1");

    const row = await waitFor(() => {
      const row = document.querySelector<HTMLElement>('.rail-row[data-id="a1"]');
      expect(row).not.toBeNull();

      return row!;
    });

    row.focus();

    if (keys === "C") await screen.findByRole("button", { name: /\d+ changed files?/ });
    await activate(keys, source, true);

    if (keys === "A") {
      await waitFor(() => expect(connected().rail.selected()).toBeNull());
      expect(connected().view()).toBeNull();
    }

    if (keys === "P") await screen.findByRole("combobox");

    if (keys === "C") await screen.findByRole("dialog", { name: "Worktree" });

    if (keys === "J") await waitFor(() => expect(connected().rail.selected()).toBe("a0"));

    if (keys === "S") await screen.findByRole("region", { name: "Todos" });

    if (keys === "T") await screen.findByRole("textbox", { name: "Capture a Todo" });

    if (keys === "I") await screen.findByRole("region", { name: "Inbox" });
    expect(leaderArmed()).toBe(false);
    expect(daemon.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  },
);

it.each(["key", "pointer"] as const)("u4690b_leader_clicks_and_keys_share_one_wait: other Project %s", async source => {
  const { app } = await openTabs({ api: [agent("a", "needs-you", "asks")], web: [agent("w", "idle", "idle")] });
  document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!.focus();
  await activate("⇧J", source, true);
  await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each([true, false].flatMap(accepted => (["key", "pointer"] as const).map(source => ({ accepted, source }))))(
  "u4690_each_hint_runs_its_key_action_once: Remove $source accepted=$accepted", async ({ accepted, source }) => {
    const { app, connected } = await mountSwitcher("ann");
    render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);
    const row = document.querySelector<HTMLElement>('.rail-row[data-id="ann"]')!;
    row.focus();
    await activate("⌘⌫", source);
    await questionDialog();
    expect(app.calls.filter(call => call.method === "rail.remove")).toEqual([]);
    await answerQuestion(accepted);
    await waitFor(() => expect(app.calls.filter(call => call.method === "rail.remove")).toHaveLength(accepted ? 1 : 0));
    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  },
);

it.each(["M", "W"].flatMap(keys => (["key", "pointer"] as const).map(source => ({ keys, source }))))(
  "u4690_each_hint_runs_its_key_action_once: Bubble $keys $source", async ({ keys, source }) => {
    const { app, connected, emulators } = await mountSwitcher("ops");
    render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);
    await waitFor(() => expect(document.querySelector<HTMLElement>('.bubble[data-bubble="7"]')?.hidden).toBe(false));
    emulators.made.get("7")!.focus();
    await activate(keys, source, true);

    if (keys === "W") {
      await questionDialog();
      expect(app.calls.filter(call => call.method === "terminal.close")).toEqual([]);
      await answerQuestion(true);
      await waitFor(() => expect(app.calls.filter(call => call.method === "terminal.close").map(call => call.params)).toEqual([{ id: "7" }]));
    } else if (keys === "M") await waitFor(() => expect(document.querySelector<HTMLElement>('.bubble[data-bubble="7"]')?.hidden).toBe(true));
    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  },
);

it.each(["M", "D", "E", "Esc", "O"].flatMap(keys => (["key", "pointer"] as const).map(source => ({ keys, source }))))(
  "u4690_each_hint_runs_its_key_action_once: Shelf $keys $source", async ({ keys, source }) => {
    const seeded = seedApp("tree-40", 0);

    const tree = seeded.app.handlers["rail.tree"]!;
    // Shelf actions need their rows and one assignable Agent, not forty independent Rail rows.
    seeded.app.handlers["rail.tree"] = async params => (await tree(params)).filter(node => node.id === "backend" || node.id === "migrate");

    if (keys === "M") seeded.app.handlers["todo.list"] = () => [todo(1)];

    const app = seeded.app;

    render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
    await showEverythingInApp(/backend/, keys === "E" ? "Pads" : "Todos");

    const row = document.querySelector<HTMLElement>(keys === "E" ? ".shelf .pad-name" : ".shelf .todo-row-button[aria-pressed]")!;
    row.focus();
    await activate(keys, source);

    if (keys === "M") {
      await within(document.querySelector<HTMLElement>(".shelf")!).findByRole("button", { name: "Restore" });
      await activate(keys, source);
      await within(document.querySelector<HTMLElement>(".shelf")!).findByRole("button", { name: "Maximise" });
    } else if (keys === "D") {
      await waitFor(() => expect(app.calls.filter(call => call.method === "todo.delete")).toHaveLength(1));
    } else if (keys === "E") {
      await waitFor(() => expect(app.chooser.suggestedNames).toHaveLength(1));
      expect(app.calls.filter(call => call.method === "pad.export")).toEqual([]);
    } else if (keys === "Esc") await waitFor(() => expect(document.querySelector<HTMLElement>(".window")?.dataset.shelf).toBe("closed"));
    else if (keys === "O") {
      await waitFor(() => expect(document.querySelectorAll(".owner-picker")).toHaveLength(1));
      press("Escape");
      await waitFor(() => expect(document.activeElement).toBe(row));
    }

    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
  },
);

it("u4690b_leader_clicks_and_keys_share_one_wait: competing A owners pointer", async () => {
  const source = "pointer";
  const { app } = seedApp("tree-40", 0);
  // CI timed out in this forty-row fixture; the competing owners need one Workstream and its Agent.
  const tree = await app.handlers["rail.tree"]!(null);
  app.handlers["rail.tree"] = () => tree.filter(node => node.id === "backend" || node.id === "migrate");
  const listed = await app.handlers["todo.list"]!(null);
  app.handlers["todo.list"] = () => listed.map(todo => ({ ...todo, home: "backend" }));
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();
  fireEvent.click(document.querySelector('.rail-row[data-id="backend"]')!);
  await waitFor(() => expect(document.querySelector('[role=treeitem][data-id="backend"]')?.getAttribute("aria-selected")).toBe("true"));

  for (const control of document.querySelectorAll<HTMLElement>('.shelf [data-part="branch-control"]')) {
    if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);
  }

  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".shelf .todo-row-button[aria-pressed]");
    expect(found).not.toBeNull();

    return found!;
  });

  fireEvent.click(row);
  row.focus();
  await activate("A", source, true);
  await waitFor(() => expect(document.querySelectorAll('.switcher input')).toHaveLength(1));
  expect(document.querySelector('[role=treeitem][data-id="backend"]')?.getAttribute("aria-selected")).toBe("true");
  expect(app.calls.filter(call => call.method === "todo.assign" || call.method === "terminal.write")).toEqual([]);
});

it.each(["modal", "project", "pending"])("u4690c_unavailable_or_stale_hints_run_nothing: %s", async state => {
  const { app } = await openTabs({ api: [agent("a", "idle", "idle")], web: [agent("w", "idle", "idle")] });
  const row = document.querySelector<HTMLElement>('.rail-row[data-id="w"]')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘/"]')).not.toBeNull());
  const stale = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="⌘/"]')!;
  fireEvent.pointerDown(stale);

  if (state === "project") {
    fireEvent.click(tab("api"));
    await waitFor(() => expect(tab("api").getAttribute("aria-selected")).toBe("true"));
  } else if (state === "modal") {
    press("KeyK", { metaKey: true });
    press("KeyK");
    await waitFor(() => expect(document.querySelector('.switcher input')).not.toBeNull());
  } else {
    press("Slash", { metaKey: true });
    await waitFor(() => expect(document.activeElement?.closest(".ask-bar")).not.toBeNull());
  }

  const focus = document.activeElement;
  const calls = app.calls.length;
  fireEvent.click(stale);
  expect(document.activeElement).toBe(focus);
  expect(app.calls).toHaveLength(calls);
});

it.each(["owned", "done"])("u4690d_each_number_assigns_its_key_target_once: unavailable %s", async state => {
  const { app, connected } = await mountTodos([todo(1, state === "done" ? { done: true } : { owner: { kind: "agent", id: "a1", parent: null } })], true, [agent("a1", "idle", "idle")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><Leader /><HintLine /></ConnectedProjectContext.Provider>);

  for (const control of document.querySelectorAll<HTMLElement>('.shelf [data-part="branch-control"]')) fireEvent.click(control);

  if (state === "done") fireEvent.click(await screen.findByRole("button", { name: "1 done" }));
  const row = document.querySelector<HTMLElement>('[data-todo="1"] .todo-row-button')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line')?.getAttribute("data-place")).toBe("shelf"));
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.hint-line [data-hint^="Digit"]')];
  expect(buttons.filter(button => !button.disabled)).toEqual([]);
  press("Digit1", { key: "1" });
  expect(app.calls.filter(call => call.method === "todo.assign" || call.method === "terminal.write")).toEqual([]);
});

it("u4690c_unavailable_or_stale_hints_run_nothing: no attention target", async () => {
  const { app } = await openTabs({ api: [agent("a", "idle", "idle")] });
  document.querySelector<HTMLElement>('.rail-row[data-id="a"]')!.focus();
  press("KeyK", { metaKey: true });
  await waitFor(() => expect(leaderArmed()).toBe(true));
  expect(document.querySelector('.hint-line [data-hint="J"]')).toBeNull();
  const before = app.calls.length;
  press("KeyJ");
  expect(leaderArmed()).toBe(false);
  expect(app.calls).toHaveLength(before);
  expect(document.querySelector('[role=treeitem][data-id="a"]')?.getAttribute("aria-selected")).not.toBe("true");
});
