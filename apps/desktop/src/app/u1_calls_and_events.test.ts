import { Channel } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Todo } from "@contracts/todo/Todo";
import { createFakeApp } from "../testing/fakeApp";
import { connectEvents } from "./events";
import { RpcError } from "./seam";
import { createTauriApp } from "./tauri";

const TODO: Todo = {
  id: 1,
  title: "t",
  body: "",
  done: false,
  blockers: [],
  blocked: false,
  created_at: 0,
  creator: { kind: "user", id: "you", parent: null },
  home: null,
  owner: null,
  refs: [],
};

const NOT_FOUND = -32001;

const created = (id: number): DaemonEvent => ({
  actor: { kind: "user", id: "you", parent: null },
  name: "todo.created",
  data: { ...TODO, id },
});

const calls: unknown[] = [];

afterEach(() => {
  clearMocks();
  calls.length = 0;
});

describe("u1 calls and events", () => {
  it("u1_a_call_is_typed_from_the_method_table", async () => {
    const app = createFakeApp();
    app.handlers["todo.get"] = () => TODO;
    app.handlers["rail.tree"] = () => [];

    expectTypeOf(await app.rpc("todo.get", { id: 1 })).toEqualTypeOf<Todo>();
    expectTypeOf(await app.rpc("rail.tree", null)).toEqualTypeOf<RailNode[]>();
    // @ts-expect-error `todo.get` takes `{ id: number }`; a string id must not compile.
    await app.rpc("todo.get", { id: "1" });
  });

  it("u1_a_call_passes_its_method_and_params_and_resolves_the_result", async () => {
    mockIPC((command, args) => (command === "rpc" ? { echoed: args } : null));

    const result = await createTauriApp().forProject("/p").rpc("todo.get", { id: 7 });

    expect(result).toEqual({ echoed: { path: "/p", method: "todo.get", params: { id: 7 } } });
  });

  it("u1_a_failed_call_rejects_with_the_daemons_code_and_message", async () => {
    mockIPC(() => {
      throw { code: NOT_FOUND, message: "no todo 99" };
    });

    const failure = createTauriApp().forProject("/p").rpc("todo.get", { id: 99 });

    await expect(failure).rejects.toBeInstanceOf(RpcError);
    await expect(failure).rejects.toMatchObject({ code: NOT_FOUND, message: "no todo 99" });
  });

  it("u1_a_rejection_that_is_not_a_code_and_message_becomes_internal", async () => {
    mockIPC(() => {
      throw "command rpc not found";
    });

    const failure = createTauriApp().forProject("/p").rpc("daemon.ping", null);

    await expect(failure).rejects.toMatchObject({ code: -32603, message: "command rpc not found" });
  });

  it("u1_the_daemons_events_reach_the_subscription_in_order", async () => {
    const received: DaemonEvent[] = [];
    let sent: (event: DaemonEvent) => void = () => {};

    mockIPC((command, args) => {
      if (command === "subscribe" && args && "channel" in args && args.channel instanceof Channel) {
        sent = args.channel.onmessage;

        return 0;
      }

      return null;
    });

    await createTauriApp().forProject("/p").subscribe((event) => received.push(event));

    for (const id of [1, 2, 3]) sent(created(id));

    expect(received).toEqual([created(1), created(2), created(3)]);
  });

  it("u1_every_subscriber_gets_every_event_in_the_order_the_daemon_sent_it", async () => {
    const app = createFakeApp();
    const first: DaemonEvent[] = [];
    const second: DaemonEvent[] = [];

    const events = await connectEvents(app);
    events.subscribe((event) => first.push(event));
    events.subscribe((event) => second.push(event));

    for (const id of [1, 2, 3]) app.emit(created(id));

    expect(first).toEqual([created(1), created(2), created(3)]);
    expect(second).toEqual(first);
  });

  it("u1_a_subscriber_that_unsubscribed_hears_nothing_more", async () => {
    const app = createFakeApp();
    const heard: DaemonEvent[] = [];

    const events = await connectEvents(app);
    const unsubscribe = events.subscribe((event) => heard.push(event));
    app.emit(created(1));
    unsubscribe();
    app.emit(created(2));

    expect(heard).toEqual([created(1)]);
  });

  it("u1_the_adapter_listens_for_daemon_exited", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const exits: unknown[] = [];

    await createTauriApp().onDaemonExited((exit) => exits.push(exit));
    await emit("daemon-exited", { path: "/p", code: null });

    expect(exits).toEqual([{ path: "/p", code: null }]);
  });

  it("u1_the_adapter_stops_listening_once_unsubscribed", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const exits: unknown[] = [];

    const unsubscribe = await createTauriApp().onDaemonExited((exit) => exits.push(exit));
    unsubscribe();
    await emit("daemon-exited", { path: "/p", code: 1 });

    expect(exits).toEqual([]);
  });

  it("u1_the_adapter_opens_the_macos_folder_chooser_for_a_directory", async () => {
    mockIPC((command, args) => {
      if (command === "plugin:dialog|open") calls.push(args);

      return "/Users/me/p";
    });

    const path = await createTauriApp().chooseProjectPath();

    expect([path, calls]).toEqual(["/Users/me/p", [{ options: { directory: true, multiple: false } }]]);
  });

  it("u1_the_adapter_opens_the_save_chooser_with_the_suggested_file_name", async () => {
    mockIPC((command, args) => {
      if (command === "plugin:dialog|save") calls.push(args);

      return "/tmp/auth-notes.md";
    });

    const path = await createTauriApp().chooseSavePath("auth-notes.md");

    expect([path, calls]).toEqual(["/tmp/auth-notes.md", [{ options: { defaultPath: "auth-notes.md" } }]]);
  });

  it("u1_a_cancelled_chooser_answers_null", async () => {
    mockIPC(() => null);

    expect(await createTauriApp().chooseSavePath("x.md")).toBeNull();
  });

  it("u1_the_adapter_sets_the_dock_badge_count", async () => {
    mockWindows("main");
    mockIPC((command, args) => {
      if (command === "plugin:window|set_badge_count") calls.push(args);

      return null;
    });

    await createTauriApp().setDockBadge(3);

    expect(calls).toEqual([{ label: "main", value: 3 }]);
  });

  it("h18_daemon_proof_invokes_daemon_proof_with_the_path_and_returns_the_string", async () => {
    mockIPC((command, args) => {
      calls.push({ command, args });

      return "ab".repeat(32);
    });

    const proof = await createTauriApp().forProject("/p").daemonProof();

    expect(proof).toBe("ab".repeat(32));
    expect(calls).toEqual([{ command: "daemon_proof", args: { path: "/p" } }]);
  });

  it("h18_daemon_proof_rejects_with_the_apps_error_and_with_a_malformed_answer", async () => {
    mockIPC(() => {
      throw { code: -32603, message: "the Daemon has exited" };
    });
    await expect(createTauriApp().forProject("/p").daemonProof()).rejects.toMatchObject({
      code: -32603,
      message: "the Daemon has exited",
    });

    mockIPC(() => 7);
    await expect(createTauriApp().forProject("/p").daemonProof()).rejects.toBeInstanceOf(RpcError);
  });

  it("u1_a_dock_badge_count_of_zero_clears_the_badge", async () => {
    mockWindows("main");
    mockIPC((command, args) => {
      if (command === "plugin:window|set_badge_count") calls.push(args);

      return null;
    });

    await createTauriApp().setDockBadge(0);

    expect(calls).toEqual([{ label: "main", value: undefined }]);
  });

  it("s8_the_adapter_parses_the_open_projects_in_tab_order", async () => {
    const listed = [
      { name: "payments-api", path: "/p/payments-api", running: true },
      { name: "web", path: "/p/web", running: false },
    ];

    mockIPC((command) => (command === "projects" ? listed : null));

    expect(await createTauriApp().projects()).toEqual(listed);
  });

  it("s8_no_open_project_is_an_empty_list", async () => {
    mockIPC(() => []);

    expect(await createTauriApp().projects()).toEqual([]);
  });

  it("s8_close_and_rename_invoke_their_commands_with_the_path", async () => {
    mockIPC((command, args) => {
      calls.push({ command, args });

      return command === "rename_project" ? { name: "api", path: "/p" } : null;
    });
    const app = createTauriApp();

    await app.closeProject("/p");
    const renamed = await app.renameProject("/p", "api");
    await app.renameProject("/p", "next", "api");

    expect(renamed).toEqual({ name: "api", path: "/p" });
    expect(calls).toEqual([
      { command: "close_project", args: { path: "/p" } },
      { command: "rename_project", args: { path: "/p", name: "api" } },
      { command: "rename_project", args: { path: "/p", name: "next", base: "api" } },
    ]);
  });

  it.each([{ name: 7, path: "/p" }, { name: "p", path: 7 }, { name: "p" }, { path: "/p" }])(
    "u1_a_project_answer_of_%j_is_rejected_as_internal_by_open_project_and_rename_project",
    async (answer) => {
      mockIPC(() => answer);
      const app = createTauriApp();

      await expect(app.openProject("/p")).rejects.toMatchObject({ name: "RpcError", code: -32603 });
      await expect(app.renameProject("/p", "x")).rejects.toMatchObject({ name: "RpcError", code: -32603 });
    },
  );

  it("s8_a_project_list_entry_without_running_is_rejected_as_internal", async () => {
    mockIPC(() => [{ name: "p", path: "/p" }]);

    await expect(createTauriApp().projects()).rejects.toMatchObject({ name: "RpcError", code: -32603 });
  });

  it("s8_the_daemon_exited_listener_hears_the_path_and_the_code", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const exits: unknown[] = [];

    await createTauriApp().onDaemonExited((exit) => exits.push(exit));
    await emit("daemon-exited", { path: "/p", code: 7 });

    expect(exits).toEqual([{ path: "/p", code: 7 }]);
  });

  it("u1_a_daemon_exited_listener_that_cannot_attach_rejects_with_internal_and_the_string", async () => {
    mockIPC((command) => {
      if (command === "plugin:event|listen") throw "no event channel";

      return null;
    });

    await expect(createTauriApp().onDaemonExited(() => {})).rejects.toMatchObject({
      name: "RpcError",
      code: -32603,
      message: "no event channel",
    });
  });

  it("u1_a_daemon_exited_payload_that_is_not_a_code_never_reaches_the_listener", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const exits: unknown[] = [];

    await createTauriApp().onDaemonExited((exit) => exits.push(exit));
    await emit("daemon-exited", { path: "/p", code: "x" }).catch(() => {});

    expect(exits).toEqual([]);
  });

  it("u1_a_folder_chooser_that_throws_a_string_rejects_with_internal_and_the_string", async () => {
    mockIPC((command) => {
      if (command === "plugin:dialog|open") throw "dialog could not open";

      return null;
    });

    await expect(createTauriApp().chooseProjectPath()).rejects.toMatchObject({
      name: "RpcError",
      code: -32603,
      message: "dialog could not open",
    });
  });

  it("u1_a_save_chooser_that_throws_a_string_rejects_with_internal_and_the_string", async () => {
    mockIPC((command) => {
      if (command === "plugin:dialog|save") throw "save panel failed";

      return null;
    });

    await expect(createTauriApp().chooseSavePath("x.md")).rejects.toMatchObject({
      code: -32603,
      message: "save panel failed",
    });
  });

  it("u1_a_dock_badge_that_throws_a_string_rejects_with_internal_and_the_string", async () => {
    mockWindows("main");
    mockIPC((command) => {
      if (command === "plugin:window|set_badge_count") throw "no dock";

      return null;
    });

    await expect(createTauriApp().setDockBadge(2)).rejects.toMatchObject({ code: -32603, message: "no dock" });
  });

  it("u1_a_malformed_project_answer_rejects_with_the_validation_message", async () => {
    mockIPC(() => ({ name: 7, path: "/p" }));

    await expect(createTauriApp().openProject("/p")).rejects.toMatchObject({
      message: "Invalid type: Expected string but received 7",
    });
  });

  it("u1_the_adapter_file_is_the_only_door_to_tauri", () => {
    // so the only-door check sees adapters added after this test was written
    const sourceFiles = import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
      query: "?raw",
      import: "default",
      eager: true,
    });

    const importers = Object.entries(sourceFiles)
      .filter(([path, text]) => path !== "./tauri.ts" && text.includes("@tauri-apps"))
      .map(([path]) => path);

    expect(importers).toEqual([]);
  });
});
