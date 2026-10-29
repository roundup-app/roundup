import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { agent, workstream } from "../testing/nodes";
import { createFakeApp } from "../testing/fakeApp";
import { showEverything, withScopeRow } from "../testing/showEverything";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { Capture } from "../todos/Capture";
import { DrawerHost } from "../drawer/DrawerHost";
import { Todos } from "../todos/Todos";
import { todo, todoCallsTo as callsTo } from "../todos/testHarness";
import { Help } from "./Help";
import { leaderKey } from "./leaderFixture";
import { Leader } from "./Leader";
import { leaderArmed } from "./registry";

afterEach(cleanup);

const mount = async (path = `/test-capture/${crypto.randomUUID()}`, onFile?: () => void, capture?: import("../app/seam").CapturePort) => {
  const app = createFakeApp();
  app.capture = capture;
  app.handlers["rail.tree"] = () => withScopeRow([workstream("w"), agent("a", "idle", "idle")]);
  const store: TodoStore = { todos: [] };
  Object.assign(app.handlers, todoHandlers(store, () => {}));

  const connected = await connectProject(app, { name: "p", path }, () => true, () => 0);

  await showEverything(connected);
  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <button data-testid="before">before</button>
      <Todos />
      <DrawerHost drawer={connected.drawer} reducedMotion={() => true} />
      <Leader />
      <Capture onFile={onFile} />
      <Help />
    </ConnectedProjectContext.Provider>
  ));

  const before = screen.getByTestId("before");

  before.focus();

  return { app, store, before, connected };
};

const field = (): HTMLTextAreaElement | null => screen.queryByRole<HTMLTextAreaElement>("textbox", { name: "Capture a Todo" });

const openField = async () => {
  leaderKey("KeyT");

  return waitFor(() => {
    expect(field()).not.toBeNull();

    return field()!;
  });
};

const type = (input: HTMLElement, value: string) => fireEvent.input(input, { target: { value } });

const press = (input: HTMLElement, init: KeyboardEventInit = {}) => fireEvent.keyDown(input, { key: "Enter", code: "Enter", ...init });

// Rule 10: u3713_leader_t_opens_a_focused_empty_field_without_changing_selection proves opening; the design critic owns help copy.
// u3714_pending_capture_is_visible_under_selection proves the removed duplicate pending-row observer.
describe("u3713 the leader opens the capture field", () => {
  it("u3713_leader_t_opens_a_focused_empty_field_without_changing_selection", async () => {
    const { connected } = await mount();

    connected.rail.select(connected.rail.nodes[0]!.id);
    const selected = connected.rail.selected();
    const input = await openField();

    expect(connected.rail.selected()).toBe(selected);
    expect(leaderArmed()).toBe(false);
    expect(input.value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

});

describe("u3714 enter files an Unassigned Todo", () => {
  it("u3714_enter_creates_one_unassigned_todo_shows_its_row_and_restores_focus", async () => {
    const { app, before } = await mount();
    const input = await openField();

    type(input, "  buy milk  ");
    press(input);

    await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
    expect(callsTo(app, "todo.create")[0]!.params).toEqual({ title: "buy milk", body: null, blockers: null });
    expect(input.isConnected).toBe(false);
    expect(document.activeElement).toBe(before);
    await waitFor(() => expect(document.querySelectorAll('[data-todo="1"]')).toHaveLength(1));
  });

  it("u3714_blank_enter_calls_nothing", async () => {
    const { app } = await mount();
    const input = await openField();

    type(input, "   ");
    press(input);

    expect(callsTo(app, "todo.create")).toHaveLength(0);
    expect(field()).not.toBeNull();
  });

  it("u3714_escape_calls_nothing_and_restores_focus", async () => {
    const { app, before } = await mount();
    const input = await openField();

    type(input, "never filed");
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(field()).toBeNull());
    expect(callsTo(app, "todo.create")).toHaveLength(0);
    expect(document.activeElement).toBe(before);
  });

});

describe("u3715 a failed create keeps the text and says why", () => {
  it("u3715_a_rejected_create_reopens_the_field_with_the_text_and_the_cause", async () => {
    const { app } = await mount();
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32602, "the Daemon is full"));
    const input = await openField();

    type(input, "  keep me  ");
    press(input);

    await waitFor(() => expect(field()?.value).toBe("  keep me  "));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("u3715_text_typed_during_a_pending_create_survives_its_rejection", async () => {
    const { app } = await mount();
    let fail!: () => void;
    app.handlers["todo.create"] = () => new Promise((_, reject) => { fail = () => reject(new RpcError(-32602, "nope")); });
    const input = await openField();

    type(input, "first");
    press(input, { shiftKey: true });
    type(field()!, "second");
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    fail();

    await screen.findByLabelText("Recovered capture draft");
    expect(field()!.value).toBe("second");
    press(field()!, { shiftKey: true });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Recovered capture draft").value).toBe("first");

  });
});

describe("u3716 shift enter files and keeps the field open", () => {
  it("u3716_shift_enter_files_and_leaves_an_empty_focused_field", async () => {
    const { app } = await mount();
    const input = await openField();

    type(input, "one");
    press(input, { shiftKey: true });

    await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
    expect(field()!.value).toBe("");
    expect(document.activeElement).toBe(field());
  });

  it("u3716_a_failed_shift_enter_restores_the_text", async () => {
    const { app } = await mount();
    app.handlers["todo.create"] = () => Promise.reject(new RpcError(-32602, "no"));
    const input = await openField();

    type(input, "again");
    press(input, { shiftKey: true });

    await waitFor(() => expect(field()!.value).toBe("again"));
  });
});

it("u2773a_capture_restores_exact_work_after_project_remount", async () => {
  const path = `/test-capture/${crypto.randomUUID()}`;
  const { app } = await mount(path);
  const input = await openField();
  type(input, "  unfinished é\n😀  ");
  input.setSelectionRange(3, 9, "backward");
  fireEvent.select(input);
  cleanup();
  const other = await mount();
  expect((await openField()).value).toBe("");
  cleanup();
  const reopened = await mount(path);
  const restored = await openField();
  expect(restored.value).toBe("  unfinished é\n😀  ");
  await waitFor(() => expect([restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual([3, 9, "backward"]));
  expect(callsTo(app, "todo.create")).toEqual([]);
  expect(callsTo(other.app, "todo.create")).toEqual([]);
  expect(callsTo(reopened.app, "todo.create")).toEqual([]);
});

it.each(["w", "a"])("u3714_pending_capture_is_visible_under_selection_%s", async (selection) => {
  const { connected, app } = await mount();
  connected.rail.select(selection);
  let answer!: () => void;
  app.handlers["todo.create"] = () => new Promise(resolve => { answer = () => resolve(todo(9)); });
  const input = await openField();
  type(input, "visible pending");
  press(input, { shiftKey: true });
  await waitFor(() => expect(answer).toBeTypeOf("function"));
  expect(document.querySelector(".todos-tab [data-todo]")).not.toBeNull();
  answer();
});

it("u3714_a_filed_capture_opens_the_shelf_and_stays_visible_once_acknowledged", async () => {
  let filed = 0;
  const { store } = await mount(undefined, () => { filed += 1; });
  const input = await openField();
  type(input, "kept in view");
  press(input);
  await waitFor(() => expect(filed).toBe(1));
  await waitFor(() => expect(store.todos.map(item => item.title)).toContain("kept in view"));
  await waitFor(() => expect(document.querySelector("[data-shelf-group=unassigned] [data-state=open]")).not.toBeNull());
});

it("u3787f_global_capture_uses_the_existing_owner_once_per_press", async () => {
  let requested = () => {};

  let action: (event: import("../app/seam").CaptureAction) => void = () => {};

  const snapshots: import("../app/seam").CaptureState[] = [];

  const capture: import("../app/seam").CapturePort = {
    configure: vi.fn(async () => {}), show: vi.fn(async () => {}), dismiss: vi.fn(async () => {}),
    publish: async state => { snapshots.push(state); }, act: async () => {},
    onRequested: async listener => {
      requested = listener;

      return () => { requested = () => {}; };
    },
    onAction: async listener => {
      action = listener;

      return () => {};
    }, onState: async () => () => {},
  };

  const { app, connected } = await mount(undefined, undefined, capture);
  connected.rail.select("w");
  requested();
  requested();
  action({ kind: "ready" });
  await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
  const state = snapshots.at(-1)!;
  action({ kind: "file", session: state.session, sequence: 1, text: "native draft 雪", keepOpen: false });
  await waitFor(() => expect(callsTo(app, "todo.create")).toHaveLength(1));
  expect(capture.show).toHaveBeenCalledTimes(1);
  expect(callsTo(app, "todo.create")[0]!.params).toMatchObject({ title: "native draft 雪" });
  expect(screen.queryByRole("dialog")).toBeNull();
  cleanup();
  requested();
  expect(capture.show).toHaveBeenCalledTimes(1);
});

it("u3787f_native_dismiss_retains_exact_work_and_refuses_the_previous_session", async () => {
  let requested = () => {};

  let action: (event: import("../app/seam").CaptureAction) => void = () => {};

  const snapshots: import("../app/seam").CaptureState[] = [];

  const capture: import("../app/seam").CapturePort = {
    configure: async () => {}, show: async () => {}, dismiss: async () => {},
    publish: async state => { snapshots.push(state); }, act: async () => {},
    onRequested: async listener => {
      requested = listener;

      return () => {};
    },
    onAction: async listener => {
      action = listener;

      return () => {};
    }, onState: async () => () => {},
  };

  const { app, connected } = await mount(undefined, undefined, capture);
  connected.rail.select("w");
  requested();
  await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
  const first = snapshots.at(-1)!;
  action({ kind: "edit", session: first.session, sequence: 1, text: "  exact 雪\nwork  " });
  action({ kind: "dismiss", session: first.session });
  connected.rail.select("a");
  requested();
  await waitFor(() => expect(snapshots.at(-1)?.session).not.toBe(first.session));
  expect(snapshots.at(-1)?.text).toBe("  exact 雪\nwork  ");
  action({ kind: "file", session: first.session, sequence: 2, text: "stale", keepOpen: false });
  expect(callsTo(app, "todo.create")).toHaveLength(0);
});

it("u3787f_shortcut_collision_preserves_the_acknowledged_setting_and_shows_the_cause", async () => {
  const { ShortcutSetting } = await import("../settings/ShortcutSetting");
  const { appSettings } = await import("../settings/preferences");
  const before = appSettings().quickAdd;
  const causes: (string | null)[] = [];
  render(() => <ShortcutSetting capture={{ configure: async () => { throw new Error("Shortcut is already registered. Choose another shortcut."); }, show: async () => {}, dismiss: async () => {}, publish: async () => {}, act: async () => {}, onRequested: async () => () => {}, onAction: async () => () => {}, onState: async () => () => {} }} onFailure={cause => causes.push(cause)} />);
  fireEvent.click(screen.getByRole("button", { name: /Quick add a Todo/ }));
  fireEvent.keyDown(window, { key: "y", code: "KeyY", metaKey: true, altKey: true });
  await waitFor(() => expect(causes.at(-1)).toContain("already registered"));
  expect(appSettings().quickAdd).toBe(before);
});

it("u3787f_global_capture_registers_and_releases_through_the_shell_event_adapter", async () => {
  const { clearMocks, mockIPC } = await import("@tauri-apps/api/mocks");
  const { emit } = await import("@tauri-apps/api/event");
  const { createTauriApp } = await import("../app/tauri");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const requests: unknown[] = [];
  mockIPC((command, args) => { if (command === "plugin:capture-panel|control") requests.push(args); }, { shouldMockEvents: true });

  try {
    const port = createTauriApp().capture!;
    await mount(undefined, undefined, port);
    await emit("capture-requested");
    await waitFor(() => expect(requests).toContainEqual({ request: { kind: "show" } }));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    const shows = requests.filter(request => JSON.stringify(request) === '{"request":{"kind":"show"}}').length;
    await emit("capture-requested");
    expect(requests.filter(request => JSON.stringify(request) === '{"request":{"kind":"show"}}')).toHaveLength(shows);
  } finally { clearMocks(); vi.restoreAllMocks(); }
});


it("t4905_opening_a_pending_capture_sends_no_item_rpc", async () => {
  const { app } = await mount();
  let answer!: () => void;
  app.handlers["todo.create"] = () => new Promise(resolve => { answer = () => resolve(todo(9)); });
  const input = await openField();
  type(input, "pending capture");
  press(input);
  await waitFor(() => expect(answer).toBeTypeOf("function"));
  const row = document.querySelector<HTMLElement>("[data-todo]")!;
  const open = row.querySelector<HTMLElement>(".todo-open");
  if (open) fireEvent.click(open);
  const button = row.querySelector<HTMLElement>(".todo-row-button");
  if (button) fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
  expect(app.calls.filter(call => ["todo.refs", "todo.comments", "todo.getHistory"].includes(call.method))).toEqual([]);
  expect(app.calls.filter(call => JSON.stringify(call.params).includes(row.dataset.todo!))).toEqual([]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  answer();
});


it("t4905_a_filed_capture_opens_with_its_returned_id", async () => {
  const { app, store } = await mount();
  let answer!: () => void;
  app.handlers["todo.create"] = () => new Promise(resolve => { answer = () => {
    const created = todo(9, { title: "filed capture" });
    store.todos = [created];
    resolve(created);
  }; });
  const input = await openField();
  type(input, "filed capture");
  press(input, { shiftKey: true });
  await waitFor(() => expect(answer).toBeTypeOf("function"));
  type(field()!, "newer draft");
  answer();
  await waitFor(() => expect(document.querySelectorAll("[data-todo]")).toHaveLength(1));
  await waitFor(() => expect(document.querySelector('[data-todo="9"]')).not.toBeNull());
  expect(document.querySelector("[data-pending]")).toBeNull();
  expect(field()!.value).toBe("newer draft");
  fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Open filed capture" }));
  await waitFor(() => expect(callsTo(app, "todo.getHistory").length).toBeGreaterThan(0));
  await waitFor(() => expect(callsTo(app, "todo.comments").length).toBeGreaterThan(0));
  await waitFor(() => expect(callsTo(app, "todo.refs").length).toBeGreaterThan(0));
  for (const method of ["todo.getHistory", "todo.comments", "todo.refs"]) {
    expect(callsTo(app, method).every(call => call.params.id === 9)).toBe(true);
  }
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["create", "move"])("t4905_a_settled_failure_removes_only_its_placeholder_%s", async (stage) => {
  const { app, connected } = await mount();
  if (stage === "move") connected.rail.select("w");
  let fail!: () => void;
  app.handlers[stage === "create" ? "todo.create" : "todo.move"] = () => new Promise((_, reject) => {
    fail = () => reject(new RpcError(-32602, "capture refused"));
  });
  const input = await openField();
  type(input, "  rejected capture  ");
  press(input, { shiftKey: true });
  await waitFor(() => expect(fail).toBeTypeOf("function"));
  type(field()!, "  newer draft 雪  ");
  expect(document.querySelector("[data-todo]")).not.toBeNull();
  fail();
  await screen.findByLabelText("Recovered capture draft");
  expect(document.querySelector("[data-pending]")).toBeNull();
  expect(field()!.value).toBe("  newer draft 雪  ");
  expect(screen.getByLabelText<HTMLTextAreaElement>("Recovered capture draft").value).toBe("  rejected capture  ");
  expect(screen.getByRole("alert").textContent).toContain("capture refused");
  if (stage === "move") await waitFor(() => expect(document.querySelector('[data-todo="1"]')).not.toBeNull());
  expect(app.calls.some(call => JSON.stringify(call.params).includes('"id":-'))).toBe(false);
});
