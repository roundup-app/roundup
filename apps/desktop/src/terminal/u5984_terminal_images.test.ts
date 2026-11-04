import * as xtermModule from "@xterm/xterm";
import * as imageModule from "@xterm/addon-image";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";
import { renderMarkdown } from "../plain/renderMarkdown";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ESC = "\x1b";

const png = (width: number, height: number): string => {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(16, width);
  view.setUint32(20, height);

  return btoa(String.fromCharCode(...bytes));
};

type Bitmap = { width: number; height: number };

/** jsdom decodes no image: read the size from the PNG header, as a browser's decoder reports it. */
const stubDecoder = () => vi.stubGlobal("createImageBitmap", async (
  source: Blob | Bitmap, first?: number | { resizeWidth?: number; resizeHeight?: number }, _y?: number, cropWidth?: number, cropHeight?: number,
): Promise<Bitmap & { close(): void }> => {
  let width = 0;
  let height = 0;

  if (source instanceof Blob) {
    const header = new DataView(await source.arrayBuffer());

    width = header.getUint32(16);
    height = header.getUint32(20);
  } else ({ width, height } = source);

  if (cropWidth !== undefined && cropHeight !== undefined) [width, height] = [cropWidth, cropHeight];

  const resize = first instanceof Object ? first : {};

  return { width: resize.resizeWidth ?? width, height: resize.resizeHeight ?? height, close() {} };
});

const factory = () => createXtermEmulators(undefined, () => ({
  activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; },
}));

const open = (id = "t-img") => {
  stubDecoder();
  const terminals = vi.spyOn(xtermModule, "Terminal");
  const addons = vi.spyOn(imageModule, "ImageAddon");
  const emulator = factory()(id);
  const terminal = terminals.mock.instances.at(-1)!;
  const addon = addons.mock.instances.at(-1)!;

  terminals.mockRestore();
  addons.mockRestore();
  const replies: string[] = [];

  emulator.onInput(bytes => replies.push(new TextDecoder().decode(bytes)));

  const write = (text: string) => new Promise<void>(resolve => emulator.write(new TextEncoder().encode(text), resolve));
  const settle = () => new Promise(resolve => setTimeout(resolve, 100));

  return { emulator, terminal, addon, replies, write, settle };
};

const kitty = (control: string, payload?: string) => `${ESC}_G${control}${payload === undefined ? "" : `;${payload}`}${ESC}\\`;

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
