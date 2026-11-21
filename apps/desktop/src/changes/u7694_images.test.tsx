import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { FileContent } from "@contracts/agent/FileContent";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, take, treeRow } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

const made: string[] = [];

const revoked: string[] = [];

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IdleObserver);
  made.length = 0;
  revoked.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: () => {
      const url = `blob:${made.length}`;

      made.push(url);

      return url;
    },
    revokeObjectURL: (url: string) => { revoked.push(url); },
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const entry = (path: string): ChangedFile => ({ path, status: "modified", line: null, counts: null, blob: null });

const picture = (revision: string, size: number, over = false): FileContent => {
  const side: FileContent = { kind: "image", revision, mime: "image/png", size };

  if (!over) side.data = "iVBORw0KGgo=";

  return side;
};

const absent: FileContent = { kind: "absent", revision: "absent" };

let project = 0;

/** Opens the Changes view over `answers`, one comparison per path; the first file opens by itself. */
const open = async (answers: Record<string, Partial<FileComparison>>) => {
  project += 1;
  const mounted = await mountControl(() => ({ files: Object.keys(answers).map(entry) }), `/p-img${project}`);

  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path, ...answers[path] });
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });

  return mounted;
};

/** The diff region of a file's section in the module's scroll; without a path, the scroll's first. */
const pane = (path?: string): HTMLElement => {
  const regions = screen.getAllByLabelText(copy.diff).filter(each => path === undefined || each.closest<HTMLElement>(".module-file")?.dataset.path === path);

  if (!regions[0]) throw new Error(`No diff for ${path}`);

  return regions[0];
};

const says = (words: string, path?: string) => waitFor(() => expect(pane(path).textContent).toContain(words));


const picked = (path: string) => waitFor(() => within(pane(path)).getByText(path, { selector: ".diff-path" }));

/** The picture `<img>` for a side word, and its decoding at `width` by `height`. */
const decode = (label: string, width: number, height: number) => {
  const image = within(pane()).getByRole("img", { name: label });

  Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(image);
};

it("u7694b_a_changed_image_shows_old_above_new_with_the_size_change", async () => {
  await open({ "a.png": { old: picture("o", 42_000), new: picture("n", 88_000) } });
  const images = await screen.findAllByRole("img");

  expect(images.map(image => image.getAttribute("alt"))).toEqual([copy.oldSide, copy.newSide]);
  await says("42.0 KB → 88.0 KB");
  decode(copy.oldSide, 800, 600);
  decode(copy.newSide, 1200, 900);
  await says("800×600 → 1200×900 · 42.0 KB → 88.0 KB");
  decode(copy.oldSide, 1200, 900);
  await says("1200×900 · 42.0 KB → 88.0 KB");
});

it("u7694b_an_added_or_deleted_image_shows_one_picture", async () => {
  await open({ "a.png": { status: "added", old: absent, new: picture("n", 88_000) }, "b.png": { status: "deleted", old: picture("o", 42_000), new: absent } });
  expect((await screen.findAllByRole("img")).map(image => image.getAttribute("alt"))).toEqual([copy.newSide]);
  await says("88.0 KB");
  take(await treeRow("b.png"));
  await picked("b.png");
  await waitFor(() => expect(within(pane("b.png")).getAllByRole("img").map(image => image.getAttribute("alt"))).toEqual([copy.oldSide]));
  await says("42.0 KB", "b.png");
});

it("u7694b_a_renamed_or_mode_only_image_shows_what_7675_shows", async () => {
  await open({
    "a.png": { status: "modified", old: picture("same", 42_000), new: picture("same", 42_000) },
    "b.png": { status: "renamed", oldPath: "c.png", old: picture("o", 42_000), new: picture("n", 88_000) },
  });
  await picked("a.png");
  await says(copy.modeOnly);
  expect(within(pane("a.png")).queryAllByRole("img")).toEqual([]);
  take(await treeRow("b.png"));
  await waitFor(() => expect(within(pane("b.png")).getAllByRole("img")).toHaveLength(2));
});

it("u7694b_over_the_limit_says_too_large_and_gives_both_sizes", async () => {
  await open({ "a.png": { old: picture("o", 5_200_000, true), new: picture("n", 6_100_000, true) } });
  await says(`${copy.tooLarge} · Old 5.2 MB → New 6.1 MB`);
  expect(within(pane()).queryAllByRole("img")).toEqual([]);
  expect(within(pane()).queryByRole("button", { name: copy.showAnyway })).toBeNull();
});

it("u7694b_a_picture_that_does_not_decode_says_so", async () => {
  await open({ "a.png": { old: picture("o", 42_000), new: picture("n", 88_000) } });
  fireEvent.error(await within(pane()).findByRole("img", { name: copy.oldSide }));
  await says(`${copy.imageFailed} · 42.0 KB`);
  expect(within(pane()).getByRole("img", { name: copy.newSide })).toBeTruthy();
});

it("u7694b_an_image_offers_no_line_note", async () => {
  await open({ "a.png": { old: picture("o", 42_000), new: picture("n", 88_000) } });
  await within(pane()).findAllByRole("img");
  fireEvent.keyDown(screen.getByRole("region", { name: copy.changes }), { key: "n" });
  expect(screen.queryByRole("form", { name: copy.lineNote })).toBeNull();
});

it("u7694b_closing_the_module_revokes_its_urls_and_a_text_file_creates_none", async () => {
  await open({ "a.txt": {}, "b.png": { old: picture("o", 42_000), new: picture("n", 88_000) } });
  await picked("a.txt");
  expect(made).toEqual([]);
  take(await treeRow("b.png"));
  await waitFor(() => expect(made).toHaveLength(2));
  // The module stays open when focus returns to another of its files: its pictures stay.
  take(await treeRow("a.txt"));
  expect(revoked).toEqual([]);
  cleanup();
  await waitFor(() => expect(revoked.toSorted()).toEqual(made.toSorted()));
});
