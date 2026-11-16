import { expect, it } from "vitest";
import { peekBench } from "./u6224_support";

const { browser, evaluate, calls, phase, pause, toEdge, toCentre, dispatch, waitFor, closedBenchOverATerminal } = peekBench();

it("u6224_leaving_without_use_slides_the_peek_back", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await toCentre();
  await browser("wait", "--fn", "document.querySelector('.shelf').hidden");
  expect(await phase()).toBe("closed");
}, 90_000);

it("u6224_a_press_in_the_centre_closes_the_peek_and_reaches_the_terminal", async () => {
  await closedBenchOverATerminal();
  await evaluate("document.activeElement.blur()");
  await toEdge();
  await waitFor("peek");
  // Before any pointer move can start the grace: the press alone closes the peek, and it is not swallowed.
  expect(await dispatch(".xterm-screen", "pointerdown")).toEqual({ phase: "closed", prevented: false });
  await toCentre();
  await toEdge();
  await waitFor("peek");
  await browser("click", ".xterm-screen");
  expect(await evaluate("!!document.activeElement.closest('.xterm')")).toBe(true);
}, 90_000);

it("u6224_the_terminal_keeps_the_keyboard_during_a_peek", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  await browser("press", "a");
  await pause(100);
  expect(await phase()).toBe("peek");
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => JSON.stringify(call.params)).join('')")).toContain("a");
}, 90_000);

it("u6224_escape_closes_a_peek_and_reaches_no_terminal", async () => {
  await closedBenchOverATerminal();
  await toEdge();
  await waitFor("peek");
  const writes = await calls("terminal.write");

  await browser("press", "Escape");
  await waitFor("closed");
  expect(await calls("terminal.write")).toBe(writes);
}, 90_000);
