import { copy } from "../copy";
import { createFakeApp } from "../testing/fakeApp";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSignal, type JSX } from "solid-js";
import { mountBubbles } from "../bubbles/bubblesFixture";
import { ChooseProject } from "../app/FirstRun";
import { RpcError } from "../app/seam";
import { Pads } from "../pads/Pads";
import { createReactions, Reactions } from "../reactions/Reactions";
import { Inbox } from "../inbox/Inbox";
import { WorkProgress } from "../orders/WorkProgress";
import { ConnectedProjectContext } from "../state/connectedProject";
import { agent, event, USER } from "../testing/nodes";
import { progressSeed } from "../testing/progressSeed";
import { TodoComments } from "../todos/TodoComments";
import { TodoHistory } from "../todos/TodoHistory";
import { TodoRefs } from "../todos/TodoRefs";
import { mountAskBar, input, press } from "../ask/askFixture";
import { mountTodos, todo } from "../todos/testHarness";

import { createBulkDelete } from "../shelf/BulkDelete";
import { ProjectTab } from "../header/ProjectTab";
import { ProjectDraftsContext } from "../state/connectedProject";
import { Tabs } from "../ui/Tabs";
import { Pane } from "../terminal/Pane";
import { fakeEmulators } from "../terminal/paneHarness";
import { gate, mountApp, select } from "../testing/appFixture";
import { mountControl } from "../changes/harness";
import { DiffReader } from "../changes/DiffReader";
import { notesFor } from "../changes/notes";
import { COMPARISON } from "../changes/noteHarness";
import { ImportPanel } from "../importer/ImportPanel";
import { ProjectSettingsView } from "../rail/ProjectSettings";
import { NewWorkstream } from "../todos/NewWorkstream";
import { Capture } from "../todos/Capture";
import { TodoDraftRecovery } from "../todos/EditableText";
import { TodoDrawer } from "../todos/TodoDrawer";
import { openShelf, openPad, padOf } from "../pads/padsFixture";
import { Switcher } from "../switcher/Switcher";
import { leaderKey } from "../keys/leaderFixture";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const FAILURE = "Cannot read work: try again";

type Mounted = Awaited<ReturnType<typeof mountTodos>>;

const ReactionSite = () => {
  const state = createReactions();

  return <section aria-busy={state.read.loading}><Reactions state={state} /></section>;
};

const readers: { site: string; method: "todo.unread" | "todo.comments" | "todo.getHistory" | "todo.refs" | "pad.list" | "reaction.list" | "message.progress"; render: () => JSX.Element; refresh: (mounted: Mounted) => void; role?: "status" }[] = [
  { site: "Inbox", method: "todo.unread", render: () => <Inbox />, refresh: m => m.app.emit(event({ name: "todo.commented", data: { id: 1 } })) },
  { site: "Todo comments", method: "todo.comments", render: () => <TodoComments id={1} />, refresh: m => m.app.emit(event({ name: "todo.commented", data: { id: 1 } })) },
  { site: "Todo history", method: "todo.getHistory", render: () => <TodoHistory id={1} />, refresh: m => m.app.emit(event({ name: "todo.deleted", data: { id: 2 } })) },
  { site: "Todo Pad references", method: "todo.refs", render: () => <TodoRefs id={1} />, refresh: m => m.app.emit(event({ name: "pad.changed", data: { name: "Plan" } })) },
  { site: "Pads", method: "pad.list", render: () => <Pads />, refresh: m => m.app.emit(event({ name: "pad.changed", data: { name: "Plan" } })) },
  { site: "Reactions", method: "reaction.list", render: () => <ReactionSite />, refresh: () => window.dispatchEvent(new Event("focus")) },
  { site: "Work progress", method: "message.progress", render: () => <WorkProgress id="a" />, refresh: m => m.app.emit(event({ name: "rail.changed" })) },
];

it.each(readers)("u3807_each_site_shows_its_message_in_the_reserved_line: $site", async (site) => {
  const mounted = await mountTodos([todo(1)]);

  if (site.method === "message.progress") {
    const seed = progressSeed({ project: mounted.connected.project.path, agent: "a" });
    mounted.app.handlers["message.progress"] = () => seed.progress;
    mounted.app.handlers["message.reconcileWork"] = () => seed.plan;
  }

  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><section>{site.render()}</section></ConnectedProjectContext.Provider>);

  if (site.method === "todo.unread") await within(view.container).findByText(copy.inboxEmpty);

  if (site.method === "todo.getHistory") await within(view.container).findByRole("button", { name: /change/i });

  if (site.method === "pad.list") await waitFor(() => expect(view.container.querySelector(".empty-state")).not.toBeNull());

  if (site.method === "reaction.list") await waitFor(() => expect(view.container.querySelector("[aria-busy=false]")).not.toBeNull());

  if (site.method === "message.progress") await within(view.container).findByRole("region", { name: "Progress" });

  const original = mounted.app.handlers[site.method];
  mounted.app.handlers[site.method] = () => { throw new RpcError(-32003, FAILURE); };

  site.refresh(mounted);
  const alert = await within(view.container).findByRole(site.role ?? "alert");
  const place = alert.closest<HTMLElement>(".reserved-line")!;
  Object.assign(mounted.app.handlers, { [site.method]: original });
  const retry = within(place).queryByRole("button", { name: site.method === "message.progress" ? "Read again" : /^(?!Clear|Dismiss)/ });

  if (retry) fireEvent.click(retry);
  else site.refresh(mounted);
  await waitFor(() => expect(within(view.container).queryByRole(site.role ?? "alert")).toBeNull());
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: first Project", () => {
  const [failure, setFailure] = createSignal<string | null>(null);
  const view = render(() => <section><ChooseProject app={createFakeApp()} onOpen={() => {}} failure={failure()} onChoose={() => {}} /></section>);
  setFailure(FAILURE);
  within(view.container).getByRole("alert");
  setFailure(null);
  expect(within(view.container).queryByRole("alert")).toBeNull();
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Rail", async () => {
  const mounted = await mountTodos([todo(1)], true, [agent("a", "idle", "i")], true);
  const surface = document.querySelector<HTMLElement>(".rail")!;
  mounted.app.handlers["rail.rename"] = () => { throw new RpcError(-32003, FAILURE); };

  fireEvent.dblClick(within(surface).getByText("a"));
  const field = within(surface).getByRole("textbox", { name: "Name" });
  fireEvent.input(field, { target: { value: "renamed" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await within(surface).findByRole("alert");
  fireEvent.click(within(surface).getByRole("button", { name: "Dismiss" }));
  expect(within(surface).queryByRole("alert")).toBeNull();
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: Ask send", async () => {
  const { app } = await mountAskBar();
  const surface = document.querySelector<HTMLElement>(".ask-bar")!;
  app.handlers["ask.send"] = () => { throw new RpcError(-32003, FAILURE); };

  fireEvent.input(input()!, { target: { value: "keep this request" } });
  press("Enter", {}, input()!);
  await within(surface).findByRole("alert");
  app.handlers["ask.send"] = () => ({ id: "accepted", text: "retry", at: 0n, parts: [] });
  fireEvent.input(input()!, { target: { value: "retry" } });
  press("Enter", {}, input()!);
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
});

/** The owning surface exposes the failure and clears it after recovery. */
const cycle = async <Shown, Cleared,>(surface: HTMLElement, show: () => Shown, hide: () => Cleared, role: "alert" | "status" = "alert") => {
  expect(within(surface).queryByRole(role)).toBeNull();
  await show();
  await within(surface).findByRole(role);
  await hide();
  await waitFor(() => expect(within(surface).queryByRole(role)).toBeNull());
};

it("u3807_each_site_shows_its_message_in_the_reserved_line: Diff reader", async () => {
  const mounted = await mountTodos([]);
  mounted.app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, status: null });
  const notes = notesFor(mounted.app, mounted.connected.project.path, mounted.connected.drafts);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><DiffReader id="a" name="alpha" path="a.ts" notes={notes} onEdited={() => {}} onBack={() => {}} onClose={() => {}} recover={() => {}} /></ConnectedProjectContext.Provider>);
  await within(view.container).findByText(/No remaining difference/);
  await cycle(view.container,
    () => { mounted.app.handlers["agent.compareFile"] = () => { throw new RpcError(-32003, FAILURE); };

 fireEvent.click(within(view.container).getByRole("button", { name: "Refresh" })); },
    () => { mounted.app.handlers["agent.compareFile"] = () => ({ ...COMPARISON, status: null }); fireEvent.click(within(view.container).getByRole("button", { name: "Retry" })); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: worktree panel", async () => {
  const { app, connected } = await mountControl();
  fireEvent.click(within(document.body).getByRole("button", { name: /\d+ changed files?/ }));
  const surface = await within(document.body).findByRole("dialog", { name: "Worktree" });
  await waitFor(() => { if (!surface.querySelector("file-tree-container")) throw new Error("Changed files pending"); });
  const original = app.handlers["agent.worktreeState"]!;
  await cycle(document.body,
    async () => { app.handlers["agent.worktreeState"] = () => { throw new RpcError(-32003, FAILURE); };

 await connected.worktrees.refresh("a"); },
    async () => { app.handlers["agent.worktreeState"] = original; await connected.worktrees.refresh("a"); });
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: importer Looking and failure", async () => {
  const mounted = await mountTodos([]);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><ImportPanel onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const surface = await within(document.body).findByRole("region", { name: "Import Claude Code work" });
  const read = gate<{ candidates: []; excluded: [] }>();
  mounted.app.handlers["project.importDiscover"] = () => read.promise;
  const pending = mounted.connected.importing.refresh();
  read.reject(new RpcError(-32003, FAILURE));
  await pending;
  await within(surface).findByRole("alert");
  mounted.app.handlers["project.importDiscover"] = () => new Promise(() => {});
  void mounted.connected.importing.refresh();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  mounted.connected.importing.cancel();
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: ProjectSettings", async () => {
  const mounted = await mountTodos([]);
  mounted.app.handlers["project.get"] = () => ({ worktrees: { on: false, check: null }, mcp: { on: true }, models: { roles: [] }, workstreamCap: 1 });
  mounted.connected.settingsView.show(document.body);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><ProjectSettingsView /></ConnectedProjectContext.Provider>);
  const field = within(view.container).getByRole("textbox");
  await waitFor(() => expect(field).toHaveProperty("disabled", false));
  mounted.app.handlers["project.setWorkstreamCap"] = () => { throw new RpcError(-32003, FAILURE); };

  await cycle(view.container,
    () => { fireEvent.input(field, { target: { value: "2" } }); fireEvent.keyDown(field, { key: "Enter" }); },
    () => { fireEvent.input(field, { target: { value: "1" } }); fireEvent.keyDown(field, { key: "Enter" }); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo drawer", async () => {
  const mounted = await mountTodos([todo(1)]);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><TodoDrawer id={1} todos={mounted.todos} /></ConnectedProjectContext.Provider>);
  await within(view.container).findByRole("button", { name: /Changes/ });
  const box = within(view.container).getByRole("checkbox", { name: "Complete todo 1" });
  const original = mounted.app.handlers["todo.complete"]!;
  await cycle(view.container,
    () => { mounted.app.handlers["todo.complete"] = () => { throw new RpcError(-32003, FAILURE); };

 fireEvent.click(box); },
    () => { mounted.app.handlers["todo.complete"] = original; fireEvent.click(box); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: New Workstream", async () => {
  const mounted = await mountTodos([todo(1)]);
  const [target] = createSignal<number | null>(1);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><NewWorkstream target={target} done={() => {}} returnTo={() => null} /></ConnectedProjectContext.Provider>);
  const surface = await within(document.body).findByRole("dialog", { name: "New Workstream" });
  mounted.app.handlers["todo.startWorkstream"] = () => { throw new RpcError(-32003, FAILURE); };

  await cycle(surface,
    () => fireEvent.click(within(surface).getByRole("button", { name: "Create" })),
    () => { mounted.app.handlers["todo.startWorkstream"] = () => new Promise(() => {}); fireEvent.click(within(surface).getByRole("button", { name: "Create" })); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Bubbles", async () => {
  const mounted = await mountBubbles();
  const surface = mounted.container;
  const original = mounted.app.handlers["terminal.open"]!;
  const add = await within(surface).findByRole("button", { name: "New Terminal" });
  await cycle(surface,
    () => { mounted.app.handlers["terminal.open"] = () => { throw new RpcError(-32003, FAILURE); };

 fireEvent.click(add); },
    () => { mounted.app.handlers["terminal.open"] = original; fireEvent.click(add); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Switcher", async () => {
  const mounted = await mountTodos([]);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Switcher onFailure={() => {}} onOpen={() => {}} /></ConnectedProjectContext.Provider>);
  leaderKey("KeyK");
  await within(document.body).findByRole("combobox");
  const surface = document.querySelector<HTMLElement>(".switcher")!;
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  fireEvent.input(within(surface).getByRole("combobox"), { target: { value: "retained search" } });
  await within(surface).findByRole("alert");
  storage.mockRestore();
  mounted.connected.drafts.retry();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: Pad drawer Saved", async () => {
  const { app } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const surface = field.closest<HTMLElement>(".pad-body")!;
  app.handlers["pad.write"] = ({ text }) => padOf("notes", USER, text);
  await cycle(surface, () => { fireEvent.input(field, { target: { value: "new" } }); fireEvent.focusOut(field); },
    () => fireEvent.input(field, { target: { value: "another" } }), "status");
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Capture", async () => {
  const mounted = await mountTodos([]);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Capture onFile={undefined} /></ConnectedProjectContext.Provider>);
  fireEvent.keyDown(document.body, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  const surface = await within(document.body).findByRole("dialog");
  const field = within(surface).getByRole("textbox");
  fireEvent.input(field, { target: { value: "kept capture" } });
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  fireEvent.input(field, { target: { value: "retained capture" } });
  await within(surface).findByRole("alert");
  storage.mockRestore();
  mounted.connected.drafts.retry();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: BulkDelete", async () => {
  let failure: string | null = FAILURE;

  const Site = () => {
    const [selected, setSelected] = createSignal<readonly number[]>([1, 2]);

    const bulk = createBulkDelete({ app: createFakeApp(), selected, targets: () => [{ id: 1, label: "Ship" }, { id: 2, label: "Review" }], context: () => "p", noun: "Todos",
      replace: setSelected, clear: () => setSelected([]), cancelSelection: () => setSelected([]), blocked: () => false, remove: async () => failure === null ? new Promise(() => {}) : [{ id: 1, message: failure }], reload: async () => null });

    return <bulk.Bar />;
  };

  const view = render(() => <Site />);
  const surface = view.container;
  fireEvent.click(within(surface).getByRole("button", { name: "Delete 2" }));
  await within(surface).findByRole("alert");
  // Keep one selected item so the bar remains mounted while its failure clears.
  failure = null;
  fireEvent.click(within(surface).getByRole("button", { name: "Delete 1" }));
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: ProjectTab", async () => {
  const mounted = await mountTodos([]);
  const path = mounted.connected.project.path;
  const draft = mounted.connected.drafts.edit({ surface: "header", object: path, recipient: null }, { name: "retained", base: "p" }, null, "ordinary").draft;
  render(() => <ProjectDraftsContext.Provider value={() => mounted.connected.drafts}><Tabs.Root value={path}><Tabs.List>
    <ProjectTab tab={{ path, name: "p", base: "p", busy: false, running: [], needsYou: 0, error: 0, exitText: null }} selected app={mounted.app} recovery={{ project: path, revision: draft.revision }} onMark={() => {}} onClose={() => {}} onRename={async () => ({ path, name: "p", revision: 1, status: "acknowledged", project: { path, name: "p" } })} />
  </Tabs.List></Tabs.Root></ProjectDraftsContext.Provider>);
  fireEvent.keyDown(await within(document.body).findByRole("textbox", { name: "Project name" }), { key: "Escape" });
  fireEvent.click(await within(document.body).findByRole("button", { name: /Recover unfinished work/ }));
  const surface = await within(document.body).findByRole("dialog", { name: "Unfinished work" });
  let rejected = true;
  vi.spyOn(mounted.app, "clipboardWrite").mockImplementation(async () => { if (rejected) throw new Error(FAILURE); });
  await cycle(surface, () => fireEvent.click(within(surface).getByRole("button", { name: "Copy name" })),
    () => { rejected = false; fireEvent.click(within(surface).getByRole("button", { name: "Copy name" })); });
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Terminal pane-failure", async () => {
  const mounted = await mountTodos([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Pane notice={notice()} createEmulator={fakeEmulators().factory} /></ConnectedProjectContext.Provider>);

  await cycle(view.container, () => setNotice(FAILURE), () => setNotice(null));
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo field recovery and retry", async () => {
  const mounted = await mountTodos([todo(1)]);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><TodoDraftRecovery object="1" active /></ConnectedProjectContext.Provider>);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  mounted.connected.drafts.edit({ surface: "todos", object: "1", recipient: "title" }, { title: "retained" }, null, "ordinary");
  const place = (await within(view.container).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  storage.mockRestore();
  fireEvent.click(within(place).getByRole("button", { name: "Retry storage only" }));
  await waitFor(() => expect(within(view.container).queryByRole("alert")).toBeNull());
});

it.each(["window", "Daemon exit", "Project"])("u3807_each_site_shows_its_message_in_the_reserved_line: App %s", async site => {
  const { app, container } = await mountApp();
  const surface = container.querySelector<HTMLElement>(".rail")!.parentElement!;

  if (site === "window") {
    app.windowTitleHandler = async () => { throw new Error(FAILURE); };

    await cycle(surface, () => select("harbor"), () => { app.windowTitleHandler = null; select("alpha"); });
  } else if (site === "Daemon exit") {
    app.exitDaemon({ code: 1 });
    const message = await within(surface).findByText(/Daemon exited/);
    const place = message.closest<HTMLElement>(".reserved-line")!;
    fireEvent.click(within(place).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
    await within(surface).findByRole("button", { name: /Overview, Project root/ });
  } else {
    const original = app.chooseProjectPath;
    await cycle(surface,
      () => { app.chooseProjectPath = async () => { throw new Error(FAILURE); };

 fireEvent.click(within(container).getByRole("button", { name: "Open a folder" })); },
      () => { app.chooseProjectPath = original; app.chooser.path = "/p"; fireEvent.click(within(container).getByRole("button", { name: "Open a folder" })); });
  }
});
