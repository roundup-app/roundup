import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { mountControl, WORKTREE } from "./harness";
import { openChanges } from "./noteHarness";
import { notices } from "../testing/notices";

afterEach(cleanup);

const open = async () => {
  const mounted = await mountControl();

  await openChanges();
  await screen.findByRole("list", { name: "Changed files" });

  return mounted;
};

describe("U2539d", () => {
  it("u2539d_enter_opens_the_file_at_its_line", async () => {
    const { app } = await open();

    fireEvent.click(screen.getByRole("button", { name: "Open in editor: src/a.ts" }));

    await waitFor(() => expect(app.editorCalls).toEqual([{ path: `${WORKTREE.path}/src/a.ts`, line: 12 }]));
  });

  it("u2539d_a_deleted_file_opens_nothing", async () => {
    const { app } = await open();

    for (const button of screen.getAllByRole("button", { name: /^Open in editor: / })) fireEvent.click(button);

    await waitFor(() => expect(app.editorCalls.map(call => call.path)).toEqual([`${WORKTREE.path}/src/a.ts`, `${WORKTREE.path}/src/deep/b.ts`]));
  });

  it("u2539d_a_failed_open_shows_one_failure_line", async () => {
    const { app } = await open();
    const failure = new RpcError(-32001, "no code editor found; choose one in Settings");

    app.editorFailure = failure;
    fireEvent.click(screen.getByRole("button", { name: "Open in editor: src/a.ts" }));

    await waitFor(() => expect(notices("alert")).toHaveLength(1));
    expect(notices("alert")[0]!.textContent).toContain(failure.message);
  });
});
