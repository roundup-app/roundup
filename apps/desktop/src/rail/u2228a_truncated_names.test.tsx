import { createRoot, createSignal } from "solid-js";
import { createCutTitle } from "../ui/cutTitle";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { itemOf, mountRail, rowOf } from "./railFixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NAME = `payments workstream ${"with a very long tail ".repeat(3)}`.trim();

/** jsdom has no layout: a `.name` box 100 wide holds as many characters as it has text length. */
const layout = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
};

/** The row, not its name, carries the Tooltip trigger, so any point of it reaches it. */
const hoverRow = (name: string) => fireEvent.pointerMove(rowOf(name), { pointerType: "mouse" });

it("u2228a_a_truncated_workstream_name_has_its_full_text", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME }), agent("a", "idle", "working on it", { parent: "w", name: "agent long name" })]);

  const leaf = document.querySelector<HTMLElement>('.rail-row[data-id="a"]')!;

  await waitFor(() => expect(rowOf(NAME).getAttribute("title")).toBe(NAME));
  expect(leaf.getAttribute("title")).toBe("agent long name");
  expect(itemOf(NAME).getAttribute("aria-label")).toContain(NAME);
  expect(leaf.closest("[role=treeitem]")!.getAttribute("aria-label")).toBe("agent long name, working on it");
});

it("u2228a_a_name_that_fits_has_no_tooltip", async () => {
  layout(50);
  await mountRail([workstream("w", { name: NAME })]);

  await Promise.resolve();
  hoverRow(NAME);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(rowOf(NAME).hasAttribute("title")).toBe(false);
});

it("u2228c_a_row_opens_no_tooltip", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME }), agent("a", "idle", "working on it", { parent: "w" })]);

  for (const row of [rowOf(NAME), document.querySelector<HTMLElement>('.rail-row[data-id="a"]')!]) {
    fireEvent.pointerMove(row, { pointerType: "mouse" });
    fireEvent.click(row);
    row.focus();
  }

  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("z3788c_cut_title_releases_changed_targets_and_disposed_owners", async () => {
  const observers: { targets: Set<Element>; notify(target: Element): void }[] = [];

  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    notify(target: Element) {
      if (this.targets.has(target)) this.callback([{ target, contentRect: new DOMRect(0, 0, 100, 20), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this);
    }
  });
  const old = document.createElement("span");
  const current = document.createElement("span");
  const extra = document.createElement("div");
  const nextExtra = document.createElement("div");
  const measured = vi.fn(() => 200);

  Object.defineProperty(current, "scrollWidth", { get: measured });

  const owner = () => createRoot(dispose => {
    const [watched, setWatched] = createSignal<Element>(extra);
    const title = createCutTitle(() => NAME, { watch: () => watched() });

    title.ref(old);

    return { dispose, setWatched, ref: title.ref };
  });

  const first = owner();

  // createCutTitle schedules its text/ref measurement in a microtask.
  await Promise.resolve();
  first.ref(current);
  first.setWatched(nextExtra);
  await Promise.resolve();
  measured.mockClear();

  for (const observer of observers) { observer.notify(old); observer.notify(extra); }

  expect(measured).not.toHaveBeenCalled();

  for (const observer of observers) observer.notify(nextExtra);
  expect(measured).toHaveBeenCalledTimes(1);
  first.dispose();
  const second = owner();

  second.ref(current);
  await Promise.resolve();
  measured.mockClear();

  for (const observer of observers) observer.notify(current);
  expect(measured).toHaveBeenCalledTimes(1);
  second.dispose();
  measured.mockClear();

  for (const observer of observers) observer.notify(current);
  expect(measured).not.toHaveBeenCalled();
});

it("u5231a_rail_row_reveals_reason_and_age", async () => {
  await mountRail([agent("a", "working", "Editing Thread.tsx", { name: "alpha", status: { kind: "working", label: "Editing Thread.tsx", since: Date.now() - 12 * 60_000, finished: "0" } })]);
  fireEvent.pointerMove(rowOf("alpha"), { pointerType: "mouse" });
  expect((await screen.findByRole("tooltip")).textContent).toMatch(/^Editing Thread\.tsx · 1[23] min$/);
});
