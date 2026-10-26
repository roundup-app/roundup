import { expect, it, vi } from "vitest";

import type { Emulator } from "./emulator";
import { lazyEmulators } from "./lazyEmulator";

const recording = (log: string[]): Emulator => ({
  write: (bytes) => { log.push(`write ${new TextDecoder().decode(bytes)}`); },
  setSize: ({ cols, rows }) => { log.push(`size ${cols}x${rows}`); },
  setFontSize() {},
  reset: () => { log.push("reset"); },
  onInput: (listener) => {
    log.push("onInput");

    listener(new Uint8Array([97]));
  },
  onLink() {},
  selection: () => "",
  turns: () => [],
  selectTurn() {},
  paste() {},
  show: (_host, focus) => {
    log.push(`show ${focus}`);

    return { cols: 100, rows: 30 };
  },
  focus() {},
  fit: () => ({ cols: 100, rows: 30 }),
  isAtBottom: () => true,
  onScroll() {},
  scrollToBottom() {},
  dispose: () => { log.push("dispose"); },
});

it("r3800_first_terminal_loads_and_replays_once", async () => {
  const log: string[] = [];
  const load = vi.fn(() => Promise.resolve((_id: string) => recording(log)));
  const create = lazyEmulators(load);

  expect(load).not.toHaveBeenCalled();

  const first = create("a");
  const typed: number[][] = [];

  expect(load).toHaveBeenCalledTimes(1);

  first.setSize({ cols: 120, rows: 40 });
  first.write(new TextEncoder().encode("screen"));
  first.onInput((bytes) => typed.push([...bytes]));
  // Before the load, show answers the snapshot grid, as an emulator whose faces are pending does.
  expect(first.show(document.createElement("div"), true)).toEqual({ cols: 120, rows: 40 });
  expect(log).toEqual([]);

  await first.ready;

  expect(log).toEqual(["size 120x40", "write screen", "onInput", "show true"]);
  expect(typed).toEqual([[97]]);
  expect(first.fit()).toEqual({ cols: 100, rows: 30 });

  create("b");
  await Promise.resolve();

  expect(load).toHaveBeenCalledTimes(1);
  expect(first.show(document.createElement("div"), false)).toEqual({ cols: 100, rows: 30 });
});

it("r3800_first_terminal_loads_and_replays_once drops a Terminal disposed before the load", async () => {
  const log: string[] = [];
  const emulator = lazyEmulators(() => Promise.resolve(() => recording(log)))("a");

  emulator.write(new Uint8Array([1]));
  emulator.dispose();
  await emulator.ready;

  expect(log).toEqual([]);
});
