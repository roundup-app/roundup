import { afterEach, expect, it, vi } from "vitest";
import { renderMarkdown } from "../plain/renderMarkdown";
import { ESC, kitty, open, png } from "./imageHarness";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const chunks = (data: string) => [data.slice(0, 16), data.slice(16, 32), data.slice(32)];

it("u5984_the_emulator_answers_the_kitty_query", async () => {
  const { write, replies, settle } = open();

  await write(kitty("i=31,s=1,v=1,a=q,t=d,f=24", "AAAA"));
  await settle();
  // DA1's reply is the Daemon's (X17), which also answers this query in stream order; the Screens drop this duplicate.
  expect(replies).toEqual([`${ESC}_Gi=31;OK${ESC}\\`]);
});

it.each([
  ["an empty first chunk", true],
  ["a bare final m=0", false],
])("u5984_a_chunked_png_is_stored_as_one_image_with_%s", async (_name, emptyFirst) => {
  const { write, addon, terminal, settle } = open();
  const [a, b, c] = chunks(png(8, 8));

  await write("above\r\n");

  if (emptyFirst) await write(kitty("i=7,a=T,f=100,m=1", ""));

  await write(kitty(emptyFirst ? "m=1" : "i=7,a=T,f=100,m=1", a));
  await write(kitty("m=1", b));
  await write(kitty(emptyFirst ? "m=0" : "m=1", c));

  if (!emptyFirst) await write(kitty("m=0"));

  await write("\r\nbelow\r\n");
  await settle();

  expect(addon.getImageAtBufferCell(0, 1)).toBeTruthy();
  expect(addon.getImageAtBufferCell(0, 0)).toBeUndefined();
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("above");
  expect(terminal.buffer.active.getLine(terminal.buffer.active.cursorY - 1)?.translateToString(true).trim()).toBe("below");
});

it("u5984_a_reopened_terminal_redraws_its_image", async () => {
  const first = open("t-first");

  await first.write("above\r\n");
  await first.write(kitty("i=7,a=T,f=100", png(8, 8)));
  await first.write("\r\nbelow\r\n");
  await first.settle();
  const saved = first.emulator.serialize!();

  expect(first.addon.getImageAtBufferCell(0, 1)).toBeTruthy();

  const reopened = open("t-second");

  reopened.emulator.setSize({ cols: saved.cols, rows: saved.rows });
  await reopened.write(saved.data);
  await reopened.settle();
  expect(reopened.addon.getImageAtBufferCell(0, 1)).toBeTruthy();
  expect(reopened.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("above");
});

it("u5984_an_oversized_image_is_dropped_and_text_survives", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { write, addon, terminal, settle } = open();

  await write("kept\r\n");
  await write(kitty("i=9,a=T,f=100", png(3000, 3000)));
  await write("still here\r\n");
  await settle();

  expect(addon.storageUsage).toBe(0);
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("kept");
  expect(terminal.buffer.active.getLine(1)?.translateToString(true)).toBe("still here");
});

it("u5984_xtversion_never_names_iterm2", async () => {
  const { write, replies, settle } = open();

  await write(`${ESC}[>q`);
  await settle();
  expect(replies.join("")).not.toMatch(/iTerm/i);
});

it("u5984_a_remote_image_url_draws_its_alt_text", () => {
  const html = renderMarkdown("![the chart](https://example.com/chart.png)");

  expect(html).toContain("the chart");
  expect(html).not.toMatch(/<img|https:\/\/example\.com\/chart\.png/);
});
