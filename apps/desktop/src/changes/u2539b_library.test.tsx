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
    paths: ["folded/echo-hidden.ts", "alpha.ts", "bravo.ts", "delta.ts", "echo.ts"],
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

it("u3787c_vanilla_prefix_selects_a_visible_name_without_search_or_unfolding", async () => {
  const view = await mountTree({ typeahead: "name-prefix", search: true });
  try {
    view.row("alpha.ts").focus();
    fireEvent.keyDown(view.row("alpha.ts"), { key: "e" });
    await waitFor(() => expect(view.tree.getFocusedPath()).toBe("echo.ts"));
    expect(view.tree.getSelectedPaths()).toEqual(["echo.ts"]);
    expect(view.tree.getVisibleCount()).toBe(5);
    expect(view.tree.isSearchOpen()).toBe(false);
    await waitFor(() => expect(view.root.activeElement).toBe(view.row("echo.ts")));
  } finally { view.close(); }
});
