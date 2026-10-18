import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountControl, WORKTREE } from "./harness";

afterEach(cleanup);

const open = async () => {
  const mounted = await mountControl();

  fireEvent.click(screen.getByRole("button", { name: "roundup/a" }));
  await waitFor(() => expect(row("src/a.ts")).not.toBeNull());

  return mounted;
};

const row = (path: string): HTMLElement | null => document.querySelector("file-tree-container")?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`) ?? null;

const host = () => document.querySelector<HTMLElement>(".worktree-tree")!;

describe("U2539d", () => {
  it("u2539d_enter_opens_the_file_at_its_line", async () => {
    const { app } = await open();

    row("src/a.ts")!.focus();
    fireEvent.click(row("src/a.ts")!);
    fireEvent.keyDown(row("src/a.ts")!, { key: "Enter", bubbles: true, composed: true });

    await waitFor(() => expect(app.editorCalls).toEqual([{ path: `${WORKTREE.path}/src/a.ts`, line: 12 }]));
  });

  it("u2539d_a_double_click_opens_the_file_at_its_line", async () => {
    const { app } = await open();

    fireEvent.dblClick(row("src/deep/b.ts")!, { composed: true });

    await waitFor(() => expect(app.editorCalls).toEqual([{ path: `${WORKTREE.path}/src/deep/b.ts`, line: 1 }]));
  });

  it("u2539d_a_deleted_file_opens_nothing", async () => {
    const { app } = await open();

    expect(row("gone.ts")!.textContent).toContain("Deleted");
    fireEvent.click(row("gone.ts")!);
    fireEvent.dblClick(row("gone.ts")!, { composed: true });
    fireEvent.keyDown(host(), { key: "Enter" });

    expect(app.editorCalls).toEqual([]);
  });

  it("u2539d_a_folder_only_expands", async () => {
    const { app } = await open();
    const folder = [...document.querySelector("file-tree-container")!.shadowRoot!.querySelectorAll<HTMLElement>('[data-item-type="folder"]')][0]!;

    fireEvent.dblClick(folder, { composed: true });
    fireEvent.keyDown(host(), { key: "Enter" });

    expect(app.editorCalls).toEqual([]);
  });

  it("u2539d_a_failed_open_shows_one_failure_line", async () => {
    const { app } = await open();

    app.editorFailure = new RpcError(-32001, "no code editor found; install VS Code, Cursor or Zed, or set ROUNDUP_EDITOR");
    fireEvent.dblClick(row("src/a.ts")!, { composed: true });

    expect((await screen.findByRole("alert")).textContent).toContain("no code editor found");
    expect(screen.getByRole("dialog", { name: "Worktree" })).toBeTruthy();
  });
});
