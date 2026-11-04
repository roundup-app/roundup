import * as xtermModule from "@xterm/xterm";
import * as imageModule from "@xterm/addon-image";
import type { ImageAddon } from "@xterm/addon-image";
import { vi } from "vitest";
import { createXtermEmulators } from "./emulator";

export const ESC = "\x1b";

export const png = (width: number, height: number): string => {
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

export const open = (id = "t-img") => {
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

export const kitty = (control: string, payload?: string) => `${ESC}_G${control}${payload === undefined ? "" : `;${payload}`}${ESC}\\`;

type Call = { col: number; row: number; count: number; tileId: number };

type Owner = { _storage: { _virtCalls(start: number, end: number): Call[] } };

/** What the image addon would draw over the viewport's placeholder cells: one call per run of tiles. */
export const placements = (addon: ImageAddon, rows: number): Call[] => {
  // SAFETY: the pinned addon keeps its storage in `_storage`, and `_virtCalls` is the placeholder walk that patches/@xterm__addon-image@0.10.0-beta.331.patch adds to it.
  const { _storage } = addon as ImageAddon & Owner;

  return _storage._virtCalls(0, rows - 1).map(({ col, row, count, tileId }) => ({ col, row, count, tileId }));
};

const DIACRITICS = [0x0305, 0x030d, 0x030e, 0x0310];

/** Claude Code's Unicode-placeholder picture, built to the Kitty spec: the transmission, then `rows` rows of U+10EEEE cells. The first cell of a row names its row and column, a continuation cell omits both; the id rides in the foreground colour. */
export const placeholderPicture = (id: number, columns: number, rows: number, payload: string): string => {
  const cells = (row: number) => `${String.fromCodePoint(0x10eeee, DIACRITICS[row]!, DIACRITICS[0]!)}${String.fromCodePoint(0x10eeee).repeat(columns - 1)}`;

  return kitty(`a=T,U=1,q=2,f=100,i=${id},c=${columns},r=${rows}`, payload)
    + Array.from({ length: rows }, (_, row) => `${ESC}[38;5;${id}m${cells(row)}${ESC}[39m`).join("\r\n");
};
