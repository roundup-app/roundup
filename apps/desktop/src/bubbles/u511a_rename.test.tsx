import { copy as recoveryCopy } from "../sharedCopy";
import { flush } from "solid-js";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDrafts } from "../state/connectedProject";
import { storageIdle } from "../state/storage";
import { event, info } from "../testing/nodes";
import { bubbleCalls, bubbleChord, mountBubbles, TERMINALS } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tab = (id: string) => document.querySelector<HTMLButtonElement>(`button.terminal-tab[data-bubble="${id}"]`);

const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input");

const edit = async (id: string) => {
  flush();
  fireEvent.dblClick(tab(id)!);
  flush();
  await waitFor(() => expect(field()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

it("u511a_double_click_selects_the_current_name", async () => {
  await mountBubbles();
  await edit("2");
  expect(field()!.value).toBe("zsh");
  await waitFor(() => expect([field()!.selectionStart, field()!.selectionEnd]).toEqual([0, 3]));
  expect(document.querySelector(".terminal-tab-editor button")).toBeNull();
});

it("u511a_every_name_surface_updates", async () => {
  const width = vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(100);
  await mountBubbles();
  await edit("2");
  const name = "  build  ";
  fireEvent.input(field()!, { target: { value: name } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")!.getAttribute("aria-label")).toBe(name.trim()));
  expect(tab("2")!.getAttribute("aria-label")).toBe(name.trim());
  expect(tab("2")!.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document, { key: "Tab" });
  flush();
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
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  fireEvent.blur(field() ?? document.body);
  flush();
  await waitFor(() => expect(field()).toBeNull());
  await waitFor(() => expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toHaveLength(1));
  writes.mockRestore();
});

it("u511a_completion_preserves_expected_focus", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Escape" });
  flush();
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  await edit("2");

  const other = tab("1")!;
  const input = field()!;

  other.focus();
  fireEvent.blur(input);
  flush();
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
    flush();
    await mounted.app.pickMenu("Rename");
    await waitFor(() => expect(document.activeElement).toBe(field()));
  }

  const input = field()!;
  const exact = "  e\u0301 🪁 雪\t  ";
  fireEvent.input(input, { target: { value: exact } });
  flush();
  input.setSelectionRange(2, 6, "backward");
  fireEvent.select(input);
  flush();
  const writes = vi.spyOn(Storage.prototype, "setItem");
  const calls = [...mounted.app.calls];
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(input, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  fireEvent.blur(input);
  flush();
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
  flush();
  await waitFor(() => expect(field()).toBeNull());
  expect(mounted.connected.drafts.list()).toEqual(retained);
  expect(writes.mock.calls.filter(([key]) => key === "roundup:bubble-places:/p")).toEqual([]);
  expect(mounted.app.calls).toEqual(calls);
});

it("u511a_empty_restores_the_default", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  await edit("2");
  fireEvent.input(field()!, { target: { value: "   " } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("zsh"));
  expect(window.sessionStorage.getItem(window.sessionStorage.key(0)!)).not.toContain("name");
});

it("u511a_unchanged_closes_without_writing", async () => {
  await mountBubbles();
  const before = JSON.stringify({ ...window.sessionStorage });
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(field()).toBeNull());
  expect(JSON.stringify({ ...window.sessionStorage })).toBe(before);
});

it("u511a_click_away_commits_before_the_target_action", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "kept" } });
  flush();
  const pressed = tab("1")!.getAttribute("aria-pressed");
  fireEvent.pointerDown(tab("1")!);
  flush();
  tab("1")!.focus();
  fireEvent.click(tab("1")!);
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
  await waitFor(() => expect(tab("1")!.getAttribute("aria-pressed")).not.toBe(pressed));
});

it("u511a_window_blur_commits_a_changed_name_and_leaves_an_untouched_one_open", async () => {
  await mountBubbles();
  await edit("2");
  window.dispatchEvent(new Event("blur"));
  expect(field()).not.toBeNull();
  fireEvent.input(field()!, { target: { value: "away" } });
  flush();
  window.dispatchEvent(new Event("blur"));
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("away"));
  expect(field()).toBeNull();
});

it("u511a_edit_entry_preserves_terminal_visibility", async () => {
  await mountBubbles();
  const before = [...document.querySelectorAll(".terminal-tab")].map(node => node.getAttribute("aria-pressed"));
  fireEvent.click(tab("2")!.querySelector(".terminal-tab-name")!);
  flush();
  await waitFor(() => expect(tab("2")!.getAttribute("aria-pressed")).toBe("false"));
  fireEvent.click(tab("2")!.querySelector(".terminal-tab-name")!);
  flush();
  await waitFor(() => expect(tab("2")!.getAttribute("aria-pressed")).toBe("true"));
  await edit("2");
  fireEvent.keyDown(field()!, { key: "Escape" });
  flush();
  await waitFor(() => expect(tab("2")).not.toBeNull());
  expect([...document.querySelectorAll(".terminal-tab")].map(node => node.getAttribute("aria-pressed"))).toEqual(before);
});

it("u511a_name_survives_selection_and_webview_reload", async () => {
  const first = await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "kept" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
  first.connected.rail.select("b");
  flush();
  first.connected.rail.select("a");
  flush();
  expect(tab("2")?.getAttribute("aria-label")).toBe("kept");
  cleanup();
  await mountBubbles();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
});

it("u511a_context_rename_uses_the_same_editor", async () => {
  const { app } = await mountBubbles();
  fireEvent.contextMenu(tab("2")!, { clientX: 10, clientY: 10 });
  flush();
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
  flush();
  expect(press.defaultPrevented).toBe(false);
  expect(bubbleCalls(mounted.app, "terminal.open")).toEqual([]);
  expect(bubbleCalls(mounted.app, "terminal.write")).toEqual([]);
});

it("u511a_composition_enter_keeps_editing", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "かな" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter", isComposing: true });
  flush();
  expect(field()).not.toBeNull();
  expect(tab("2")).toBeNull();
});

it("u511a_duplicate_names_are_independent", async () => {
  await mountBubbles("a", [info("1", { owner: "a", title: "zsh" }), info("2", { owner: "w", title: "zsh" })]);
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
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
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("build"));
  retitle("vim");
  await waitFor(() => expect(mounted.connected.rail.terminals().find((terminal) => terminal.id === "2")?.title).toBe("vim"));
  expect(tab("2")!.getAttribute("aria-label")).toBe("build");
  await edit("2");
  fireEvent.input(field()!, { target: { value: "" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("vim"));
  retitle("htop");
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("htop"));
});

it("u511a_closed_or_restarted_terminals_do_not_inherit_names", async () => {
  const mounted = await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "build" } });
  flush();
  fireEvent.keyDown(field()!, { key: "Enter" });
  flush();
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
  flush();
  field()!.setSelectionRange(2, 5, "backward");
  fireEvent.select(field()!);
  flush();
  fireEvent.keyDown(field()!, { key: "Escape" });
  flush();
  await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  mounted.connected.rail.select("other");
  flush();
  mounted.connected.rail.select("a");
  flush();
  await edit("2");
  expect(field()!.value).toBe(text);
  expect([field()!.selectionStart, field()!.selectionEnd, field()!.selectionDirection]).toEqual([2, 5, "backward"]);
  mounted.connected.rail.select("other");
  flush();
  await waitFor(() => expect(field()).toBeNull());
  mounted.connected.rail.select("a");
  flush();
  expect(field()).toBeNull();
  await edit("2");
  expect(field()!.value).toBe(text);
  fireEvent.keyDown(field()!, { key: "Escape" });
  flush();
  cleanup();
  const restored = await mountBubbles();
  await edit("2");
  expect(field()!.value).toBe(text);
  expect(bubbleCalls(restored.app, "terminal.write")).toEqual([]);
  expect(tab("1")!.getAttribute("aria-label")).toBe("cargo test");
});

