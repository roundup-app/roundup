import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDrafts } from "../state/connectedProject";
import { event, info } from "../testing/nodes";
import { bubbleCalls, bubbleChord, mountBubbles, TERMINALS } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tab = (id: string) => document.querySelector<HTMLButtonElement>(`button.terminal-tab[data-bubble="${id}"]`);

const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input");

const edit = async (id: string) => {
  fireEvent.dblClick(tab(id)!);
  await waitFor(() => expect(field()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

it("u511a_double_click_selects_the_current_name", async () => {
  await mountBubbles();
  await edit("2");
  expect(field()!.value).toBe("zsh");
  expect([field()!.selectionStart, field()!.selectionEnd]).toEqual([0, 3]);
  expect(document.querySelector(".terminal-tab-editor button")).toBeNull();
});

it("u511a_every_name_surface_updates", async () => {
  const width = vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(100);
  await mountBubbles();
  await edit("2");
  const name = "  build  ";
  fireEvent.input(field()!, { target: { value: name } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")!.getAttribute("aria-label")).toBe(name.trim()));
  expect(tab("2")!.getAttribute("aria-label")).toBe(name.trim());
  expect(tab("2")!.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document, { key: "Tab" });
  tab("2")!.focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe(name.trim());
  width.mockRestore();
  expect(tab("2")!.textContent).toContain(name.trim());
  expect(document.querySelector('[aria-label="Close build"]')).not.toBeNull();
  expect(document.querySelector('.bubble[data-bubble="2"] .bubble-name')?.textContent).toBe(name.trim());
  expect(tab("1")!.getAttribute("aria-label")).toBe(TERMINALS[0]!.title);
});

it("u511a_enter_commits_once", async () => {
  await mountBubbles();
  await edit("2");

  const writes = vi.spyOn(Storage.prototype, "setItem");

  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  fireEvent.blur(field() ?? document.body);
  await waitFor(() => expect(field()).toBeNull());
  await waitFor(() => expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toHaveLength(1));
  writes.mockRestore();
});

it("u511a_completion_preserves_expected_focus", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  await edit("2");

  const other = tab("1")!;
  const input = field()!;

  other.focus();
  fireEvent.blur(input);
  await waitFor(() => expect(field()).toBeNull());
  expect(document.activeElement).toBe(other);
});

// Production rename openings: tab double-click and native context-menu Rename.
// Selected-revision recovery is exercised separately below with its captured identity.
it.each(["double-click", "native Rename"] as const)("u3787c_escape_restores_the_name_terminal_%s", async opening => {
  const mounted = await mountBubbles();
  const saved = tab("2")!.getAttribute("aria-label");
  const visibility = [...document.querySelectorAll("button.terminal-tab")].map(control => control.getAttribute("aria-pressed"));
  tab("2")!.focus();

  if (opening === "double-click") await edit("2");
  else {
    fireEvent.contextMenu(tab("2")!);
    await mounted.app.pickMenu("Rename");
    await waitFor(() => expect(document.activeElement).toBe(field()));
  }

  const input = field()!;
  const exact = "  e\u0301 🪁 雪\t  ";
  fireEvent.input(input, { target: { value: exact } });
  input.setSelectionRange(2, 6, "backward");
  fireEvent.select(input);
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const calls = [...mounted.app.calls];
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(input, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  fireEvent.blur(input);
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  expect(tab("2")!.getAttribute("aria-label")).toBe(saved);
  expect([...document.querySelectorAll("button.terminal-tab")].map(control => control.getAttribute("aria-pressed"))).toEqual(visibility);
  expect(underlying).not.toHaveBeenCalled();
  expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toEqual([]);
  expect(mounted.app.calls).toEqual(calls);
  const retained = mounted.connected.drafts.list();
  expect(retained).toEqual([expect.objectContaining({ destination: { surface: "bubbles", object: TERMINALS[1]!.incarnation, recipient: "2" },
    value: { name: exact, base: "zsh" }, selection: { start: 2, end: 6, direction: "backward" }, status: "draft" })]);
  await edit("2");
  expect([field()!.value, field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([exact, 2, 6, "backward"]);
  fireEvent.blur(field()!);
  await waitFor(() => expect(field()).toBeNull());
  expect(mounted.connected.drafts.list()).toEqual(retained);
  expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toEqual([]);
  expect(mounted.app.calls).toEqual(calls);
});

it("u511a_empty_restores_the_default", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  await edit("2");
  fireEvent.input(field()!, { target: { value: "   " } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("zsh"));
  expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).not.toContain("name");
});

it("u511a_unchanged_closes_without_writing", async () => {
  await mountBubbles();
  const before = JSON.stringify({ ...window.sessionStorage });
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(field()).toBeNull());
  expect(JSON.stringify({ ...window.sessionStorage })).toBe(before);
});

it("u511a_click_away_commits_before_the_target_action", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "kept" } });
  const pressed = tab("1")!.getAttribute("aria-pressed");
  fireEvent.pointerDown(tab("1")!);
  tab("1")!.focus();
  fireEvent.click(tab("1")!);
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
  await waitFor(() => expect(tab("1")!.getAttribute("aria-pressed")).not.toBe(pressed));
});

it("u511a_edit_entry_preserves_terminal_visibility", async () => {
  await mountBubbles();
  const before = [...document.querySelectorAll(".terminal-tab")].map(node => node.getAttribute("aria-pressed"));
  fireEvent.click(tab("2")!.querySelector(".terminal-tab-name")!);
  fireEvent.click(tab("2")!.querySelector(".terminal-tab-name")!);
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Escape" });
  await waitFor(() => expect(tab("2")).not.toBeNull());
  expect([...document.querySelectorAll(".terminal-tab")].map(node => node.getAttribute("aria-pressed"))).toEqual(before);
});

it("u511a_name_survives_selection_and_webview_reload", async () => {
  const first = await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "kept" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
  first.connected.rail.select("b");
  first.connected.rail.select("a");
  expect(tab("2")?.getAttribute("aria-label")).toBe("kept");
  cleanup();
  await mountBubbles();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
});

it("u511a_context_rename_uses_the_same_editor", async () => {
  const { app } = await mountBubbles();
  fireEvent.contextMenu(tab("2")!, { clientX: 10, clientY: 10 });
  await app.pickMenu("Rename");
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect(field()!.value).toBe("zsh");
  expect(document.querySelector(".terminal-tab-editor button")).toBeNull();
});

it("u511a_editing_keys_do_not_reach_the_terminal", async () => {
  const mounted = await mountBubbles();
  await edit("2");
  const press = bubbleChord("t", {}, field()!);
  fireEvent.keyDown(field()!, { key: "a" });
  expect(press.defaultPrevented).toBe(false);
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
});

it("u511a_composition_enter_keeps_editing", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "かな" } });
  fireEvent.keyDown(field()!, { key: "Enter", isComposing: true });
  expect(field()).not.toBeNull();
  expect(tab("2")).toBeNull();
});

it("u511a_duplicate_names_are_independent", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "zsh" }), info("2", { owner: "w", title: "zsh" })]);
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  expect(tab("1")!.getAttribute("aria-label")).toBe("zsh");
});

it("u511a_custom_name_survives_title_updates", async () => {
  const mounted = await mountBubbles();

  const retitle = (title: string) => {
    mounted.setListed(TERMINALS.map((terminal) => (terminal.id === "2" ? { ...terminal, title } : terminal)));
    mounted.app.emit(event({ name: "terminal.changed" }));
  };

  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  retitle("vim");
  await waitFor(() => expect(mounted.connected.rail.terminals().find((terminal) => terminal.id === "2")?.title).toBe("vim"));
  expect(tab("2")!.getAttribute("aria-label")).toBe("build");
  await edit("2");
  fireEvent.input(field()!, { target: { value: "" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("vim"));
  retitle("htop");
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("htop"));
});

it("u511a_closed_or_restarted_terminals_do_not_inherit_names", async () => {
  const mounted = await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  mounted.setListed(TERMINALS.filter((terminal) => terminal.id !== "2"));
  mounted.app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(tab("2")).toBeNull());
  mounted.setListed(TERMINALS);
  mounted.app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("zsh"));
});


it("u2773a_bubbles_restores_exact_work", async () => {
  const mounted = await mountBubbles();
  await edit("2");
  const text = "  e\u0301 🫧 draft  ";
  fireEvent.input(field()!, { target: { value: text } });
  field()!.setSelectionRange(2, 5, "backward");
  fireEvent.select(field()!);
  fireEvent.keyDown(field()!, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  mounted.connected.rail.select("other");
  mounted.connected.rail.select("a");
  await edit("2");
  expect(field()!.value).toBe(text);
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 5, "backward"]);
  mounted.connected.rail.select("other");
  await waitFor(() => expect(field()).toBeNull());
  mounted.connected.rail.select("a");
  expect(field()).toBeNull();
  await edit("2");
  expect(field()!.value).toBe(text);
  fireEvent.keyDown(field()!, { key: "Escape" });
  cleanup();
  const restored = await mountBubbles();
  await edit("2");
  expect(field()!.value).toBe(text);
  expect(bubbleCalls(restored.app, "terminal.write")).toEqual([]);
  expect(tab("1")!.getAttribute("aria-label")).toBe("cargo test");
});


it("u2773b_bubbles_settlement_preserves_other_revisions", async () => {
  const mounted = await mountBubbles();
  const write = Storage.prototype.setItem;

  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "roundup:bubble-places:/p") throw new Error("name write refused");

    return write.call(this, key, value);
  });

  await edit("2");
  fireEvent.input(field()!, { target: { value: "  failed A 雪  " } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  const recovery = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(mounted.connected.drafts.list().some(draft => draft.status === "failed")).toBe(true);
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  blocked.mockRestore();
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  await edit("2");
  fireEvent.input(field()!, { target: { value: "  newer B 🫧  " } });
  fireEvent.keyDown(field()!, { key: "Escape" });
  expect(mounted.connected.drafts.list().map(draft => [draft.value.name, draft.status])).toEqual([["  failed A 雪  ", "failed"], ["  newer B 🫧  ", "draft"]]);
  await waitFor(() => expect(tab("2")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const revisions = await screen.findByRole("dialog", { name: "Unfinished work" });

  fireEvent.click(within(revisions).getByRole("button", { name: /^Inspect · Failed/ }));
  fireEvent.click(within(revisions).getByRole("button", { name: "Close" }));
  await edit("2");
  expect(field()!.value).toBe("  newer B 🫧  ");
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")!.getAttribute("aria-label")).toBe("newer B 🫧"));
  expect(mounted.connected.drafts.list().map(draft => [draft.value.name, draft.status])).toEqual([["  failed A 雪  ", "failed"]]);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  await waitFor(() => expect(createProjectDrafts()("/p").list().map(draft => draft.value.name)).toEqual(["  failed A 雪  "]));
  cleanup();
  const reloaded = await mountBubbles();
  expect(reloaded.connected.drafts.list().map(draft => draft.value.name)).toEqual(["  failed A 雪  "]);
  await edit("2");
  fireEvent.input(field()!, { target: { value: "  retained C 雪  " } });
  fireEvent.keyDown(field()!, { key: "Escape" });
  await waitFor(() => expect(tab("2")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const selected = await screen.findByRole("dialog", { name: "Unfinished work" });

  fireEvent.click(within(selected).getByRole("button", { name: /^Inspect · Failed/ }));
  fireEvent.click(within(selected).getByRole("button", { name: "Discard this revision" }));
  expect(reloaded.connected.drafts.list().map(draft => draft.value.name)).toEqual(["  retained C 雪  "]);
});

it("u2773c_bubbles_external_change_keeps_original", async () => {
  const mounted = await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "  original e\u0301 🫧  " } });
  mounted.setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, title: "external" } : terminal));
  mounted.app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(mounted.connected.rail.terminals().find(terminal => terminal.id === "2")!.title).toBe("external"));
  expect(field()!.value).toBe("  original e\u0301 🫧  ");
  fireEvent.keyDown(field()!, { key: "Enter" });
  const recovery = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(recovery).getByText(/original name changed/)).toBeDefined();
  expect(tab("2")!.getAttribute("aria-label")).toBe("external");
  mounted.setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, incarnation: "replacement" } : terminal));
  mounted.app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(within(recovery).getByText("Original object unavailable")).toBeDefined());
  expect(mounted.connected.drafts.list()[0]!.destination).toEqual({ surface: "bubbles", object: TERMINALS[1]!.incarnation, recipient: "2" });
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
  fireEvent.click(within(recovery).getByRole("button", { name: "Close" }));
  await edit("2");
  expect(field()!.value).toBe("zsh");
  fireEvent.keyDown(field()!, { key: "Escape" });
});

it("u2773e_recovery_actions_keep_surface_draft_bubbles", async () => {
  const mounted = await mountBubbles();
  const write = Storage.prototype.setItem;

  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith("roundup:drafts:")) throw new Error("draft storage refused");

    return write.call(this, key, value);
  });

  const text = "  recover e\u0301 🪁  ";
  await edit("2");
  fireEvent.input(field()!, { target: { value: text } });
  fireEvent.keyDown(field()!, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const recovery = await screen.findByRole("dialog", { name: "Unfinished work" });
  await within(recovery).findByRole("alert");
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(mounted.app, "clipboardWrite").mockImplementation(clipboard);
  fireEvent.click(within(recovery).getByRole("button", { name: "Copy name" }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledExactlyOnceWith(text));
  blocked.mockRestore();
  fireEvent.click(within(recovery).getByRole("button", { name: "Retry storage only" }));
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem("roundup:drafts:/p")!).drafts[0].value.name).toBe(text));
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  fireEvent.click(within(recovery).getByRole("button", { name: "Discard this revision" }));
  expect(mounted.connected.drafts.list()).toEqual([]);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
});


const selectedBubbles = async (outcome: "failed" | "unknown" = "failed") => {
  const mounted = await mountBubbles("a", TERMINALS.map(terminal => ({ ...terminal, title: "zsh" })));
  const drafts = mounted.connected.drafts;
  const destination = { surface: "bubbles", object: TERMINALS[1]!.incarnation, recipient: "2" };

  const a = drafts.edit(destination, { name: "  A e\u0301 🫧 雪  ", base: "zsh" },
    { start: 2, end: 7, direction: "backward" }, "ordinary").draft;

  await drafts.submit(a.revision);
  await drafts.settle(a.revision, outcome);

  const retained = drafts.edit(destination, { name: "  B 雪  ", base: "zsh" },
    { start: 1, end: 4, direction: "forward" }, "ordinary");

  await retained.retained;
  const b = retained.draft;

  const open = (revision: string, project = "/p") => mounted.recover({ project, revision });

  return { ...mounted, drafts, destination, a: drafts.list().find(draft => draft.revision === a.revision)!, b, open };
};

it("u3787c_escape_restores_the_name_selected_terminal_recovery", async () => {
  const { app, drafts, a, b, open } = await selectedBubbles();
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  const input = field()!;
  const exact = "  recovery e\u0301 🪁 雪\t  ";
  fireEvent.input(input, { target: { value: exact } });
  input.setSelectionRange(3, 8, "backward");
  fireEvent.select(input);
  const before = drafts.list();
  const retained = before.find(draft => draft.value.name === exact)!;
  const calls = [...app.calls];
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(input, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  fireEvent.blur(input);
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  expect(underlying).not.toHaveBeenCalled();
  expect(retained.destination).toEqual(a.destination);
  expect(retained.selection).toEqual({ start: 3, end: 8, direction: "backward" });
  open(retained.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect([field()!.value, field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([exact, 3, 8, "backward"]);
  fireEvent.blur(field()!);
  await waitFor(() => expect(field()).toBeNull());
  expect(drafts.list()).toEqual(before);
  expect(drafts.list()).toContainEqual(a);
  expect(drafts.list()).toContainEqual(b);
  expect(app.calls).toEqual(calls);
  expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toEqual([]);
});

it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_bubbles_%s", async outcome => {
  const { app, drafts, a, b, open, connected } = await selectedBubbles(outcome);
  const before = drafts.list();
  const calls = [...app.calls];
  const writes = vi.spyOn(Storage.prototype, "setItem");
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect(field()).not.toBeNull();
  expect([field()!.value, field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection])
    .toEqual([a.value.name, 2, 7, "backward"]);
  field()!.focus();
  fireEvent.blur(field()!);
  await waitFor(() => expect(field()).toBeNull());
  open(b.revision);
  await waitFor(() => expect(field()?.value).toBe(b.value.name));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([1, 4, "forward"]);
  connected.rail.select("other");
  await waitFor(() => expect(field()).toBeNull());
  expect(drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
});

it.each(["failed", "unknown"] as const)("u3021c_bubbles_editing_selected_revision_keeps_current_work_%s", async outcome => {
  const { app, drafts, a, b, open } = await selectedBubbles(outcome);
  const calls = [...app.calls];
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.input(field()!, { target: { value: "  edited A 🧭  " } });
  field()!.setSelectionRange(1, 6, "backward");
  fireEvent.select(field()!);
  fireEvent.blur(field()!);
  await waitFor(() => expect(field()).toBeNull());
  const edited = drafts.list().find(draft => draft.value.name === "  edited A 🧭  ")!;
  expect(edited.selection).toEqual({ start: 1, end: 6, direction: "backward" });
  expect(drafts.list()).toContainEqual(a);
  expect(drafts.list()).toContainEqual(b);
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  await edit("2");
  expect([field()!.value, field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection])
    .toEqual([b.value.name, 1, 4, "forward"]);
  open(edited.revision);
  await waitFor(() => expect(field()?.value).toBe("  edited A 🧭  "));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([1, 6, "backward"]);
  fireEvent.keyDown(field()!, { key: "Escape" });
  expect(app.calls).toEqual(calls);
  cleanup();
  const reopened = await mountBubbles();

  await edit("2");
  expect([field()!.value, field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection])
    .toEqual([b.value.name, 1, 4, "forward"]);
  reopened.recover({ project: "/p", revision: edited.revision });
  await waitFor(() => expect(field()?.value).toBe("  edited A 🧭  "));
  await waitFor(() => expect(document.activeElement).toBe(field()));
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([1, 6, "backward"]);
});

it.each(["acknowledged", "failed"] as const)("u3021c_bubbles_confirmation_settles_only_submitted_edit_%s", async outcome => {
  const { drafts, a, b, open } = await selectedBubbles();
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.input(field()!, { target: { value: "edited A" } });
  const submitted = drafts.list().find(draft => draft.value.name === "edited A")!;
  const write = Storage.prototype.setItem;

  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (outcome === "failed" && key === "roundup:bubble-places:/p") throw new Error("name write refused");

    return write.call(this, key, value);
  });

  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(drafts.list().find(draft => draft.revision === submitted.revision)?.status)
    .toBe(outcome === "acknowledged" ? undefined : "failed"));
  expect(tab("2")!.getAttribute("aria-label")).toBe(outcome === "acknowledged" ? "edited A" : "zsh");
  expect(writes.mock.calls.filter(([key, value]) => key === "roundup:bubble-places:/p" && JSON.parse(value)["2"]?.name === "edited A")).toHaveLength(1);
  expect(drafts.list()).toContainEqual(a);
  expect(drafts.list()).toContainEqual(b);
  writes.mockRestore();
});

it("u3021c_bubbles_selected_edit_keeps_captured_base_conflict_refusal", async () => {
  const { app, drafts, a, b, open, setListed, connected } = await selectedBubbles();
  setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, title: "external" } : terminal));
  app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(connected.rail.terminals().find(terminal => terminal.id === "2")!.title).toBe("external"));
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.input(field()!, { target: { value: "my edit" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  const recovery = await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(within(recovery).getByText(/original name changed/)).toBeDefined();
  expect(tab("2")!.getAttribute("aria-label")).toBe("external");
  expect(drafts.list().find(draft => draft.value.name === "my edit")?.value.base).toBe("zsh");
  expect(drafts.list()).toContainEqual(b);
});

it("u3021c_bubbles_unknown_acceptance_is_never_retried_unchanged", async () => {
  const { app, drafts, a, open } = await selectedBubbles("unknown");
  const before = drafts.list();
  const calls = [...app.calls];
  const writes = vi.spyOn(Storage.prototype, "setItem");
  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.keyDown(field()!, { key: "Enter" });
  await screen.findByRole("dialog", { name: "Unfinished work" });
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  expect(drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  expect(writes.mock.calls.filter(([key, value]) => key === "roundup:bubble-places:/p" && JSON.parse(value)["2"]?.name !== undefined)).toEqual([]);
  writes.mockRestore();
});

it.each(["project", "object", "recipient", "surface", "pending", "missing-base", "missing-revision"] as const)("u3021c_bubbles_refuses_selected_revision_with_wrong_authority_%s", async mismatch => {
  const { app, drafts, destination, a, open } = await selectedBubbles();

  const wrong = drafts.edit({ ...destination,
    object: mismatch === "object" ? TERMINALS[0]!.incarnation : destination.object,
    recipient: mismatch === "recipient" ? "1" : destination.recipient,
    surface: mismatch === "surface" ? "header" : "bubbles" },
    mismatch === "missing-base" ? { name: "zsh" } : { name: "zsh", base: "zsh" }, null, "ordinary", null).draft;

  if (mismatch === "pending") drafts.submit(wrong.revision);
  const before = drafts.list();
  const calls = [...app.calls];
  open(mismatch === "project" ? a.revision : mismatch === "missing-revision" ? "absent" : wrong.revision,
    mismatch === "project" ? "/other" : "/p");
  expect(field()).toBeNull();
  expect(drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});

it.each(["stopped", "removed", "replaced", "daemon-exited"] as const)("u3021c_bubbles_refuses_unavailable_original_%s", async unavailable => {
  const { app, drafts, a, open, setListed, connected, setExit } = await selectedBubbles();

  if (unavailable === "daemon-exited") setExit({ code: 1 });
  else {
    setListed(unavailable === "removed" ? TERMINALS.filter(terminal => terminal.id !== "2")
      : TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal,
        running: unavailable !== "stopped", incarnation: unavailable === "replaced" ? "new-original" : terminal.incarnation } : terminal));
    app.emit(event({ name: "terminal.changed" }));

    if (unavailable === "removed") await waitFor(() => expect(connected.rail.terminals().find(terminal => terminal.id === "2")).toBeUndefined());
    else await waitFor(() => expect(connected.rail.terminals().find(terminal => terminal.id === "2")!)
      .toMatchObject(unavailable === "stopped" ? { running: false } : { incarnation: "new-original" }));
  }

  const before = drafts.list();
  const calls = [...app.calls];
  open(a.revision);
  expect(field()).toBeNull();
  expect(drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});


it("u3021c_copy_and_discard_keep_other_revisions_bubbles_after_reopen", async () => {
  const { drafts, a, b, setListed, app, connected } = await selectedBubbles();
  const other = createProjectDrafts()("/other");
  const elsewhere = other.edit(a.destination, { name: "other Project", base: "zsh" }, null, "ordinary").draft;

  setListed(TERMINALS.filter(terminal => terminal.id !== "2"));
  app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(connected.rail.terminals().some(terminal => terminal.id === "2")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });

  fireEvent.click(within(dialog).getByRole("button", { name: /^Inspect · Failed/ }));
  const clipboard = vi.fn().mockResolvedValue(undefined);

  vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledExactlyOnceWith("  A e\u0301 🫧 雪  "));
  fireEvent.click(within(dialog).getByRole("button", { name: "Discard this revision" }));
  expect(drafts.list()).toEqual([b]);
  await waitFor(() => expect(createProjectDrafts()("/p").list()).toEqual([b]));
  cleanup();
  const reopened = createProjectDrafts();

  expect(reopened("/p").list()).toEqual([b]);
  expect(reopened("/other").list()).toEqual([elsewhere]);
});


it("u3021c_bubbles_confirming_retained_failure_consumes_only_that_revision", async () => {
  const { drafts, a, b, open } = await selectedBubbles();

  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(field()).toBeNull());
  await waitFor(() => expect(tab("2")!.getAttribute("aria-label")).toBe(String(a.value.name).trim()));
  expect(drafts.list()).toEqual([b]);
});

it.each(["stopped", "removed", "replaced"] as const)("u3021c_bubbles_closes_recovered_editor_when_original_ends_%s", async unavailable => {
  const { drafts, a, b, open, setListed, app, connected } = await selectedBubbles();

  open(a.revision);
  await waitFor(() => expect(document.activeElement).toBe(field()));
  fireEvent.input(field()!, { target: { value: "  unsent edit 雪  " } });
  const before = drafts.list();

  setListed(unavailable === "removed" ? TERMINALS.filter(terminal => terminal.id !== "2")
    : TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal,
      running: unavailable !== "stopped", incarnation: unavailable === "replaced" ? "replacement" : terminal.incarnation } : terminal));
  app.emit(event({ name: "terminal.changed" }));
  await waitFor(() => expect(field()).toBeNull());
  expect(drafts.list()).toEqual(before);
  expect(drafts.list()).toContainEqual(b);

  if (unavailable === "replaced") {
    await waitFor(() => expect(connected.rail.terminals().find(terminal => terminal.id === "2")!.incarnation).toBe("replacement"));
    await edit("2");
    expect(field()!.value).toBe("zsh");
    fireEvent.keyDown(field()!, { key: "Enter" });
    expect(drafts.list()).toEqual(before);
  }
});
