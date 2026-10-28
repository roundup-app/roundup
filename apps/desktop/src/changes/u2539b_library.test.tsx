import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { treesLoaded } from "./ChangedTree";
import { mountControl } from "./harness";

afterEach(cleanup);

it("u2539b_the_library_loads_on_first_open", async () => {
  await mountControl();

  expect(treesLoaded()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));

  await waitFor(() => expect(document.querySelector("file-tree-container")).not.toBeNull());
  expect(treesLoaded()).toBe(true);
});

it("u2539b_file_names_announce_status_old_path_and_deleted_action", async () => {
  await mountControl(() => ({ files: [
    { path: "new.ts", from: "old.ts", status: "renamed", line: 1 },
    { path: "gone.ts", status: "deleted", line: null },
    { path: "added.ts", status: "added", line: 1 },
    { path: "modified.ts", status: "modified", line: 1 },
    { path: "untracked.ts", status: "untracked", line: 1 },
  ] }));
  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));

  await waitFor(() => {
    const root = document.querySelector("file-tree-container")?.shadowRoot;

    expect(root?.querySelector('[data-item-path="new.ts"]')?.getAttribute("aria-label")).toBe("new.ts, Renamed, old.ts → new.ts");
    expect(root?.querySelector('[data-item-path="gone.ts"]')?.getAttribute("aria-label")).toBe("gone.ts, Deleted, unavailable in editor");
    expect(root?.querySelector('[data-item-path="added.ts"]')?.getAttribute("aria-label")).toBe("added.ts, Added");
    expect(root?.querySelector('[data-item-path="modified.ts"]')?.getAttribute("aria-label")).toBe("modified.ts, Modified");
    expect(root?.querySelector('[data-item-path="untracked.ts"]')?.getAttribute("aria-label")).toBe("untracked.ts, Untracked");
  });
});

// Dependency probes deliberately bypass the App: #4396 owns mounted integration.
async function mountTree(options: Partial<import("@pierre/trees").FileTreeOptions> = {}) {
  const { FileTree } = await import("@pierre/trees");

  const tree = new FileTree({
    paths: ["folded/echo-hidden.ts", "alpha.ts", "bravo.ts", "charlie.ts", "delta.ts", "echo.ts"],
    initialExpansion: "closed",
    flattenEmptyDirectories: false,
    ...options,
  });

  const host = document.createElement("div");
  document.body.append(host);
  tree.render({ containerWrapper: host });
  const root = tree.getFileTreeContainer()?.shadowRoot;

  if (!root) throw new Error("Pierre did not mount its shadow root");

  const row = (path: string) => {
    const element = root.querySelector<HTMLButtonElement>(`[data-item-path="${path}"]`);

    if (!element) throw new Error(`Missing visible row: ${path}`);

    return element;
  };

  return { tree, root, row, close() { tree.cleanUp(); host.remove(); } };
}

it.each([
  { prefix: "ec", path: "echo.ts" },
  { prefix: "éC", path: "Écho.ts" },
  { prefix: "東京", path: "東京.ts" },
])("u3787c_vanilla_prefix_selects_a_visible_name_without_search_or_unfolding_$prefix", async ({ prefix, path }) => {
  const view = await mountTree({
    typeahead: "name-prefix", search: true,
    initialVisibleRowCount: 2, overscan: 0,
    paths: [`folded/${path}`, "alpha.ts", "bravo.ts", "charlie.ts", "delta.ts", path],
  });

  try {
    view.row("alpha.ts").focus();

    for (const key of prefix) expect(fireEvent.keyDown(view.root.activeElement ?? view.row("alpha.ts"), { key })).toBe(false);
    await waitFor(() => expect(view.tree.getFocusedPath()).toBe(path), { timeout: 1000 });
    expect(view.tree.getSelectedPaths()).toEqual([path]);
    expect(view.tree.getVisibleCount()).toBe(6);
    expect(view.tree.isSearchOpen()).toBe(false);
    await waitFor(() => expect(view.root.activeElement).toBe(view.row(path)), { timeout: 1000 });
  } finally { view.close(); }
});

it.each([false, true])("u3787c_vanilla_shift_range_replaces_disjoint_selection_meta_%s", async metaKey => {
  const view = await mountTree({ rangeSelection: "replace" });

  try {
    fireEvent.click(view.row("alpha.ts"));
    fireEvent.click(view.row("bravo.ts"), { metaKey: true });
    fireEvent.click(view.row("echo.ts"), { shiftKey: true, metaKey });
    expect(view.tree.getSelectedPaths()).toEqual(["bravo.ts", "charlie.ts", "delta.ts", "echo.ts"]);
  } finally { view.close(); }
});

it.each([false, true])("u3787c_vanilla_range_without_anchor_selects_only_target_meta_%s", async metaKey => {
  const view = await mountTree({ rangeSelection: "replace" });

  try {
    fireEvent.click(view.row("echo.ts"), { shiftKey: true, metaKey });
    expect(view.tree.getSelectedPaths()).toEqual(["echo.ts"]);
  } finally { view.close(); }
});

it("u3787c_vanilla_meta_toggle_establishes_anchor_even_when_deselecting", async () => {
  const view = await mountTree({ rangeSelection: "replace" });

  try {
    fireEvent.click(view.row("bravo.ts"));
    fireEvent.click(view.row("alpha.ts"), { metaKey: true });
    fireEvent.click(view.row("bravo.ts"), { metaKey: true });
    expect(view.tree.getSelectedPaths()).toEqual(["alpha.ts"]);
    fireEvent.click(view.row("echo.ts"), { shiftKey: true, metaKey: true });
    expect(view.tree.getSelectedPaths()).toEqual(["bravo.ts", "charlie.ts", "delta.ts", "echo.ts"]);
  } finally { view.close(); }
});

it("u3787c_vanilla_default_retains_additive_meta_shift_selection", async () => {
  const view = await mountTree();

  try {
    fireEvent.click(view.row("alpha.ts"));
    fireEvent.click(view.row("delta.ts"), { metaKey: true });
    fireEvent.click(view.row("echo.ts"), { shiftKey: true, metaKey: true });
    expect(view.tree.getSelectedPaths()).toEqual(["alpha.ts", "delta.ts", "echo.ts"]);
  } finally { view.close(); }
});

it.each(["input", "textarea", "editable", "terminal"])("u3787c_vanilla_prefix_leaves_%s_input_untouched", async kind => {
  const view = await mountTree({ typeahead: "name-prefix" });

  try {
    fireEvent.click(view.row("alpha.ts"));
    const editor = document.createElement(kind === "input" || kind === "textarea" ? kind : "div");

    if (kind === "editable") editor.setAttribute("contenteditable", "true");

    if (kind === "terminal") editor.setAttribute("role", "textbox");
    view.row("alpha.ts").append(editor);
    editor.focus();
    expect(fireEvent.keyDown(editor, { key: "e" })).toBe(true);
    expect(view.tree.getSelectedPaths()).toEqual(["alpha.ts"]);
    expect(view.tree.getFocusedPath()).toBe("alpha.ts");
  } finally { view.close(); }
});

it.each(["q", " "])("u3787i_unmatched_key_and_space_reach_the_app_%s", async key => {
  const view = await mountTree({ typeahead: "name-prefix", search: true });
  let received = 0;
  const receive = () => received++;

  document.body.addEventListener("keydown", receive);

  try {
    view.row("alpha.ts").focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true });

    view.row("alpha.ts").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(received).toBe(1);
    expect(view.tree.getSelectedPaths()).toEqual([]);
    expect(view.tree.getFocusedPath()).toBe("alpha.ts");
    expect(view.tree.isSearchOpen()).toBe(false);
  } finally {
    document.body.removeEventListener("keydown", receive);
    view.close();
  }
});

it("u3787i_space_extends_an_active_name_prefix", async () => {
  const view = await mountTree({ typeahead: "name-prefix", paths: ["echo.ts", "e two.ts"] });

  try {
    view.row("e two.ts").focus();
    fireEvent.keyDown(view.row("e two.ts"), { key: "e" });
    expect(fireEvent.keyDown(view.row("echo.ts"), { key: " " })).toBe(false);
    expect(view.tree.getSelectedPaths()).toEqual(["e two.ts"]);
  } finally { view.close(); }
});
