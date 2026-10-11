import { describe, expect, it, vi } from "vitest";
import { findTargets, linkProvider, linksOnRow, resolvePath } from "./links";
import type { CommandKey, LinkTarget, Rows } from "./links";

const texts = (line: string) => findTargets(line).map(({ start, end }) => line.slice(start, end));

/** Rows of `cols` cells each: a string longer than that wraps onto the next row. A `wide` character takes two cells. */
const rowsOf = (text: string, cols: number): Rows => {
  const rows: { chars: string; width: number }[][] = [];
  let row: { chars: string; width: number }[] = [];
  let used = 0;

  for (const chars of text) {
    const width = chars === "漢" ? 2 : 1;

    if (used + width > cols) {
      rows.push(row);
      row = [];
      used = 0;
    }

    row.push({ chars, width });

    if (width === 2) row.push({ chars: "", width: 0 });
    used += width;
  }

  rows.push(row);

  return {
    length: rows.length,
    getLine: (index) => {
      const cells = rows[index];

      return cells && { isWrapped: index > 0, length: cells.length, getCell: (x) => cells[x] && { getChars: () => cells[x]!.chars, getWidth: () => cells[x]!.width } };
    },
  };
};

const cmd = (held = true): CommandKey => ({ held: () => held, onChange: () => () => {} });

const click = (init: MouseEventInit) => new MouseEvent("click", init);

const provide = (rows: Rows, y: number, open: (target: LinkTarget) => void, key = cmd()) =>
  new Promise<NonNullable<Parameters<Parameters<ReturnType<typeof linkProvider>["provideLinks"]>[1]>[0]>>((resolve) => {
    linkProvider(() => rows, open, key).provideLinks(y, (links) => resolve(links ?? []));
  });

describe("u365 recognised text", () => {
  it("u365_recognises_links_and_paths", () => {
    expect(findTargets("see https://example.com now")).toEqual([{ start: 4, end: 23, target: { kind: "url", url: "https://example.com" } }]);
    expect(findTargets("/abs/path/a.ts")[0]?.target).toEqual({ kind: "path", path: "/abs/path/a.ts", line: null, column: null });
    expect(findTargets("at src/a.ts:42")[0]?.target).toEqual({ kind: "path", path: "src/a.ts", line: 42, column: null });
    expect(findTargets("src/a.ts:42:7")[0]?.target).toEqual({ kind: "path", path: "src/a.ts", line: 42, column: 7 });
    expect(texts("a.ts and ./b and ../c/d")).toEqual(["a.ts", "./b", "../c/d"]);
    expect(texts("hello world, 42 and v1.2")).toEqual([]);
    expect(texts("ftp://example.com")).toEqual([]);
  });

  it("u365_trailing_punctuation_is_not_part_of_a_link", () => {
    expect(texts("(https://example.com/a).")).toEqual(["https://example.com/a"]);
    expect(texts('"https://example.com", and https://x.io;')).toEqual(["https://example.com", "https://x.io"]);
    expect(texts("open src/a.ts.")).toEqual(["src/a.ts"]);
    expect(texts("see 'src/a.ts:42',")).toEqual(["src/a.ts:42"]);
  });

  it("u365_a_relative_path_resolves_against_the_worktree", () => {
    expect(resolvePath("/w/a", "src/a.ts")).toBe("/w/a/src/a.ts");
    expect(resolvePath("/w/a", "./src/../b.ts")).toBe("/w/a/b.ts");
    expect(resolvePath("/w/a", "/x/y.ts")).toBe("/x/y.ts");
  });
});

describe("u365 the click", () => {
  const open = async (init: MouseEventInit) => {
    const opened = vi.fn();
    const [link] = await provide(rowsOf("run https://example.com ok", 80), 1, opened);

    link!.activate(click(init), link!.text);

    return opened;
  };

  it("u365_cmd_click_opens_once", async () => {
    const opened = await open({ metaKey: true });

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ kind: "url", url: "https://example.com" });
  });

  it("u365_a_plain_click_selects_and_opens_nothing", async () => {
    for (const init of [{}, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) expect(await open(init)).not.toHaveBeenCalled();
  });

  it("u365_cmd_underlines_and_shows_a_hand_only_while_held", async () => {
    let held = false;
    const [link] = await provide(rowsOf("https://example.com", 80), 1, vi.fn(), { held: () => held, onChange: () => () => {} });

    expect([link!.decorations?.underline, link!.decorations?.pointerCursor]).toEqual([false, false]);
    held = true;
    expect([link!.decorations?.underline, link!.decorations?.pointerCursor]).toEqual([true, true]);
  });

  it("u365_a_cmd_press_while_hovering_updates_the_live_decorations", async () => {
    let held = false;
    let change = () => {};

    const onChange = (listener: () => void) => {
      change = listener;

      return () => {};
    };

    const [link] = await provide(rowsOf("https://example.com", 80), 1, vi.fn(), { held: () => held, onChange });

    // xterm swaps in a live copy of `decorations` once the pointer is on the link.
    link!.hover?.(click({}), link!.text);
    link!.decorations = { underline: false, pointerCursor: false };
    held = true;
    change();
    expect(link!.decorations).toEqual({ underline: true, pointerCursor: true });
    link!.leave?.(click({}), link!.text);
    held = false;
    change();
    expect(link!.decorations.underline).toBe(true);
  });
});

describe("u365 dense and wrapped lines", () => {
  it("u365_wrapped_and_dense_lines_find_each_target", async () => {
    const line = Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? `https://e.com/${index}` : `src/f${index}.ts:${index}`)).join(" ");
    const rows = rowsOf(line, 40);

    expect(rows.length).toBeGreaterThan(2);

    expect(findTargets(line)).toHaveLength(20);

    // A link that wraps is one range from its first cell to its last, and opens as one target.
    const wrapped = findTargets(line).find(({ start, end }) => Math.floor(start / 40) !== Math.floor((end - 1) / 40))!;
    const opened = vi.fn();
    const startRow = Math.floor(wrapped.start / 40) + 1;
    const [link] = linksOnRow(rows, startRow - 1, opened).filter(({ text }) => text === line.slice(wrapped.start, wrapped.end));

    expect(link?.range).toEqual({ start: { x: (wrapped.start % 40) + 1, y: startRow }, end: { x: ((wrapped.end - 1) % 40) + 1, y: Math.floor((wrapped.end - 1) / 40) + 1 } });
    link!.activate(click({ metaKey: true }), link!.text);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]?.[0]).toEqual(wrapped.target);

    // Each row lists the links that touch it, and only those.
    const perRow = Array.from({ length: rows.length }, (_, row) => linksOnRow(rows, row, opened).length);

    expect(perRow.reduce((sum, count) => sum + count, 0)).toBe(20 + countWraps(line, 40));
  });

  it("u365_wide_characters_keep_the_cells_of_a_link", async () => {
    const [link] = linksOnRow(rowsOf("漢漢 https://x.io", 80), 0, () => {});

    // The two wide characters take four cells, then a space, so the link starts at the sixth.
    expect(link?.range.start).toEqual({ x: 6, y: 1 });
    expect(link?.range.end).toEqual({ x: 6 + "https://x.io".length - 1, y: 1 });
  });
});

const countWraps = (line: string, cols: number): number =>
  findTargets(line).filter(({ start, end }) => Math.floor(start / cols) !== Math.floor((end - 1) / cols)).length;

describe("u365 xterm", () => {
  it("u365_every_emulator_registers_the_one_provider_and_hands_its_target_on", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const { createXtermEmulators } = await import("./emulator");
    const register = vi.spyOn(Terminal.prototype, "registerLinkProvider");
    const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t");
    const opened = vi.fn();

    emulator.onOpenTarget(opened);
    expect(register).toHaveBeenCalledTimes(1);

    const provider = register.mock.calls[0]![0];

    emulator.dispose();
    register.mockRestore();
    expect(provider.provideLinks).toBeTypeOf("function");
  });
});
