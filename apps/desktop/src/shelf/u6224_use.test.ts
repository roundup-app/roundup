import { expect, it } from "vitest";
import { peekBench } from "./u6224Browser";

const { browser, settle, toggle, calls, saved, phase, pause, toEdge, toCentre, dispatch, waitFor, closedBenchOverATerminal } = peekBench();

it("u6224_use_makes_the_peek_the_open_bench", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await browser("click", ".shelf-area");
  await waitFor("open");
  await toCentre();
  await pause(900);
  await settle();
  expect(await phase()).toBe("open");
  expect(await calls("terminal.resize")).toBe(1);
  expect(JSON.parse(String(await saved())).frame.open).toBe(true);
}, 90_000);

it("u6224_the_open_shortcut_makes_the_peek_the_open_bench", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await toggle();
  expect(await phase()).toBe("open");
  expect(await calls("terminal.resize")).toBe(1);
  expect(JSON.parse(String(await saved())).frame.open).toBe(true);
}, 90_000);

it.each(["pointerdown", "keydown", "dragenter"])("u6224_a_%s_inside_the_peek_is_use", async (event) => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  expect((await dispatch(".shelf-area", event)).phase).toBe("open");
}, 90_000);
