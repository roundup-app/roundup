import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event, info } from "../testing/nodes";
import { bubbleCalls, bubbleChord, mountBubbles, TERMINALS } from "./bubblesFixture";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });

afterEach(cleanup);

const tab = (id: string) => document.querySelector<HTMLButtonElement>(`button.terminal-tab[data-bubble="${id}"]`);

const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input");

const edit = async (id: string) => {
  fireEvent.dblClick(tab(id)!.querySelector(".terminal-tab-name")!);
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
  fireEvent.input(field()!, { target: { value: "  build  " } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  await waitFor(() => expect(tab("2")).not.toBeNull());
  expect(tab("2")!.getAttribute("aria-label")).toBe("build");
  expect(tab("2")!.hasAttribute("title")).toBe(false);
  fireEvent.keyDown(document, { key: "Tab" });
  tab("2")!.focus();
  expect((await screen.findByRole("tooltip")).textContent).toBe("build");
  width.mockRestore();
  expect(tab("2")!.textContent).toContain("build");
  expect(document.querySelector('[aria-label="Close build"]')).not.toBeNull();
  expect(document.querySelector('.bubble[data-bubble="2"] .bubble-name')?.textContent).toBe("build");
  expect(tab("1")!.getAttribute("aria-label")).toBe("cargo test");
});

it("u511a_enter_commits_once", async () => {
  await mountBubbles();
  await edit("2");

  const writes = vi.spyOn(Storage.prototype, "setItem");

  fireEvent.input(field()!, { target: { value: "build" } });
  fireEvent.keyDown(field()!, { key: "Enter" });
  fireEvent.blur(field() ?? document.body);
  await waitFor(() => expect(field()).toBeNull());
  expect(writes.mock.calls.filter(([, value]) => String(value).includes("build"))).toHaveLength(1);
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

  other.focus();
  fireEvent.blur(field()!);
  await waitFor(() => expect(field()).toBeNull());
  expect(document.activeElement).toBe(other);
});

it("u511a_escape_then_blur_keeps_the_previous_name", async () => {
  await mountBubbles();
  await edit("2");
  fireEvent.input(field()!, { target: { value: "other" } });
  fireEvent.keyDown(field()!, { key: "Escape" });
  await waitFor(() => expect(tab("2")).not.toBeNull());
  expect(tab("2")!.getAttribute("aria-label")).toBe("zsh");
  expect(document.querySelector('.bubble[data-bubble="2"] .bubble-name')?.textContent).toBe("zsh");
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
  fireEvent.pointerDown(tab("1")!);
  fireEvent.blur(field()!);
  await waitFor(() => expect(tab("2")?.getAttribute("aria-label")).toBe("kept"));
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
  await mountBubbles();
  fireEvent.contextMenu(tab("2")!, { clientX: 10, clientY: 10 });
  await waitFor(() => expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("Rename"));
  fireEvent.click(document.querySelector('[role="menuitem"]')!);
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
