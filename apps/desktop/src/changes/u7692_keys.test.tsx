import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { VirtualizedFileDiff } from "@pierre/diffs";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, openFile } from "./noteHarness";
import { notesFor } from "./notes";

// ESM exports are non-configurable: spy mode records the library calls while executing the real implementation.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("@pierre/diffs", { spy: true });

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const SIXTY = Array.from({ length: 60 }, (_, index) => "line " + (index + 1));

/** Lines 1 and 60 edited: the text diff holds one fold of 50 unmodified lines between them. */
const FOLDED = { ...COMPARISON, old: { kind: "text", revision: "old-revision", text: SIXTY.join("\n") + "\n" }, new: { kind: "text", revision: "new-revision", text: SIXTY.map((line, index) => index === 0 || index === 59 ? line + " edited" : line).join("\n") + "\n" } } as const;

const open = async (before?: (mounted: Awaited<ReturnType<typeof mountControl>>) => void) => {
  vi.stubGlobal("IntersectionObserver", IdleObserver);
  const mounted = await mountControl(undefined, "/p");

  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...FOLDED, oldPath: path, newPath: path });
  before?.(mounted);
  await openChanges();
  await openFile();
  await waitFor(() => expect(document.querySelector(".diff-content diffs-container")?.shadowRoot?.querySelector("[data-line]")).not.toBeNull());

  return mounted;
};

const press = (key: string, target: Element = screen.getByRole("region", { name: copy.changes })) => fireEvent.keyDown(target, { key });

it("u7692b_the_keys_list_gains_v", async () => {
  await open();
  press("?");
  const keys = await screen.findByRole("region", { name: copy.keys });
  const items = within(keys).getAllByRole("listitem").map(item => item.textContent ?? "");

  expect(items.filter(item => /^V\b/.test(item))).toHaveLength(1);
  expect(items.some(item => /^[NR]\b/.test(item))).toBe(false);
});

it("u7692b_a_fold_holding_a_notes_line_is_revealed_with_reveal_line", async () => {
  await open(({ app }) => {
    notesFor(app, "/p").save("a", { comparison: { ...FOLDED, oldPath: "src/a.ts", newPath: "src/a.ts" }, side: "new", start: 30, end: 31, source: "line 30\nline 31", text: "inside the fold" });
  });
  await waitFor(() => expect(vi.mocked(VirtualizedFileDiff.prototype.revealLine)).toHaveBeenCalledWith(30));
  expect(vi.mocked(VirtualizedFileDiff.prototype.revealLine)).toHaveBeenCalledWith(31);
});
