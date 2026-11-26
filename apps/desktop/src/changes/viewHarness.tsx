import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { mountRail } from "../rail/railFixture";
import { agent, event } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { standInReader } from "./moveHarness";
import { COMPARISON, marked, openChanges, openFirstModule, take } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

/**
 * Every offset the code wrote to each scroller, in order. U7675d and U7675e assert a scroll offset in Vitest, but jsdom lays nothing out
 * (a read of `scrollTop` is only what was last assigned) and the web-assertions lint bars asserting such a read. The offset the code
 * asks for is the behaviour, so these tests assert the writes: a file restored at its offset, a key scrolling to its line, nothing else.
 */
export const scrolls = new Map<Element, number[]>();

export const offsets = new WeakMap<Element, number>();

const plain = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

/** The value, or a failure naming the missing element. */
export const there = <T,>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("expected the element to be there");

  return value;
};

/** The offsets written to `scroller`, in order. */
export const written = (scroller: Element | null): number[] => scrolls.get(there(scroller)) ?? [];

/** The offset last written to `scroller`. */
export const scrolledTo = (scroller: Element | null) => written(scroller).at(-1);

export const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null });

export const THREE = [file("a.ts"), file("b.ts"), file("c.ts")];

/** Three modules of one file each. */
export const MODS = [file("a/x.ts"), file("b/x.ts"), file("c/x.ts")];

export const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

export const comparison = (path: string, over: Partial<FileComparison> = {}): FileComparison => ({ ...COMPARISON, oldPath: path, newPath: path, ...over });

const SIXTY = Array.from({ length: 60 }, (_, index) => "line " + (index + 1));

export const multi = (path: string, revision = "one") => comparison(path, {
  old: text("multi-old", SIXTY.join("\n") + "\n"),
  new: text("multi-" + revision, SIXTY.flatMap((line, index) => index === 2 || index === 44 ? [line + " edited"] : index === 19 ? [line, "added"] : [line]).join("\n") + "\n"),
});

let project = 0;

/** Each test gets its own Project path, so a note one test saves never shows in another. */
export const fresh = () => {
  project += 1;

  return "/p" + project;
};

export type Listing = { files: ChangedFile[] };

/** Opens the view over `changed`: it lands on the Overview and reads no file (U7679c); `answer` reads each file later (default: a small change). */
export const landed = async (changed: () => Listing | Promise<Listing>, answer: (path: string) => FileComparison | Promise<FileComparison> = path => comparison(path)) => {
  const mounted = await mountControl(changed, fresh());

  mounted.app.handlers["agent.compareFile"] = ({ path }) => answer(path);
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });

  return mounted;
};

/** `landed`, then the first module chosen: where the tests of one module's scroll begin. */
export const open = async (changed: () => Listing | Promise<Listing>, answer?: (path: string) => FileComparison | Promise<FileComparison>) => {
  const mounted = await landed(changed, answer);

  await openFirstModule();

  return mounted;
};

export const region = () => screen.getByRole("region", { name: copy.changes });

export const press = (key: string, target: Element = region()) => fireEvent.keyDown(target, { key });

/** The module scroll the user sees: the open module's until the next one's first screen has painted. */
export const slot = () => region().querySelector<HTMLElement>(".module-slot");

export const scroller = () => slot()?.querySelector<HTMLElement>(".module-scroll") ?? null;

/** The open scroll's file section for `path`. */
export const section = (path: string) => [...slot()?.querySelectorAll<HTMLElement>(".module-file") ?? []].find(each => each.dataset.path === path) ?? null;

/** The paths of the files the open scroll holds. */
export const openPaths = () => [...slot()?.querySelectorAll<HTMLElement>(".module-file") ?? []].map(each => each.dataset.path);

export const showing = (path: string) => waitFor(() => expect(openPaths()).toContain(path));

/** The scroll holds `path` now. */
export const isOpen = (path: string) => { expect(openPaths()).toContain(path); };

/** The drawn diff of `path`, else of every file the open scroll has read. */
export const drawnIn = (path?: string) => [...(path ? section(path) : slot())?.querySelectorAll("diffs-container") ?? []];

export const content = (path: string) => section(path)?.querySelector<HTMLElement>(".diff-content") ?? null;

export const lineKinds = (path?: string) => [...new Set(drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll("[data-line-type]") ?? []]).map(line => line.getAttribute("data-line-type")))];

/** Pierre has drawn the lines of the open file. */
export const drawn = (path?: string) => waitFor(() => expect(lineKinds(path).length).toBeGreaterThan(0));

export const at = (side: "old" | "new", line: number) => ({ side, line });

/** U7676a: Pierre marks the selected line in its own DOM, inside the file's section. */
export const marks = (want: { side: "old" | "new"; line: number }, path?: string) => waitFor(() => {
  const marked = drawnIn(path).flatMap(each => [...each.shadowRoot?.querySelectorAll("[data-selected-line]") ?? []]).map(element => ({ line: Number(element.getAttribute("data-line")), deleted: element.getAttribute("data-line-type") === "change-deletion" }));

  expect(marked).toContainEqual({ line: want.line, deleted: want.side === "old" });
});

/** The scroll reports its offset as the browser does when the user scrolls: jsdom fires no scroll event on a write. */
export const scrolled = () => fireEvent.scroll(there(scroller()));

export const moduleRow = (name: string) => there(region().querySelector<HTMLElement>(`[data-row="module"][data-key="m:${name}"]`));

/** The key of the list row that holds focus. */
export const treeFocus = () => document.activeElement?.closest("[data-row]")?.getAttribute("data-key");

/** The query finds nothing. */
export const absent = (query: () => HTMLElement | null) => expect(query()).toBeNull();

export const gone = (query: () => HTMLElement | null) => waitFor(() => absent(query));

export const closeButton = () => screen.getByRole("button", { name: copy.closeChanges });

export const calls = (app: { calls: { method: string }[] }, method: string) => app.calls.filter(call => call.method === method).length;

export const owning = (files: ChangedFile[]): OwnedChanges => ({ groups: [{ repo: "/p", branch: "main", base: "main", files }] });

/** The Rail and the centre over Agents `a` and `b`: `owned` decides what each owns. */
export const mountRailWith = (owned: (id: string) => OwnedChanges) => mountRail([agent("a", "idle", "ready"), agent("b", "idle", "ready")], [], () => null, () => false, { pane: fakeEmulators().factory }, [], { name: "p", path: fresh() }, app => {
  app.handlers["agent.ownedChanges"] = ({ id }) => owned(id);
  app.handlers["agent.compareFile"] = ({ path }) => multi(path);
});

/** An Edit of Agent `id` ended: the Rail reads what it owns again. */
export const edited = (app: Awaited<ReturnType<typeof mountRailWith>>["app"], id: string) => app.emit(event({ name: "agent.toolCall", data: { id, call: { tool: "Edit", arguments: "{}", state: "done", started: 0 } } }));

/** The file rows the list shows, in order. */
export const fileRows = () => [...region().querySelectorAll<HTMLElement>('[data-row="file"]')].map(row => row.dataset.path);

export const noiseRows = () => [...region().querySelectorAll<HTMLElement>('[data-row="noise"]')];

/** The list's module rows in order, each by its key. */
export const moduleKeys = () => [...region().querySelectorAll<HTMLElement>('.changes-tree [data-row="module"]')].map(row => row.dataset.key);

/** A noise row unfolds by Right, which chooses nothing; its file row then opens alone. */
export const takeNoise = async (path: string) => {
  for (const folded of region().querySelectorAll<HTMLElement>('[data-row="noise"][aria-expanded="false"]')) press("ArrowRight", folded);
  take(await waitFor(() => there(region().querySelector<HTMLElement>('[data-row="file"][data-path="' + path + '"]'))));
};

/** The lens fixture: seven files, each with counts of its own. */
export const counted = (path: string, added: number, removed: number): ChangedFile => ({ path, status: "modified", line: 1, counts: { added, removed }, blob: null });

export const lensGroup = () => within(screen.getByRole("radiogroup", { name: copy.lens }));

/** The label of the lens the switch has chosen. */
export const lensNow = () => Object.values(copy.lenses).find(name => lensGroup().queryByRole("radio", { name, checked: true }));

export const chooseLens = async (name: string) => {
  fireEvent.click(lensGroup().getByRole("radio", { name }));
  await waitFor(() => expect(lensNow()).toBe(name));
};

/** \`chooseLens\` for a lens that lists the open module: its scroll is the lens's own once the old one has left. */
export const switchedTo = async (name: string) => {
  const before = slot();

  await chooseLens(name);
  await waitFor(() => expect(slot()).not.toBe(before));
};

export const pane = () => screen.getByRole("region", { name: copy.overview });

/** Registers what every test of the Changes view runs: scroll writes are recorded, and each test's DOM, timers and mocks are reset. */
export const setUpView = () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IdleObserver);
    standInReader();
    scrolls.clear();
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) { return offsets.get(this) ?? 0; },
      set(this: Element, top: number) { offsets.set(this, top); scrolls.set(this, [...scrolls.get(this) ?? [], top]); },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (plain) Object.defineProperty(Element.prototype, "scrollTop", plain); else Reflect.deleteProperty(Element.prototype, "scrollTop");
  });
};
