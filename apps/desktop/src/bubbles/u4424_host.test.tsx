import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { subscribed } from "../terminal/paneHarness";
import { bubbleCalls, bubbleChord, mountBubbles } from "./bubblesFixture";

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

afterEach(cleanup);

const open = async (host: boolean) => {
  const mounted = await mountBubbles("w", [], [workstream("w")], host);
  bubbleChord("t");
  await waitFor(() => expect(document.activeElement?.closest(".bubble")?.getAttribute("data-bubble")).toBe("9"));
  await subscribed(mounted.app, "9");

  return mounted;
};

it("u4424a_cmd_t_opens_and_accepts_input_without_a_tab_host", async () => {
  const { app, emulators } = await open(false);
  const bubble = document.querySelector<HTMLElement>('.bubble[data-bubble="9"]')!;
  expect(bubble.isConnected).toBe(true);
  expect(bubble.hidden).toBe(false);
  expect(document.querySelectorAll('.bubble:not([hidden])')).toHaveLength(1);
  const emulator = emulators.made.get("9")!;
  expect(emulator.host?.contains(document.activeElement)).toBe(true);
  emulator.type(new TextEncoder().encode("printf 'hostless ✓'\r"));
  expect(bubbleCalls(app, "terminal.open")).toEqual([{ workstream: "w" }]);
  expect(bubbleCalls(app, "terminal.write")).toEqual([{ id: "9", data: btoa(String.fromCharCode(...new TextEncoder().encode("printf 'hostless ✓'\r"))) }]);
  expect(app.calls.filter(call => /^(terminal.close|agent.spawn|agent.resume|rail.startDoor)$/.test(call.method))).toEqual([]);
});

it("u4424b_tab_host_replacement_keeps_the_bubble_and_terminal", async () => {
  const { app, emulators, setHostPresent } = await open(true);
  const bubble = document.querySelector<HTMLElement>('.bubble[data-bubble="9"]')!;
  const emulator = emulators.made.get("9")!;
  app.emitOutput("9", "before\r\n");
  await waitFor(() => expect(emulator.written).toHaveLength(1));
  setHostPresent(false);
  // MutationObserver delivery is the host-discovery boundary; the Bubble must survive it.
  await waitFor(() => expect(document.querySelector(".resource-strip")).toBeNull());
  expect(bubble.isConnected).toBe(true);
  expect(bubble.hidden).toBe(false);
  expect(emulator.disposed).toBe(false);
  app.emitOutput("9", "absent\r\n");
  await waitFor(() => expect(emulator.written).toHaveLength(2));
  emulator.type(new TextEncoder().encode("absent\r"));
  setHostPresent(true);
  await waitFor(() => expect(document.querySelector(".resource-strip")).not.toBeNull());
  expect(document.querySelector('.bubble[data-bubble="9"]')).toBe(bubble);
  expect(bubble.isConnected).toBe(true);
  expect(bubble.hidden).toBe(false);
  expect(emulators.made.get("9")).toBe(emulator);
  expect(emulator.disposed).toBe(false);
  expect(emulator.written.map(bytes => new TextDecoder().decode(bytes))).toEqual(["before\r\n", "absent\r\n"]);
  emulator.type(new TextEncoder().encode("replaced\r"));
  await waitFor(() => expect(bubbleCalls(app, "terminal.write")).toEqual([
    { id: "9", data: btoa("absent\r") },
    { id: "9", data: btoa("replaced\r") },
  ]));
  expect(bubbleCalls(app, "terminal.open")).toEqual([{ workstream: "w" }]);
  expect(app.calls.filter(call => /^(terminal.close|agent.spawn|agent.resume|rail.startDoor)$/.test(call.method))).toEqual([]);
});
