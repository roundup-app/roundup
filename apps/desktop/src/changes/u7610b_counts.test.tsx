import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";
import { COMPARISON, treeRow } from "./noteHarness";

let reported: (targets: Element[]) => void = () => {};

/** An observer that reports only what the test says is in view. */
class DrivenObserver {
  constructor(callback: IntersectionObserverCallback) {
    // SAFETY: the scroll reads only `target` and `isIntersecting` from an entry and nothing from the observer argument.
    reported = targets => callback(targets.map(target => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as never);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeEach(() => { vi.stubGlobal("IntersectionObserver", DrivenObserver); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const OWNED: OwnedChanges = { groups: [{ repo: "/p", branch: "main", base: "main", files: [
  { path: "a.ts", status: "modified", line: 3, counts: { added: 10000, removed: 9998 }, blob: null },
  { path: "logo.png", status: "modified", line: null, counts: null, blob: null },
] }] };

const open = async (owned: OwnedChanges = OWNED) => {
  const mounted = await mountRail([agent("a", "idle", "ready", { worktree: { path: "/p", branch: "own/a", base: "main", adopted: false } })], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => owned;
    app.handlers["agent.changedFiles"] = () => owned.groups[0] ?? { files: [] };
    app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: `${owned.groups[0]?.files.length} changed files` }));
  await screen.findByRole("region", { name: "Changes" });

  return mounted;
};

it("u7610b_rows_show_the_daemon_counts_and_a_binary_file_shows_none", async () => {
  await open();

  const row = await treeRow("a.ts");

  await waitFor(() => expect(row.textContent).toMatch(/10000.*9998/));
  expect((await treeRow("logo.png")).textContent).not.toMatch(/\d{3}/);
});

it("u7678c_opening_a_module_reads_only_the_files_its_first_screen_shows", async () => {
  const names = Array.from({ length: 12 }, (_, at) => `pkg/f${String(at).padStart(2, "0")}.ts`);

  const { app } = await open({ groups: [{ repo: "/p", branch: "main", base: "main", files: names.map(path => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 1 }, blob: null })) }] });
  // SAFETY: `agent.compareFile` calls carry `{ path }` params.
  const compared = () => app.calls.filter(call => call.method === "agent.compareFile").map(call => (call.params as { path: string }).path);

  await waitFor(() => expect(compared()).toEqual([names[0]]));
  const sections = [...document.querySelectorAll<HTMLElement>(".module-scroll [data-path]")];

  expect(sections.map(each => each.dataset.path)).toEqual(names);
  // The scroll reports only the first two sections in view: they and the one after are read, no other.
  reported(sections.slice(0, 2));
  await waitFor(() => expect(new Set(compared())).toEqual(new Set(names.slice(0, 3))));
  expect(compared().length).toBeLessThan(names.length);
  expect(compared().every(path => names.slice(0, 3).includes(path))).toBe(true);
});
