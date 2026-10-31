import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import * as registry from "../keys/registry";
import { createSignal } from "solid-js";
import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { RpcError } from "../app/seam";
import { questionProbe } from "../testing/menuProbe";
import type { OpenParams } from "@contracts/terminal/OpenParams";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import type { RailNode } from "@contracts/agent/RailNode";
import type { FakeApp } from "../testing/fakeApp";
import { Rail } from "../rail/Rail";
import { notesFor } from "../changes/notes";
import { ConnectedProjectContext } from "../state/connectedProject";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { tab, path } from "../header/stripFixture";
import { rowOf, settled } from "../rail/railFixture";
import type { ConnectedProject } from "../state/connectedProject";
import { useBrowserStorage } from "../state/storage";
import { agent, event, info, workstream } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher, switcherKey } from "../switcher/switcherFixture";

afterEach(() => { Object.defineProperty(questionProbe, "shown", { configurable: true, writable: true, value: null }); cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

type Pending = { resolve: () => void; reject: (error: Error) => void };

/** One call the fake Daemon has received and not yet answered. */
const pending = <T,>(entered: () => void, value: T) => {
  const reply = Promise.withResolvers<T>();

  const handler = (): Promise<T> => {
    entered();

    return reply.promise;
  };

  return { handler, gate: { resolve: () => reply.resolve(value), reject: reply.reject } satisfies Pending };
};

type Row = {
  owner: "Rail" | "Bubble" | "App";
  label: string;
  selected: string;
  origin: string;
  method: string;
  params: SpawnParams | OpenParams | { name: string; parent: null } | { id: string } | undefined;
  /** Installs the pending handler for this row's method; `entered` runs as the call arrives. */
  hold: (app: FakeApp, entered: () => void) => Pending;
  confirms: boolean;
  /** The row that leaves the Rail while the reply is pending. A failed Remove is shown only while its own row stays (P3557c), so that row is never this one. */
  removes: string;
};

/** The scoped Rail Switcher actions that reach `rpc`, with the opening Project's object and the arguments its activation captures. */
const ROWS: Row[] = [
  { owner: "Rail", label: "New Agent", selected: "ops", origin: '[data-id="ops"][role="treeitem"]', method: "agent.spawn", confirms: false, removes: "bob",
    params: { cwd: "/p", prompt: null, parent: "ops", model: null, effort: null },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, agent("created", "idle", "idle", { terminal_id: "created-terminal" }));

      app.handlers["agent.spawn"] = handler;

      return gate;
    } },
  { owner: "Rail", label: "New Agent with a prompt", selected: "ops", origin: '[data-id="ops"][role="treeitem"]', method: "agent.spawn", confirms: false, removes: "bob",
    params: { cwd: "/p", prompt: "A\ne\u0301 🧭", parent: "ops", model: null, effort: null },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, agent("created", "idle", "idle"));
      app.handlers["agent.spawn"] = handler;

      return gate;
    } },
  { owner: "Rail", label: "Remove", selected: "ann", origin: '[data-id="ann"][role="treeitem"]', method: "rail.remove", confirms: true, removes: "bob",
    params: { id: "ann" },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, null);

      app.handlers["rail.remove"] = handler;

      return gate;
    } },

];

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.switcher [role="option"]')];

const activate = (row: HTMLElement, how: "enter" | "pointer"): void => {
  if (how === "pointer") {
    fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(row, { button: 0, pointerType: "mouse" });
    fireEvent.click(row);
  } else switcherKey("Enter", {}, field()!);
};

// App owns the surviving notice; the real Rail captures each original spawn contract.
const APP_ROWS: Row[] = ROWS.flatMap(row => row.method === "agent.spawn" ? [{ ...row, owner: "App", params: { cwd: path("first"), prompt: row.label === "New Agent" ? null : "A\ne\u0301 🧭", parent: "ops", model: null, effort: null } }] : []);

const BUBBLE_ROWS: Row[] = [
  { owner: "Bubble", label: "New Terminal", selected: "ops", origin: '.terminal-tab[data-bubble="7"]', method: "terminal.open", params: { workstream: "ops" }, confirms: false, removes: "7",
    hold: (app, entered) => {
      const reply = pending(entered, { terminal_id: "9" });
      app.handlers["terminal.open"] = reply.handler;

      return reply.gate;
    } },
  { owner: "Bubble", label: "Close the Bubble", selected: "ops", origin: '.terminal-tab[data-bubble="7"]', method: "terminal.close", params: { id: "7" }, confirms: true, removes: "7",
    hold: (app, entered) => {
      const reply = pending(entered, null);
      app.handlers["terminal.close"] = reply.handler;

      return reply.gate;
    } },
];

const mountApp = async (capture?: import("../app/seam").CapturePort, empty = false) => {
  useBrowserStorage(localStorage);
  const app = createFakeApp();
  app.capture = capture;
  app.add(path("first"));
  app.add(path("second"));
  app.of(path("first")).handlers["rail.tree"] = () => empty ? [] : [workstream("ops"), workstream("elsewhere", { order: 1 })];
  app.of(path("second")).handlers["rail.tree"] = () => [workstream("other")];
  app.of(path("first")).handlers["terminal.list"] = () => empty ? [] : [info("7", { owner: "ops", title: "original" })];
  let original: ConnectedProject | undefined;
  const emulators = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} prepareIdle={open => { if (open.project.path === path("first")) original = open; }} />);
  await screen.findByRole("tab", { name: /^first/ });
  fireEvent.click(tab("first"));
  await waitFor(() => expect(original).toBeDefined());

  if (!empty) {
    await screen.findByText("ops", { selector: ".name" });
    fireEvent.click(rowOf("ops"));
  }

  original!.showView("terminal-tabs");
  await settled();

  return { app: app.of(path("first")), connected: original!, other: app.of(path("second")) };
};

const CAPTURE_ROW: Row = {
  owner: "App", label: "Capture a Todo", selected: "ops", origin: '.terminal-tab[data-bubble="7"]',
  method: "capture.show", params: undefined, confirms: false, removes: "7",
  hold: () => { throw new Error("Native Capture uses its configured port"); },
};

const WORKSTREAM_ROW: Row = {
  owner: "App", label: "New Workstream", selected: "", origin: ".rail-actions", method: "rail.createWorkstream",
  params: { name: "workstream", parent: null }, confirms: false, removes: "",
  hold: (app, entered) => {
    const reply = pending(entered, workstream("created"));
    app.handlers["rail.createWorkstream"] = reply.handler;

    return reply.gate;
  },
};

const cases = [...ROWS, ...APP_ROWS, ...BUBBLE_ROWS, CAPTURE_ROW, WORKSTREAM_ROW].flatMap((row) => (["pointer", "enter"] as const).flatMap((how) =>
  (row === CAPTURE_ROW ? ["dismiss", "resolve", "reject"] as const : row.owner === "Bubble" && row.confirms ? ["dismiss", "cancel", "resolve", "reject", "reject-before-switch", "unknown", "confirmation-accept", "confirmation-cancel"] as const : row.confirms ? ["dismiss", "cancel", "resolve", "reject"] as const : (row.label === "New Agent" && row.owner !== "App" ? ["dismiss", "resolve", "reject", "unknown", "missing", "stale-selection", "removed-target", "unavailable"] as const : (row.owner === "Bubble" ? ["dismiss", "resolve", "reject", "reject-before-switch", "unknown"] as const : ["dismiss", "resolve", "reject", "unknown"] as const))).map((outcome) => ({ row, how, outcome }))));

it.each(cases)("s3806b_action_survives_surface_close: $row.owner $row.label by $how, pending reply $outcome", async ({ row, how, outcome }) => {
  const trace: string[] = [];
  const nativeCalls: undefined[] = [];
  const states: import("../app/seam").CaptureState[] = [];
  const nativeReply = pending(() => { nativeCalls.push(undefined); trace.push(`capture.show:${field() === null ? "closed" : "open"}`); }, undefined);

  const native = row === CAPTURE_ROW ? {
    configure: async () => {}, show: nativeReply.handler, dismiss: async () => {},
    publish: async (state: import("../app/seam").CaptureState) => { states.push(state); }, act: async () => {},
    onRequested: async () => () => {}, onAction: async () => () => {}, onState: async () => () => {},
  } : undefined;

  const [daemonExit, setDaemonExit] = createSignal<{ code: number | null } | null>(null);
  const mounted = row.owner !== "Rail" ? await mountApp(native, row === WORKSTREAM_ROW) : await mountSwitcher(row.selected, undefined, undefined, daemonExit);
  const { app, connected } = mounted;

  if (native) {
    const draft = connected.drafts.edit({ surface: "capture", object: "todo-capture", recipient: null }, {
      text: "  native draft e\u0301 🧭\n  ", targetCaptured: true, targetOwner: null, targetOwnerName: null, targetHome: "ops", targetHomeName: "ops",
    }, null, "ordinary");

    await draft.retained;
  }

  if (row.owner === "Bubble") {
    const edit = connected.drafts.edit({ surface: "bubbles", object: "fixture-7", recipient: "7" }, { name: "  draft e\u0301 🫧 雪  ", base: "original" }, null, "ordinary");
    await edit.retained;
  }

  const retainedDrafts = connected.drafts.list();
  const reply = native ? nativeReply.gate : row.hold(app, () => trace.push(`${row.method}:${field() === null ? "closed" : "open"}`));

  let shown = questionProbe.shown;

  Object.defineProperty(questionProbe, "shown", {
    configurable: true,
    get: () => shown,
    set: (value) => {
      shown = value;

      if (value !== null) trace.push(`question:${field() === null ? "closed" : "open"}`);
    },
  });

  const captures = vi.spyOn(registry, "captureActions");
  const origin = document.querySelector<HTMLElement>(row.origin)!;
  origin.focus();
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: row.label } });
  await waitFor(() => expect(field()!.value).toBe(row.label));
  const query = row.label;
  const option = options().find((candidate) => candidate.querySelector(".switcher-name")?.textContent === row.label)!;
  expect(option).toBeDefined();
  const before = app.calls.length;

  const ofMethod = () => native ? nativeCalls.map(() => ({ params: undefined })) : app.calls.slice(before).filter((call) => call.method === row.method);

  if (outcome === "dismiss") {
    // Closing the surface alone starts no call and asks nothing.
    switcherKey("Escape", {}, field()!);
    await waitFor(() => expect(field()).toBeNull());
    expect(app.calls.slice(before)).toEqual([]);
    expect(trace).toEqual([]);
    expect(connected.drafts.list().filter(draft => draft.destination.surface === "capture")).toEqual(retainedDrafts.filter(draft => draft.destination.surface === "capture"));

    return;
  }

  if (outcome === "stale-selection" || outcome === "removed-target" || outcome === "unavailable") {
    if (outcome === "stale-selection") connected.rail.select("ann");
    else if (outcome === "removed-target") {
      app.handlers["rail.tree"] = () => [agent("ann", "idle", "idle")];
      await connected.rail.refresh();
    } else setDaemonExit({ code: 1 });

    await waitFor(() => expect(options().some(candidate => candidate.dataset.value === option.dataset.value)).toBe(false));
    const afterChange = app.calls.length;
    const draft = connected.drafts.list();
    activate(option, how);
    expect(app.calls.slice(afterChange)).toEqual([]);
    expect(trace).toEqual([]);
    expect(field()?.value).toBe(query);
    expect(connected.drafts.list()).toEqual(draft);

    return;
  }

  // Observe the real captured action without substituting its registration/caller.
  const action = captures.mock.results.flatMap(result => result.type === "return" ? result.value : []).findLast(action => action.value === option.dataset.value)!;
  const run = action.run;
  vi.spyOn(action, "run").mockImplementation(() => {
    trace.push(`invoke:${field() === null ? "closed" : "open"}`);
    run();
  });
  activate(option, how);
  let submitted: ReturnType<typeof connected.drafts.list>[number] | undefined;
  let newer: ReturnType<typeof connected.drafts.list>[number] | undefined;

  if (row.label === "New Agent with a prompt") {
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Task" });
    fireEvent.input(prompt, { target: { value: " A\ne\u0301 🧭 " } });
    submitted = connected.drafts.list().find(entry => entry.destination.surface === "rail-task");
    switcherKey("Enter", {}, prompt);
    await waitFor(() => expect(ofMethod()).toHaveLength(1));
    fireEvent.input(prompt, { target: { value: " newer\n😀 " } });
    newer = connected.drafts.list().find(entry => entry.destination.surface === "rail-task" && entry.revision !== submitted?.revision);
    switcherKey("Escape", {}, prompt);
  }

  // Confirmation starts while the Switcher is mounted; its later answer survives owner removal.
  if (row.confirms) {
    await questionDialog();
    expect(trace).toEqual(["invoke:open", "question:open"]);
    expect(ofMethod()).toEqual([]);

    if (outcome === "confirmation-accept" || outcome === "confirmation-cancel") {
      fireEvent.click(tab("second"));
      await waitFor(() => row === WORKSTREAM_ROW ? expect(origin.isConnected).toBe(false) : expect(document.querySelector(row.origin)).toBeNull());
    }

    await answerQuestion(outcome !== "cancel" && outcome !== "confirmation-cancel");

    if (outcome === "cancel" || outcome === "confirmation-cancel") {
      expect(ofMethod()).toEqual([]);
      expect(trace).toEqual(["invoke:open", "question:open"]);

      return;
    }
  }

  await waitFor(() => expect(ofMethod()).toHaveLength(1));
  expect(trace).toEqual(row.confirms ? ["invoke:open", "question:open", `${row.method}:closed`] : ["invoke:open", `${row.method}:${native || row === WORKSTREAM_ROW ? "open" : "closed"}`]);
  const visibleParams = row.method === "agent.spawn" || row.method === "terminal.open" ? { ...row.params, cols: 100, rows: 30 } : row.params;
  expect(ofMethod().map((call) => call.params)).toEqual([visibleParams]);
  await waitFor(() => expect(field()).toBeNull());

  const queryDraft = connected.drafts.list().filter(entry => entry.destination.surface === "switcher");

  if (row.owner !== "Rail") {
    expect(queryDraft).toHaveLength(1);
    expect(queryDraft[0]).toMatchObject({ destination: { surface: "switcher", object: path("first"), recipient: null }, value: { query } });

    if (outcome === "reject-before-switch") {
      reply.reject(new RpcError(-32000, `${row.label} late rejection`));
      await waitFor(() => expect(document.body.textContent).toContain(`${row.label} late rejection`));
    }

    fireEvent.click(tab("second"));
    await waitFor(() => row === WORKSTREAM_ROW ? expect(origin.isConnected).toBe(false) : expect(document.querySelector(row.origin)).toBeNull());
  } else {
    // Changing the tree and selection must not retarget the pending action.
    const tree = app.handlers["rail.tree"]!;
    // SAFETY: the fake Daemon's rail.tree handler answers a RailNode[].
    app.handlers["rail.tree"] = (params) => [...(tree(params) as RailNode[]).filter((node) => node.id !== (outcome === "missing" ? row.selected : row.removes)), agent("keep", "idle", "idle", { order: 9 })];
    await connected.rail.refresh({ terminals: true });
    connected.rail.select("keep");
  }

  expect(ofMethod()).toHaveLength(1);

  if (row === WORKSTREAM_ROW) {
    await connected.drafts.edit({ surface: "rail-task", object: path("first"), recipient: null }, { text: " newer\ne\u0301 🧭 " }, null, "ordinary").retained;
    const drafts = connected.drafts.list();

    const complete = () => {
      app.handlers["rail.tree"] = () => [workstream("created")];
      app.handlers["rail.startDoor"] = () => workstream("created");
    };

    if (outcome === "resolve") {
      complete();
      reply.resolve();
      await waitFor(() => expect(connected.rail.nodes.map(node => node.id)).toEqual(["created"]));
      expect(document.querySelector('[data-id="created"]')).toBeNull();
    } else {
      reply.reject(outcome === "unknown" ? new Error("connection lost") : new RpcError(-32003, "database locked"));
      await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes(row.label) && alert.textContent.includes(outcome === "unknown" ? "connection lost" : "database locked"))).toBe(true));
      const recovery = connected.rail.commandFailure.retry();
      expect(recovery).not.toBeNull();
      expect(connected.drafts.list()).toEqual(drafts);
      fireEvent.click(screen.getByRole("button", { name: "Open first" }));
      await waitFor(() => expect(document.querySelector(row.origin)).not.toBeNull());
      expect(ofMethod()).toHaveLength(1);
      // New facts must not change the name captured by the empty-Rail activation.
      app.handlers["rail.tree"] = () => [workstream("elsewhere", { name: "workstream" })];
      await connected.rail.refresh();
      connected.rail.select("elsewhere");
      complete();
      app.handlers["rail.createWorkstream"] = () => workstream("created");
      fireEvent.click(document.querySelector(".rail-command-notice button")!);

      if (outcome === "unknown") {
        await questionDialog();
        expect(ofMethod()).toHaveLength(1);
        await answerQuestion(false);
        await waitFor(() => expect(connected.rail.workstreamCreating()).toBe(false));
        expect(ofMethod()).toHaveLength(1);
        expect(connected.rail.commandFailure.retry()).toBe(recovery);
        fireEvent.click(document.querySelector(".rail-command-notice button")!);
        await questionDialog();
        expect(ofMethod()).toHaveLength(1);
        await answerQuestion(true);
      }

      await waitFor(() => expect(ofMethod()).toHaveLength(2));
      expect(ofMethod().map(call => call.params)).toEqual([row.params, row.params]);
      await waitFor(() => expect(connected.rail.commandFailure.message()).toBeNull());
    }

    expect(connected.drafts.list()).toEqual(drafts);
    expect(drafts.filter(entry => entry.destination.surface === "switcher")).toEqual(queryDraft);
    expect("other" in mounted && mounted.other.calls.filter(call => [row.method, "rail.startDoor", "agent.prompt", "terminal.write", "message.send"].includes(call.method))).toEqual([]);
    expect(app.calls.slice(before).filter(call => ["agent.prompt", "terminal.write", "message.send"].includes(call.method))).toEqual([]);
    expect(app.badges.filter(count => count > 0)).toEqual([]);

    return;
  }

  if (native) {
    const drafts = connected.drafts.list();
    expect(drafts.filter(draft => draft.destination.surface === "capture")).toEqual(retainedDrafts.filter(draft => draft.destination.surface === "capture"));
    expect(drafts.filter(draft => draft.destination.surface === "switcher")).toEqual(queryDraft);

    if (outcome === "resolve") {
      reply.resolve();
      await waitFor(() => expect(states.at(-1)).toMatchObject({ text: "  native draft e\u0301 🧭\n  ", owner: "Unassigned", home: "In ops" }));
      expect(document.querySelector(row.origin)).toBeNull();
    } else {
      reply.reject(new Error("Native Capture could not open"));
      await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Native Capture could not open") && alert.textContent.includes(row.label))).toBe(true));
      expect(connected.drafts.list()).toEqual(drafts);
      expect(ofMethod()).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Open first" }));
      await waitFor(() => expect(document.querySelector(row.origin)).not.toBeNull());
      expect(ofMethod()).toHaveLength(1);
      connected.rail.select("elsewhere");
      native.show = async () => { nativeCalls.push(undefined); };

      fireEvent.click(document.querySelector(".rail-command-notice button")!);
      await waitFor(() => expect(ofMethod()).toHaveLength(2));
      await waitFor(() => expect(states.at(-1)).toMatchObject({ text: "  native draft e\u0301 🧭\n  ", owner: "Unassigned", home: "In ops" }));
    }

    expect(connected.drafts.list()).toEqual(drafts);
    expect(nativeCalls).toHaveLength(outcome === "resolve" ? 1 : 2);
    expect(app.calls.slice(before).filter(call => ["todo.create", "message.send", "agent.spawn", "agent.prompt", "terminal.write"].includes(call.method))).toEqual([]);
    expect("other" in mounted && mounted.other.calls.filter(call => ["todo.create", "message.send", "agent.spawn", "agent.prompt", "terminal.write"].includes(call.method))).toEqual([]);
    expect(app.badges.filter(count => count > 0)).toEqual([]);
    fireEvent.click(tab("first"));
    await screen.findByText("ops", { selector: ".name" });
    rowOf("ops").focus();
    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(query));
    switcherKey("Escape", {}, field()!);
    expect(connected.drafts.list()).toEqual(drafts);

    return;
  }

  if (row.owner === "Bubble") {
    const drafts = connected.drafts.list();
    expect(drafts.filter(draft => draft.destination.surface === "bubbles")).toEqual(retainedDrafts.filter(draft => draft.destination.surface === "bubbles"));

    if (outcome === "resolve" || outcome === "confirmation-accept") {
      app.handlers["terminal.list"] = () => row.method === "terminal.open" ? [info("7", { owner: "ops", title: "original" }), info("9", { owner: "ops", title: "created" })] : [];
      reply.resolve();
      await waitFor(() => expect(connected.rail.terminals().map(terminal => terminal.id)).toEqual(row.method === "terminal.open" ? ["7", "9"] : []));
    } else {
      if (outcome !== "reject-before-switch") reply.reject(outcome === "unknown" ? new Error(`${row.label} late rejection`) : new RpcError(-32000, `${row.label} late rejection`));
      await waitFor(() => expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes(`${row.label} late rejection`))).toBe(true));
      expect(connected.drafts.list()).toEqual(drafts);
      expect(ofMethod()).toHaveLength(1);
      expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes("Outcome unknown"))).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Open first" }));
      await waitFor(() => expect(document.querySelector(row.origin)).not.toBeNull());
      expect(ofMethod()).toHaveLength(1);
      expect(connected.drafts.list()).toEqual(drafts);
      connected.rail.select("elsewhere");

      if (row.method === "terminal.open") app.handlers["terminal.open"] = () => ({ terminal_id: "9" });
      else app.handlers["terminal.close"] = () => null;
      fireEvent.click(document.querySelector(".rail-command-notice button")!);
      await questionDialog();
      expect(ofMethod()).toHaveLength(1);
      await answerQuestion(true);
      await waitFor(() => expect(ofMethod()).toHaveLength(2));
      expect(ofMethod().map(call => call.params)).toEqual([visibleParams, row.params]);
    }

    expect(connected.drafts.list()).toEqual(drafts);
    expect("other" in mounted && mounted.other.calls.filter(call => [row.method, "message.send", "agent.spawn", "agent.prompt", "terminal.write"].includes(call.method))).toEqual([]);
    expect(app.calls.slice(before).filter(call => ["message.send", "agent.spawn", "agent.prompt", "terminal.write"].includes(call.method))).toEqual([]);
    expect(app.badges.filter(count => count > 0)).toEqual([]);

    if (outcome === "resolve" || outcome === "confirmation-accept") {
      fireEvent.click(tab("first"));
      await screen.findByText("ops", { selector: ".name" });
      rowOf("ops").focus();
    }

    openSwitcher();
    await waitFor(() => expect(field()?.value).toBe(query));

    return;
  }

  if (outcome === "resolve") {
    if (row.owner === "App") {
      app.handlers["rail.tree"] = () => [workstream("ops"), agent("created", "idle", "idle", { parent: "ops" })];
    }

    reply.resolve();

    if (row.owner === "App") {
      app.emit(event({ name: "rail.changed" }));
      await waitFor(() => expect(connected.rail.nodes.find(node => node.id === "created")?.parent).toBe("ops"));
    }

    await Promise.resolve();
    expect(connected.rail.selected()).toBe(row.owner === "App" ? "ops" : "keep");

    if (row.owner === "App") expect(document.querySelector('[data-id="created"]')).toBeNull();

    if (submitted) {
      await waitFor(() => expect(connected.drafts.list().some(entry => entry.revision === submitted.revision)).toBe(false));
      expect(connected.drafts.list()).toContainEqual(newer);
    }
  } else {
    reply.reject(outcome === "unknown" ? new Error(`${row.label} rejected by the Daemon`) : new RpcError(row.label === "New Agent with a prompt" || row.label === "Remove" ? -32003 : -32000, `${row.label} rejected by the Daemon`));
    await waitFor(() => expect(document.body.textContent).toContain(`${row.label} rejected by the Daemon`));

    if (row.method === "agent.spawn") {
      if (row.owner === "App") {
        const notice = await screen.findByRole("alert");
        expect(notice.textContent).toContain(`${row.label} rejected by the Daemon`);
        expect(ofMethod()).toHaveLength(1);
        expect(connected.drafts.list().filter(entry => entry.destination.surface === "switcher")).toEqual(queryDraft);
        expect("other" in mounted && mounted.other.calls.filter(call => call.method === row.method || call.method === "message.send" || call.method === "terminal.write")).toEqual([]);
        expect(app.badges.filter(count => count > 0)).toEqual([]);
        fireEvent.click(screen.getByRole("button", { name: "Open first" }));
        await waitFor(() => expect(document.querySelector(row.origin)).not.toBeNull());
        expect(connected.drafts.list().filter(entry => entry.destination.surface === "switcher")).toEqual(queryDraft);
        expect(ofMethod()).toHaveLength(1);
      }

      const notice = document.querySelector(".rail-command-notice")!;
      const retry = notice.querySelector("button");
      expect(retry).not.toBeNull();
      expect(connected.rail.commandFailure.message()).toContain("New Agent");
      // Removing the rendering owner must not discard the connection's recovery.
      // guarded's finally releases the add action after publishing the failure.
      await waitFor(() => expect(document.querySelector('.rail-actions button[aria-label="New Agent"]')?.getAttribute("aria-disabled")).toBeNull());
      const recovery = connected.rail.commandFailure.retry();

      if (row.owner !== "App") cleanup();
      expect(connected.rail.commandFailure.retry()).toBe(recovery);

      if (submitted) {
        expect(connected.drafts.list().find(entry => entry.revision === submitted.revision)).toMatchObject({ ...submitted, status: outcome === "unknown" ? "unknown" : "failed" });
        expect(connected.drafts.list()).toContainEqual(newer);
      }

      if (row.owner !== "App") render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
      app.handlers["agent.spawn"] = () => agent("recovered", "idle", "idle");
      fireEvent.click(document.querySelector(".rail-command-notice button")!);

      if (outcome === "missing") {
        expect(ofMethod()).toHaveLength(1);
        expect(connected.rail.commandFailure.message()).toContain("unavailable");

        return;
      }

      if (submitted && outcome === "unknown") {
        expect(document.activeElement).toBe(document.querySelector(`[data-revision="${submitted.revision}"] textarea`));
        expect(ofMethod()).toHaveLength(1);
        expect(connected.drafts.list()).toContainEqual(newer);

        return;
      }

      await waitFor(() => expect(ofMethod()).toHaveLength(2));
      // App recovery remounts its Pane; a standalone Rail retry remains hostless.
      expect(ofMethod().map(call => call.params)).toEqual([visibleParams, row.owner === "App" ? visibleParams : row.params]);
      await waitFor(() => expect(connected.rail.commandFailure.message()).toBeNull());

      if (submitted) {
        expect(connected.drafts.list().some(entry => entry.revision === submitted.revision)).toBe(false);
        expect(connected.drafts.list()).toContainEqual(newer);
      }

      expect(app.calls.slice(before).filter(call => call.method === "terminal.write" || call.method === "message.send")).toEqual([]);

      return;
    }
  }

  expect(ofMethod()).toHaveLength(1);
  expect(app.calls.slice(before).filter((call) => call.method === "terminal.write")).toEqual([]);

  if (row.owner === "App") {
    expect("other" in mounted && mounted.other.calls.filter(call => call.method === row.method)).toEqual([]);
    fireEvent.click(tab("first"));
    await waitFor(() => expect(document.querySelector(row.origin)).not.toBeNull());
  }

  // The query the user typed comes back exactly.
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(query));
});

const reviewCases = (["pointer", "enter"] as const).flatMap(how =>
  (["shared", "local"] as const).flatMap(readPath =>
  (["project", "selection"] as const).flatMap(removal =>
    (["resolve", "reject", "dismiss", "stale-selection", "identity", "missing"] as const).flatMap(outcome => removal === "selection" || outcome !== "dismiss" && outcome !== "stale-selection" ? [{ how, removal, outcome, readPath }] : []))));

it.each(reviewCases)("s3806b_action_survives_surface_close: Review changes $readPath by $how, $removal, $outcome", async ({ how, removal, outcome, readPath }) => {
  const { app, connected, other } = await mountApp();
  const reviewed = agent("reviewed", "idle", "ready", { parent: "ops", worktree: { path: "/first/.roundup/reviewed", branch: "reviewed", base: "main" } });
  let tree = [workstream("ops"), reviewed];
  app.handlers["rail.tree"] = () => tree;
  // The shared resource has not answered yet: the real panel falls back to changedFiles.
  app.handlers["agent.worktreeState"] = () => readPath === "local" ? new Promise(() => {}) : { ahead: 0, behind: 0, dirty: true };
  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "a.ts", status: "modified", line: 1 }] });
  await connected.rail.refresh();
  connected.rail.select("reviewed");
  const origin = await screen.findByRole("button", { name: "1 changed file" });
  const retained = connected.drafts.edit({ surface: "rail-task", object: "ops", recipient: "reviewed" }, { text: "  é 🧭\n unfinished  " }, null, "ordinary");
  await retained.retained;
  const notes = notesFor(connected.app, path("first"), connected.drafts);
  await notes.save("reviewed", { comparison: { base: "main", oldPath: "a.ts", newPath: "a.ts", status: "modified", old: { kind: "text", revision: "old", text: "before" }, new: { kind: "text", revision: "new", text: "after" } }, side: "new", start: 1, end: 1, source: "after", text: "  retain note é 🧭\n  " });
  const originalNotes = structuredClone(notes.list("reviewed"));
  const reply = Promise.withResolvers<{ ahead: number; behind: number; dirty: boolean; files: { path: string; status: "modified"; line: number }[] }>();
  const method = readPath === "shared" ? "agent.worktreeState" : "agent.changedFiles";
  const trace: string[] = [];
  app.handlers[method] = () => { trace.push(field() ? "receipt:open" : "receipt:closed");

 return reply.promise; };

  rowOf("reviewed").focus();
  const captures = vi.spyOn(registry, "captureActions");
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  const query = "Review changes";
  fireEvent.input(field()!, { target: { value: query } });

  const option = await waitFor(() => {
    const option = options().find(row => row.textContent?.includes(query));
    expect(option).toBeDefined();

    return option!;
  });

  const before = app.calls.length;
  const reads = () => app.calls.slice(before).filter(call => call.method === method);

  if (outcome === "dismiss") {
    switcherKey("Escape", {}, field()!);
    await waitFor(() => expect(field()).toBeNull());
    expect(reads()).toEqual([]);

    return;
  }

  if (outcome === "stale-selection") {
    const action = captures.mock.results.flatMap(result => result.type === "return" ? result.value : []).findLast(action => action.value === option.dataset.value)!;
    connected.rail.select("ops");
    await waitFor(() => expect(origin.isConnected).toBe(false));
    action.run();
    activate(option, how);
    expect(reads()).toEqual([]);
    expect(field()?.value).toBe(query);

    return;
  }

  activate(option, how);
  await waitFor(() => expect(reads()).toHaveLength(1));
  expect(trace).toEqual(["receipt:open"]);
  expect(reads().map(call => call.params)).toEqual([{ id: "reviewed" }]);
  await waitFor(() => expect(field()).toBeNull());
  const drafts = connected.drafts.list();
  expect(drafts.find(draft => draft.destination.surface === "switcher")).toMatchObject({ destination: { object: path("first"), recipient: null }, value: { query } });

  if (removal === "project") fireEvent.click(tab("second"));
  else connected.rail.select("ops");
  await waitFor(() => expect(origin.isConnected).toBe(false));

  if (outcome === "resolve") reply.resolve({ ahead: 8, behind: 0, dirty: false, files: [{ path: "original.ts", status: "modified", line: 1 }] });
  else reply.reject(new RpcError(-32003, "Review changes rejected: worktree unavailable"));

  if (outcome !== "resolve") {
    await waitFor(() => expect(screen.queryAllByRole("alert").some(alert => alert.textContent?.includes("Review changes rejected: worktree unavailable"))).toBe(true));
    // connectProject's existing retryRead allows one additional wire attempt after rejection.
    expect(reads().map(call => call.params)).toEqual([{ id: "reviewed" }, { id: "reviewed" }]);
    expect(connected.drafts.list()).toEqual(drafts);

    if (outcome === "identity" || outcome === "missing") {
      tree = outcome === "missing" ? [workstream("ops")] : [workstream("ops"), { ...reviewed, worktree: { ...reviewed.worktree!, branch: "replacement" } }];
      await connected.rail.refresh();
    }

    app.handlers["agent.worktreeState"] = () => ({ ahead: 9, behind: 0, dirty: false });
    app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "original.ts", status: "modified", line: 1 }] });

    if (removal === "project") {
      fireEvent.click(screen.getByRole("button", { name: /Open first/ }));
      await screen.findByText("ops", { selector: ".name" });
    }

    await settled();
    const retryBefore = app.calls.length;
    app.handlers["agent.worktreeState"] = () => ({ ahead: 9, behind: 0, dirty: false });
    app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "original.ts", status: "modified", line: 1 }] });
    fireEvent.click(within(document.querySelector<HTMLElement>(".rail-command-notice")!).getByRole("button", { name: "Retry" }));

    if (outcome === "identity" || outcome === "missing") {
      await waitFor(() => expect(screen.queryAllByRole("alert").some(alert => alert.textContent?.includes("unavailable"))).toBe(true));
      expect(app.calls.slice(retryBefore).filter(call => call.method === method)).toEqual([]);
    } else {
      await waitFor(() => expect(app.calls.slice(retryBefore).filter(call => call.method === method).map(call => call.params)).toEqual([{ id: "reviewed" }]));
      await waitFor(() => expect(connected.rail.commandFailure.message()).toBeNull());
    }
  } else {
    await waitFor(() => expect(connected.rail.commandFailure.message()).toBeNull());

    if (readPath === "shared" && removal === "selection") await waitFor(() => expect(connected.worktrees.read("reviewed")).toMatchObject({ failure: null, state: { ahead: 8, dirty: false } }));
  }

  expect(connected.drafts.list()).toEqual(drafts);
  expect(notes.list("reviewed")).toEqual(originalNotes);
  expect(other.calls.filter(call => call.method === method)).toEqual([]);
  expect(app.calls.slice(before).filter(call => ["terminal.write", "agent.prompt"].includes(call.method))).toEqual([]);
});
