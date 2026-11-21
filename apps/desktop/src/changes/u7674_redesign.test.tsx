import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMPARISON, openChanges, treeRow, startNote, waitDiff } from "./noteHarness";
import { mountControl, WORKTREE } from "./harness";
import { diffsLoaded } from "./diffDraw";
import type { ChangedFile } from "@contracts/agent/ChangedFile";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const FIRST = "src/a.ts";

const FILES = { files: [
  { path: "z.ts", status: "modified" as const, line: 1, counts: { added: 4, removed: 1 }, blob: null },
  { path: "src/a.ts", status: "modified" as const, line: 12, counts: { added: 12, removed: 3 }, blob: null },
  { path: "src/b.ts", status: "added" as const, line: 1, counts: null, blob: null },
] };

const open = async (changed: () => { files: ChangedFile[] } = () => FILES) => {
  const mounted = await mountControl(changed);

  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  await openChanges();
  await screen.findByRole("region", { name: "Changes" });

  return mounted;
};

const shown = () => screen.getAllByLabelText("Diff").map(each => each.textContent).join(" ");

/** Waits for the diff pane to name `path`. */
const showing = (path: string) => waitFor(() => expect(shown()).toContain(path));

/** The element exists. */
const must = (element: Element | null) => { if (!element) throw new Error("missing"); };

/** The query finds nothing. */
const absent = (query: () => HTMLElement | null) => expect(query()).toBeNull();

// SAFETY: every agent.compareFile call carries a `path`.
const compared = (app: Awaited<ReturnType<typeof open>>["app"]) => app.calls.filter(call => call.method === "agent.compareFile").map(call => (call.params as { path: string }).path);

it("u7678d_the_view_opens_on_the_first_module_at_its_top", async () => {
  await open();

  await showing("src/a.ts");
  const row = document.querySelector<HTMLElement>('[data-row="module"]');

  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(row?.dataset.selected).toBe("true");
});

it("u7674a_the_tree_stays_while_a_file_is_open", async () => {
  await open();
  await showing("src/a.ts");

  absent(() => screen.queryByRole("button", { name: /^Back/ }));
  expect(document.querySelector(".changes-tree")).toBeTruthy();
});

it("u7674a_a_group_switcher_shows_only_with_several_groups", async () => {
  const { app, connected } = await open();

  absent(() => screen.queryByRole("list", { name: "Repositories and branches" }));
  app.handlers["agent.ownedChanges"] = () => ({ groups: [
    { repo: WORKTREE.path, branch: "one", base: "main", files: FILES.files },
    { repo: "/p/other", branch: "two", base: "main", files: [{ path: "o.ts", status: "modified", line: 1, counts: { added: 7, removed: 0 }, blob: null }] },
  ] });
  await connected.owned.refresh("a");
  await screen.findByRole("list", { name: "Repositories and branches" });
});

it("u7674b_the_header_holds_name_from_switch_totals_and_one_close", async () => {
  await open();

  // SAFETY: the header is the one `header.changes-head` of the view.
  const head = (await screen.findByRole("region", { name: "Changes" })).querySelector("header.changes-head") as HTMLElement;

  must(head.querySelector(".changes-name"));
  must(head.querySelector(".changes-from"));
  expect(head.querySelectorAll('[role="radiogroup"]').length).toBe(1);
  expect(head.querySelector(".changes-totals")?.textContent).toMatch(/3 .*16.*4/);
  expect(head.querySelectorAll("[data-button]").length).toBe(1);
  absent(() => screen.queryByRole("heading", { name: /Changes:/ }));
});

it("u7674b_totals_follow_the_shown_group", async () => {
  const { app, connected } = await open();

  app.handlers["agent.ownedChanges"] = () => ({ groups: [
    { repo: WORKTREE.path, branch: "one", base: "main", files: FILES.files },
    { repo: "/p/other", branch: "two", base: "main", files: [{ path: "o.ts", status: "modified", line: 1, counts: { added: 7, removed: 0 }, blob: null }] },
  ] });
  await connected.owned.refresh("a");
  fireEvent.click(await screen.findByRole("button", { name: /two/ }));
  await waitFor(() => expect(document.querySelector(".changes-totals")?.textContent).toMatch(/1 .*7.*0/));
});

it("u7674b_escape_closes_the_view_unless_a_note_field_holds_it", async () => {
  await open();
  await showing("src/a.ts");
  await waitDiff();
  startNote();
  fireEvent.keyDown(await screen.findByLabelText("Note"), { key: "Escape" });
  screen.getByLabelText("Diff");
  fireEvent.keyDown(screen.getByRole("region", { name: "Changes" }), { key: "Escape" });
  await waitFor(() => absent(() => screen.queryByRole("region", { name: "Changes" })));
});

it("u7674c_file_rows_show_counts", async () => {
  await open();

  const a = await treeRow("src/a.ts");
  const b = await treeRow("src/b.ts");

  await waitFor(() => expect(a.textContent).toMatch(/12.*3/));
  expect(b.textContent).not.toMatch(/\d/);
});

it("u7674e_up_and_down_never_blank_the_pane", async () => {
  const { app } = await open(() => ({ files: [...FILES.files, { path: "zeta/m.rs", status: "modified" as const, line: 1, counts: null, blob: null }] }));

  await showing("src/a.ts");
  let release: () => void = () => {};

  app.handlers["agent.compareFile"] = async ({ path }) => { await new Promise<void>(resolve => { release = resolve; });

    return { ...COMPARISON, oldPath: path, newPath: path }; };

  document.querySelector<HTMLElement>('[data-key="m:zeta"]')?.focus();
  await waitFor(() => expect(compared(app)).toContain("zeta/m.rs"));
  await showing(FIRST);
  release();
  await showing("zeta/m.rs");
});

it("u7674e_choosing_a_value_opens_its_first_file", async () => {
  const { app } = await open();

  app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "t.ts", status: "modified", line: 1, counts: null, blob: null }] });
  fireEvent.click(await screen.findByRole("radio", { name: "Tree" }));
  await showing("t.ts");
});

it("u7674e_the_reader_loads_when_the_view_opens", async () => {
  await open();
  await waitFor(() => expect(diffsLoaded()).toBe(true));
});
