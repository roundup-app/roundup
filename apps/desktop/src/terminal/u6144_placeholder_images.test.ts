import { afterEach, expect, it, vi } from "vitest";
import { drawn, kitty, open, placeholderPicture, placements, png } from "./imageHarness";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const COLUMNS = 4;

const ROWS = 2;

it("u6144_a_placeholder_transmission_places_one_image", async () => {
  const { write, addon, terminal, settle } = open();

  await write("above\r\n");
  await write(placeholderPicture(77, COLUMNS, ROWS, png(8, 8)));
  await write("\r\nbelow\r\n");
  await settle();

  expect(placements(addon, terminal.rows)).toEqual([
    { row: 1, col: 0, count: COLUMNS, tileId: 0 },
    { row: 2, col: 0, count: COLUMNS, tileId: COLUMNS },
  ]);

  const buffer = terminal.buffer.active;

  for (const row of [1, 2]) for (let col = 0; col < COLUMNS; col++) expect(buffer.getLine(row)!.getCell(col)!.isInvisible()).toBeTruthy();

  expect(buffer.getLine(0)!.translateToString(true)).toBe("above");
  expect(buffer.getLine(3)!.translateToString(true)).toBe("below");
});

it("u6144_a_placeholder_image_scrolls_and_reopens", async () => {
  const first = open("t-first");

  await first.write(placeholderPicture(77, COLUMNS, ROWS, png(8, 8)));
  await first.write("\r\n" + "more\r\n".repeat(first.terminal.rows - 2));
  await first.settle();

  expect(first.terminal.buffer.active.baseY).toBe(1);

  // The picture's first row has scrolled into scrollback; its second row still shows its own tiles.
  const kept = [{ row: 0, col: 0, count: COLUMNS, tileId: COLUMNS }];

  expect(placements(first.addon, first.terminal.rows)).toEqual(kept);

  const reopened = open("t-second");
  const saved = first.emulator.serialize!();

  reopened.emulator.setSize({ cols: saved.cols, rows: saved.rows });
  await reopened.write(saved.data);
  await reopened.settle();

  expect(placements(reopened.addon, reopened.terminal.rows)).toEqual(kept);
});

it("u6144_an_oversized_placeholder_image_is_dropped", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { write, addon, terminal, settle } = open();

  await write("kept\r\n");
  await write(kitty("a=T,U=1,q=2,f=100,i=77,c=400,r=400", png(3000, 3000)));
  await write("\r\nstill here\r\n");
  await settle();

  expect(addon.storageUsage).toBe(0);
  expect(placements(addon, terminal.rows)).toEqual([]);
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("kept");
});

it("u6144_a_placeholder_image_keeps_its_aspect_inside_its_cells", async () => {
  const { write, settle } = open();

  // 4 x 4 cells at the default 7 x 14 px cell is 28 x 56 px; a 2:1 picture fits as 28 x 14, centred.
  await write(placeholderPicture(77, 4, 4, png(96, 48)));
  await settle();

  expect(drawn).toEqual([[0, 21, 28, 14]]);
});
