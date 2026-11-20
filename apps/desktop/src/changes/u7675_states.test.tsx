import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { COMPARISON, openChanges, treeRow } from "./noteHarness";
import { mountControl } from "./harness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null });

const THREE = [file("a.ts"), file("b.ts"), file("c.ts")];

let project = 0;

/** Each test gets its own Project path, so the view's kept place (U7675f) never crosses tests. */
const open = async (changed: () => { files: ChangedFile[] } | Promise<{ files: ChangedFile[] }>, comparison = (path: string) => ({ ...COMPARISON, oldPath: path, newPath: path })) => {
  project += 1;
  const mounted = await mountControl(changed, `/p${project}`);

  mounted.app.handlers["agent.compareFile"] = ({ path }) => comparison(path);
  await openChanges();
  await screen.findByRole("region", { name: "Changes" });

  return mounted;
};

const shown = () => screen.getByLabelText("Diff").textContent ?? "";

/** Waits for the diff pane to name `path`. */
const showing = (path: string) => waitFor(() => expect(shown()).toContain(path));

/** The query finds nothing. */
const absent = (query: () => HTMLElement | null) => expect(query()).toBeNull();

const gone = (query: () => HTMLElement | null) => waitFor(() => absent(query));

/** Opens a view over `THREE`, then lets `answer` decide every later listing: the leader opens only a view that has files. */
const reopened = async (answer: () => { files: ChangedFile[] }) => {
  let later = false;
  const mounted = await open(() => later ? answer() : { files: THREE });

  await treeRow("a.ts");
  later = true;
  await mounted.connected.owned.refresh("a");

  return mounted;
};

it("u7675a_an_empty_listing_says_what_it_matches", async () => {
  await reopened(() => ({ files: [] }));
  await screen.findByText("There are no changes against remote main.");
});

it("u7675a_a_failed_comparison_names_its_cause_and_retries", async () => {
  let failing = true;

  await reopened(() => { if (failing) throw new Error("bad ref");

 return { files: THREE }; });
  await screen.findByText(/Couldn't compare remote main with Changes: .*bad ref/);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await treeRow("a.ts");
  absent(() => screen.queryByText(/Couldn't compare/));
});

it("u7675a_a_missing_folder_says_so_and_retry_checks_again", async () => {
  let failing = true;

  await reopened(() => { if (failing) throw new Error("path no longer exists");

 return { files: THREE }; });
  await screen.findByText(/no longer exists\./);
  absent(() => screen.queryByText(/still missing/));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText(/still missing/);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await treeRow("a.ts");
});

it("u7675a_every_view_state_keeps_close_usable", async () => {
  await reopened(() => ({ files: [] }));
  await screen.findByText("There are no changes against remote main.");
  fireEvent.keyDown(screen.getByRole("region", { name: "Changes" }), { key: "Escape" });
  await gone(() => screen.queryByRole("region", { name: "Changes" }));
});

it("u7675b_binary_and_mode_only_files_say_so", async () => {
  await open(() => ({ files: [file("a.ts")] }), path => ({ ...COMPARISON, oldPath: path, newPath: path, new: { kind: "text", revision: "same", text: "before\nsecond old\n" } }));
  await screen.findByText(/mode change/);
});

it("u7675b_whitespace_only_says_no_remaining_difference_and_can_show_it", async () => {
  await open(() => ({ files: [file("a.ts")] }), path => ({ ...COMPARISON, oldPath: path, newPath: path, old: { kind: "text", revision: "o", text: "a b\n" }, new: { kind: "text", revision: "n", text: "a  b\n" } }));
  await screen.findByText("No remaining difference");
  fireEvent.click(screen.getByRole("button", { name: "Show whitespace changes" }));
  await gone(() => screen.queryByRole("button", { name: "Show whitespace changes" }));
});

it("u7675b_a_file_changed_on_disk_offers_reload_and_never_reloads_itself", async () => {
  let blob = "one";
  const { app, connected } = await open(() => ({ files: [{ ...file("a.ts"), blob }] }));

  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(1));
  blob = "two";
  await connected.owned.refresh("a");
  await screen.findByText("a has updated this file.");
  expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.compareFile").length).toBe(2));
});

it("u7675c_when_the_open_file_leaves_its_pane_says_so", async () => {
  let list = THREE;
  const { connected } = await open(() => ({ files: list }));

  await showing("a.ts");
  list = THREE.slice(1);
  await connected.owned.refresh("a");
  await screen.findByText("a.ts no longer differs from remote main.");
  await showing("b.ts");
});

it("u7675c_the_rail_count_and_header_totals_follow_the_list", async () => {
  let list = THREE;
  const { connected } = await open(() => ({ files: list }));

  await waitFor(() => expect(document.querySelector(".changes-totals")?.textContent).toMatch(/3 /));
  list = THREE.slice(0, 1);
  await connected.owned.refresh("a");
  await waitFor(() => expect(document.querySelector(".changes-totals")?.textContent).toMatch(/1 /));
});

it("u7675e_j_and_k_step_files_from_anywhere", async () => {
  await open(() => ({ files: THREE }));
  await showing("a.ts");
  const view = screen.getByRole("region", { name: "Changes" });

  fireEvent.keyDown(view, { key: "j" });
  await showing("b.ts");
  fireEvent.keyDown(view, { key: "k" });
  await showing("a.ts");
  fireEvent.keyDown(view, { key: "k" });
  await showing("a.ts");
});

it("u7675e_question_mark_lists_the_keys_and_escape_closes_it_before_the_view", async () => {
  await open(() => ({ files: THREE }));
  await showing("a.ts");
  const view = screen.getByRole("region", { name: "Changes" });

  fireEvent.keyDown(view, { key: "?" });
  await screen.findByRole("region", { name: "Keys" });
  fireEvent.keyDown(view, { key: "Escape" });
  await gone(() => screen.queryByRole("region", { name: "Keys" }));
  screen.getByRole("region", { name: "Changes" });
  fireEvent.keyDown(view, { key: "Escape" });
  await gone(() => screen.queryByRole("region", { name: "Changes" }));
});
