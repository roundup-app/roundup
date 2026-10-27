import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountControl } from "./harness";

afterEach(cleanup);

// Mounted inventory: the counted changed-files control of the selected Agent's Worktree.
const FILES = ["alpha.ts", "bravo.ts", "charlie.ts", "delta.ts", "echo.ts"].map((path, at) => ({ path, status: "modified" as const, line: at + 1 }));

const open = async () => {
  const mounted = await mountControl(() => ({ files: FILES }));

  fireEvent.click(screen.getByRole("button", { name: /\d+ changed files?/ }));
  await waitFor(() => expect(shadow()?.querySelectorAll("[data-item-path]").length).toBe(5));
  await waitFor(() => expect(focused()).toBeDefined());

  return mounted;
};

const shadow = () => document.querySelector("file-tree-container")?.shadowRoot;

const row = (path: string) => {
  const found = shadow()?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);

  if (!found) throw new Error(`no row ${path}`);

  return found;
};

const selected = () => [...(shadow()?.querySelectorAll<HTMLElement>('[aria-selected="true"]') ?? [])].map(element => element.dataset.itemPath);

const active = () => {
  const element = shadow()?.activeElement;

  if (!element) throw new Error("no focused row");

  return element;
};

const focused = () => shadow()?.activeElement?.getAttribute("data-item-path") ?? undefined;

it("u3787c_each_list_navigates_visible_rows changed files", async () => {
  const { app } = await open();
  row("bravo.ts").focus();

  for (const [key, path] of [["Home", "alpha.ts"], ["ArrowUp", "alpha.ts"], ["End", "echo.ts"], ["ArrowDown", "echo.ts"], ["ArrowUp", "delta.ts"], ["c", "charlie.ts"]]) {
    fireEvent.keyDown(active(), { key });
    await waitFor(() => expect(focused()).toBe(path));
  }

  expect(document.querySelector(".diff-reader")).toBeNull();
  expect(app.editorCalls).toEqual([]);
});

it("u3787c_each_list_selects_only_visible_rows changed files", async () => {
  const { app } = await open();
  fireEvent.click(row("echo.ts"), { shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["echo.ts"]));
  fireEvent.click(row("alpha.ts"), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["alpha.ts", "echo.ts"]));
  fireEvent.click(row("charlie.ts"), { shiftKey: true, metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["alpha.ts", "bravo.ts", "charlie.ts"]));
  fireEvent.keyDown(active(), { key: "a", metaKey: true });
  await waitFor(() => expect(selected()).toEqual(FILES.map(file => file.path)));
  expect(document.querySelector(".diff-reader")).toBeNull();
  expect(app.editorCalls).toEqual([]);
});
