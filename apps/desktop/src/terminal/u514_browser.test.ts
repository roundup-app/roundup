import { beforeAll, expect, it } from "vitest";
import { browser, read } from "../ui/tabsBrowser";
import { batch, load, setViewport } from "./u514_support";

beforeAll(setViewport);

it("u514_browser_the_gutters_select_turns", async () => {
  await load();
  await batch(
    ["wait", "--fn", "document.querySelectorAll('.turn-gutter').length === 3"],
    ["click", ".turn-gutter:first-of-type"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1");
  await browser("eval", "document.querySelectorAll('.turn-gutter')[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1\n$ two\n2\n$ three\n3");

  await load("?marks=none");
  expect(await read<number>("document.querySelectorAll('.turn-gutter').length")).toBe(0);
}, 90_000);
