import { beforeAll, expect, it } from "vitest";
import { read, wait } from "../ui/tabsBrowser";
import { batch, load, reportingSelection, rightAt, setViewport } from "./u514_support";

beforeAll(setViewport);

const optionText = async () => {
  await batch(
    ["eval", "window.__input = []; window.__typingCalls = window.__fake?.app.calls.length ?? 0"],
    ["press", "Alt+e"],
    ["keyboard", "inserttext", "é"],
    ["wait", "--fn", "new TextDecoder().decode(new Uint8Array(window.__input)).includes('é')"]
  );
  const [bytes, appMounted] = await read<[number[], boolean]>("[window.__input, !!window.__fake]");

  if (appMounted) {
    await wait(`window.__fake.app.calls.slice(window.__typingCalls).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === ${bytes.length}`);
    expect(await read("window.__fake.app.calls.slice(window.__typingCalls).filter(c => c.method === 'terminal.write').flatMap(c => [...atob(c.params.data)].map(ch => ch.charCodeAt(0)))")).toEqual(bytes);
  }

  return bytes;
};

it.each(["agent", "user", "bubble"] as const)("u5549c_option_typing_survives_selection_%s", async where => {
  let before: number[] = [];
  const { from, cells } = await reportingSelection(where, 1002, async () => { before = await optionText(); });
  await rightAt({ x: Math.round(from.x + cells.width * 7), y: from.y });
  await batch(
    ["press", "Escape"],
    ["mouse", "move", String(from.x), String(from.y)],
    ["mouse", "down"],
    ["mouse", "up"]
  );
  expect(await read("window.__emu.selection()")).toBe("");
  const after = await optionText();
  await load("?plain&mac");
  await batch(
    ["click", ".xterm-screen"],
    ["eval", "window.__input = []; window.__emu.onInput(bytes => window.__input.push(...bytes))"]
  );
  const plain = await optionText();
  // Chromium sends the physical Alt+e as e; the committed character probes text input separately.
  expect(plain).toEqual([...new TextEncoder().encode("eé")]);
  expect(before).toEqual(plain);
  expect(after).toEqual(plain);
}, 120_000);
