import { createFakeApp } from "../testing/fakeApp";
import { questionDialog, answerQuestion } from "../shelf/bulkQuestionHarness";
import { questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSignal, type JSX } from "solid-js";
import { mountBubbles, TERMINALS } from "../bubbles/bubblesFixture";
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
import { OrderDrawer } from "../orders/OrderDrawer";
import { DecisionCard } from "../decisions/DecisionCard";
import { decision, gate, mountApp, select } from "../decisions/decisionsFixture";
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
import { Keys } from "../keys/Keys";
import { leaderKey } from "../keys/leaderFixture";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const FAILURE = "Cannot read work: try again";

const placesOf = (surface: HTMLElement) => new Map([...surface.querySelectorAll(".reserved-line")].map(place => [place, [...place.parentElement!.children]]));

const unchanged = (places: ReturnType<typeof placesOf>, place: Element) => {
  expect(places.has(place)).toBe(true);
  const siblings = [...place.parentElement!.children];
  const original = places.get(place)!;
  expect(siblings).toHaveLength(original.length);

  siblings.forEach((sibling, index) => expect(sibling).toBe(original[index]));
};

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
  { site: "Reactions", method: "reaction.list", render: () => <ReactionSite />, refresh: () => window.dispatchEvent(new Event("focus")), role: "status" },
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

  if (site.method === "todo.getHistory") await within(view.container).findByRole("button", { name: /change/i });

  if (site.method === "pad.list") await waitFor(() => expect(view.container.querySelector(".empty-state")).not.toBeNull());

  if (site.method === "reaction.list") await waitFor(() => expect(view.container.querySelector("[aria-busy=false]")).not.toBeNull());

  if (site.method === "message.progress") await within(view.container).findByRole("region", { name: "Progress" });

  const original = mounted.app.handlers[site.method];
  const places = placesOf(view.container);
  mounted.app.handlers[site.method] = () => { throw new RpcError(-32003, FAILURE); };

  site.refresh(mounted);
  const alert = await within(view.container).findByRole(site.role ?? "alert");
  const place = alert.closest<HTMLElement>(".reserved-line")!;
  expect(alert.textContent).toContain(FAILURE);
  unchanged(places, place);
  Object.assign(mounted.app.handlers, { [site.method]: original });
  const retry = within(place).queryByRole("button", { name: site.method === "message.progress" ? "Read again" : /retry/i });

  if (retry) fireEvent.click(retry);
  else site.refresh(mounted);
  await waitFor(() => expect(within(view.container).queryByText(FAILURE)).toBeNull());
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: first Project", () => {
  const [failure, setFailure] = createSignal<string | null>(null);
  const view = render(() => <section><ChooseProject failure={failure()} onChoose={() => {}} /></section>);
  const places = placesOf(view.container);
  setFailure(FAILURE);
  const place = within(view.container).getByRole("alert").closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  setFailure(null);
  expect(within(view.container).queryByRole("alert")).toBeNull();
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Rail", async () => {
  const mounted = await mountTodos([todo(1)], true, [], true);
  const surface = document.querySelector<HTMLElement>(".rail")!;
  const places = placesOf(surface);
  mounted.app.handlers["rail.createWorkstream"] = () => { throw new RpcError(-32003, FAILURE); };

  await mounted.connected.rail.createWorkstream();
  const place = within(surface).getByRole("alert").closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  mounted.connected.rail.clearWorkstreamFailure();
  expect(within(surface).queryByRole("alert")).toBeNull();
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Terminal name recovery", async () => {
  const mounted = await mountBubbles();
  fireEvent.dblClick(document.querySelector('button.terminal-tab[data-bubble="2"] .terminal-tab-name')!);
  const field = await within(mounted.container).findByRole("textbox", { name: "Terminal name" });
  fireEvent.input(field, { target: { value: "retained name" } });
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(await within(mounted.container).findByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const recovery = await within(document.body).findByRole("dialog", { name: "Unfinished work" });
  await cycle(recovery,
    async () => {
      mounted.setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, title: "external" } : terminal));
      mounted.app.emit(event({ name: "terminal.changed" }));
      await mounted.connected.rail.settled();
    },
    async () => {
      mounted.setListed(TERMINALS);
      mounted.app.emit(event({ name: "terminal.changed" }));
      await mounted.connected.rail.settled();
    }, "The original name changed");
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Ask send", async () => {
  const { app } = await mountAskBar();
  const surface = document.querySelector<HTMLElement>(".ask-bar")!;
  const places = placesOf(surface);
  app.handlers["ask.send"] = () => { throw new RpcError(-32003, FAILURE); };

  fireEvent.input(input()!, { target: { value: "keep this request" } });
  press("Enter", {}, input()!);
  const alert = await within(surface).findByRole("alert");
  const place = alert.closest<HTMLElement>(".reserved-line")!;
  expect(alert.textContent).toContain(FAILURE);
  unchanged(places, place);
  app.handlers["ask.send"] = () => ({ id: "accepted", text: "retry", at: 0n, parts: [] });
  fireEvent.input(input()!, { target: { value: "retry" } });
  press("Enter", {}, input()!);
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  unchanged(places, place);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo row", async () => {
  const { app } = await mountTodos([todo(1)]);
  const row = document.querySelector<HTMLElement>('[data-todo="1"]')!;
  const places = placesOf(row);
  const siblings = [...row.children];
  app.handlers["todo.complete"] = () => { throw new RpcError(-32003, FAILURE); };

  fireEvent.click(await within(row).findByRole("checkbox"));
  const place = (await within(row).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  expect([...row.children]).toEqual(siblings);
  fireEvent.click(document.body);
  await waitFor(() => expect(within(row).queryByRole("alert")).toBeNull());
  unchanged(places, place);
  expect([...row.children]).toEqual(siblings);
});


/** Observe only the named message's siblings; reader content may settle independently. */
const cycle = async <Shown, Cleared,>(surface: HTMLElement, show: () => Shown, hide: () => Cleared, text = FAILURE) => {
  const places = placesOf(surface);
  expect(within(surface).queryByText(text)).toBeNull();
  await show();
  const message = await within(surface).findByText(text, { exact: false });
  const place = message.closest<HTMLElement>(".reserved-line")!;
  expect(place).not.toBeNull();
  unchanged(places, place);
  await hide();
  await waitFor(() => expect(place.textContent).not.toContain(text));
  unchanged(places, place);
};

it("u3807_each_site_shows_its_message_in_the_reserved_line: Order spawn failure", async () => {
  const mounted = await mountTodos([], true, [agent("a", "working", "building", { work: { kind: "work", ask: "Ship", limits: [] } })]);
  mounted.app.handlers["agent.spawnPrompt"] = () => { throw new RpcError(-32003, FAILURE); };

  const [inline, setInline] = createSignal(true);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><OrderDrawer id="a" inline={inline()} /></ConnectedProjectContext.Provider>);
  await waitFor(() => expect(mounted.app.calls.some(call => call.method === "agent.spawnPrompt")).toBe(true));
  await cycle(view.container, () => setInline(false), () => setInline(true));
  setInline(false);
  fireEvent.click(within(view.container).getByRole("button", { name: "Edit order" }));
  expect(within(view.container.querySelector<HTMLElement>(".order-edit")!).getByRole("alert").textContent).toContain(FAILURE);
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Order editor", async () => {
  const mounted = await mountTodos([], true, [agent("a", "working", "building", { work: { kind: "work", ask: "Ship", limits: [] } })]);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><OrderDrawer id="a" /></ConnectedProjectContext.Provider>);
  fireEvent.click(within(view.container).getByRole("button", { name: "Edit order" }));
  const ask = await within(view.container).findByLabelText<HTMLTextAreaElement>("Ask");
  fireEvent.input(ask, { target: { value: "Changed ask" } });
  mounted.app.handlers["agent.setOrder"] = () => { throw new RpcError(-32003, FAILURE); };

  await cycle(view.container,
    () => fireEvent.click(within(view.container).getByRole("button", { name: "Save" })),
    async () => {
      const reply = gate<ReturnType<typeof agent>>();
      mounted.app.handlers["agent.setOrder"] = () => reply.promise;
      fireEvent.click(within(view.container).getByRole("button", { name: "Save" }));
      const submitted = mounted.connected.drafts.list().find(draft => draft.value.ask === "Changed ask")!;
      // A newer revision keeps the editor and its reserved place mounted after acknowledgement.
      fireEvent.input(ask, { target: { value: "  Newer unsent ask 🧭\n" } });
      reply.resolve(agent("a", "working", "building", { work: { kind: "work", ask: "Changed ask", limits: [] } }));
      await waitFor(() => expect(mounted.connected.drafts.list().some(draft => draft.revision === submitted.revision)).toBe(false));
    });
  expect(within(view.container).getByLabelText<HTMLTextAreaElement>("Ask").value).toBe("  Newer unsent ask 🧭\n");
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Decision cards", async () => {
  const mounted = await mountTodos([]);
  const [failure, setFailure] = createSignal(false);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><DecisionCard decision={decision("d", "a", failure() ? { failure: { attempt: "1", failed_at: 0, error_code: -32003, answered_by: USER, message: FAILURE } } : {})} name="alpha" focusTerminal={() => {}} ref={() => {}} onFocusIn={() => {}} onFocusOut={() => {}} /></ConnectedProjectContext.Provider>);
  await cycle(view.container, () => setFailure(true), () => setFailure(false));
});

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
  const { app, connected } = await mountControl(() => ({ files: [] }));
  fireEvent.click(within(document.body).getByRole("button", { name: "roundup/a" }));
  const surface = await within(document.body).findByRole("dialog", { name: "Worktree" });
  await within(surface).findByText("No changes");
  const original = app.handlers["agent.worktreeState"]!;
  await cycle(surface,
    async () => { app.handlers["agent.worktreeState"] = () => { throw new RpcError(-32003, FAILURE); };

 await connected.worktrees.refresh("a"); },
    async () => { app.handlers["agent.worktreeState"] = original; await connected.worktrees.refresh("a"); });
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: importer Looking and failure", async () => {
  const mounted = await mountTodos([]);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><ImportPanel open opener={undefined} onClose={() => {}} /></ConnectedProjectContext.Provider>);
  const surface = await within(document.body).findByRole("dialog");
  const read = gate<{ candidates: []; excluded: [] }>();
  mounted.app.handlers["project.importDiscover"] = () => read.promise;
  await cycle(surface, () => { void mounted.connected.importing.refresh(); }, () => read.reject(new RpcError(-32003, FAILURE)), "Looking for conversations…");
  const places = placesOf(surface);
  const place = (await within(surface).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  mounted.app.handlers["project.importDiscover"] = () => new Promise(() => {});
  void mounted.connected.importing.refresh();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  unchanged(places, place);
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
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Keys /><Switcher onFailure={() => {}} onOpen={() => {}} /></ConnectedProjectContext.Provider>);
  leaderKey("KeyK");
  await within(document.body).findByRole("combobox");
  const surface = document.querySelector<HTMLElement>(".switcher")!;
  const places = placesOf(surface);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  fireEvent.input(within(surface).getByRole("combobox"), { target: { value: "retained search" } });
  const place = (await within(surface).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  storage.mockRestore();
  mounted.connected.drafts.retry();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  unchanged(places, place);
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: Pad drawer Saved", async () => {
  const { app } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  const surface = field.closest<HTMLElement>(".pad-body")!;
  app.handlers["pad.write"] = ({ text }) => padOf("notes", USER, text);
  await cycle(surface, () => { fireEvent.input(field, { target: { value: "new" } }); fireEvent.focusOut(field); },
    () => fireEvent.input(field, { target: { value: "another" } }), "Saved");
});

it("u3807_each_site_shows_its_message_in_the_reserved_line: Capture", async () => {
  const mounted = await mountTodos([]);
  render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Capture onFile={undefined} /></ConnectedProjectContext.Provider>);
  fireEvent.keyDown(document.body, { key: "T", code: "KeyT", metaKey: true, shiftKey: true });
  const surface = await within(document.body).findByRole("dialog");
  const field = within(surface).getByRole("textbox");
  fireEvent.input(field, { target: { value: "held capture" } });
  const places = placesOf(surface);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  fireEvent.input(field, { target: { value: "retained capture" } });
  const place = (await within(surface).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  storage.mockRestore();
  mounted.connected.drafts.retry();
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  unchanged(places, place);
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: BulkDelete", async () => {
  let failure: string | null = FAILURE;

  const Site = () => {
    const [selected, setSelected] = createSignal<readonly number[]>([1]);

    const bulk = createBulkDelete({ app: createFakeApp(), selected, targets: () => [{ id: 1, label: "Ship" }], context: () => "p", noun: "Todos",
      replace: setSelected, clear: () => setSelected([]), cancelSelection: () => setSelected([]), remove: async () => failure === null ? new Promise(() => {}) : failure, reload: async () => null });

    return <bulk.Bar />;
  };

  const view = render(() => <Site />);
  const surface = view.container;
  const places = placesOf(surface);
  fireEvent.click(within(surface).getByRole("button", { name: "Delete 1" }));
  await questionDialog();
  await answerQuestion(true);
  const alert = await within(surface).findByRole("alert");
  const place = alert.closest<HTMLElement>(".reserved-line")!;
  expect(alert.textContent).toContain(FAILURE);
  unchanged(places, place);
  // Keep one selected item so the bar remains mounted while its failure clears.
  fireEvent.click(within(surface).getByRole("button", { name: "Delete 1" }));
  await questionDialog();
  failure = null;
  await answerQuestion(true);
  await waitFor(() => expect(within(surface).queryByRole("alert")).toBeNull());
  unchanged(places, place);
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

it.each(["pane-failure", "decision-list failure"])("u3807_each_site_shows_its_message_in_the_reserved_line: Terminal %s", async site => {
  const mounted = await mountTodos([]);
  const [notice, setNotice] = createSignal<string | null>(null);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><Pane notice={notice()} createEmulator={fakeEmulators().factory} /></ConnectedProjectContext.Provider>);

  if (site === "pane-failure") await cycle(view.container, () => setNotice(FAILURE), () => setNotice(null));
  else {
    const original = mounted.app.handlers["decision.list"]!;
    await cycle(view.container,
      async () => { mounted.app.handlers["decision.list"] = () => { throw new RpcError(-32003, FAILURE); };

 mounted.connected.decisions.retryList(); },
      async () => { mounted.app.handlers["decision.list"] = original; mounted.connected.decisions.retryList(); });
  }
});


it("u3807_each_site_shows_its_message_in_the_reserved_line: Todo field recovery and retry", async () => {
  const mounted = await mountTodos([todo(1)]);
  const view = render(() => <ConnectedProjectContext.Provider value={mounted.connected}><TodoDraftRecovery object="1" active /></ConnectedProjectContext.Provider>);
  const places = placesOf(view.container);
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error(FAILURE); });
  mounted.connected.drafts.edit({ surface: "todos", object: "1", recipient: "title" }, { title: "retained" }, null, "ordinary");
  const place = (await within(view.container).findByRole("alert")).closest<HTMLElement>(".reserved-line")!;
  unchanged(places, place);
  storage.mockRestore();
  fireEvent.click(within(place).getByRole("button", { name: "Retry storage only" }));
  await waitFor(() => expect(within(view.container).queryByRole("alert")).toBeNull());
  unchanged(places, place);
});

it.each(["window", "Daemon exit", "Project"])("u3807_each_site_shows_its_message_in_the_reserved_line: App %s", async site => {
  const { app, container } = await mountApp();
  const surface = container.querySelector<HTMLElement>(".rail")!.parentElement!;

  if (site === "window") {
    app.windowTitleHandler = async () => { throw new Error(FAILURE); };

    await cycle(surface, () => select("harbor"), () => { app.windowTitleHandler = null; select("alpha"); });
  } else if (site === "Daemon exit") {
    const places = placesOf(surface);
    app.exitDaemon({ code: 1 });
    const message = await within(surface).findByText(/Daemon exited/);
    const place = message.closest<HTMLElement>(".reserved-line")!;
    unchanged(places, place);
    fireEvent.click(within(place).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(place.textContent).not.toContain("Daemon exited"));
    await within(surface).findByRole("button", { name: /Overview, Project root/ });
    expect(place.isConnected).toBe(true);
    expect(surface.querySelector(".reserved-line")).toBe(place);
  } else {
    const original = app.chooseProjectPath;
    await cycle(surface,
      () => { app.chooseProjectPath = async () => { throw new Error(FAILURE); };

 fireEvent.click(within(container).getByRole("button", { name: "Open a folder" })); },
      () => { app.chooseProjectPath = original; app.chooser.path = "/p"; fireEvent.click(within(container).getByRole("button", { name: "Open a folder" })); });
  }
});
