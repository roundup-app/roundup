import { createRoot } from "solid-js";
import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { bubbleCalls, bubbleChord, mountBubbles } from "../bubbles/bubblesFixture";
import { workstream } from "../testing/nodes";
import { createScreens } from "./screens";
import { connectFakeProject, fakeEmulators } from "./paneHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("u4590_unready_destination_fails_and_releases_only_its_preparation", async () => {
  const { connected } = await connectFakeProject([]);
  const { factory, made } = fakeEmulators();

  const { screens, dispose } = createRoot(dispose => ({
    dispose,
    screens: createScreens(connected, (id, copy) => {
      const emulator = factory(id, copy);
      emulator.prepare = () => new Promise(() => {});

      return emulator;
    }),
  }));

  const existing = screens.emulatorFor("existing");
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const pending = screens.prepare(document.createElement("div"));
  const rejected = expect(pending).rejects.toThrow();
  deadline.abort(new DOMException("Destination did not become ready", "TimeoutError"));
  await rejected;
  expect([...made.values()].filter(emulator => emulator.disposed)).toHaveLength(1);
  expect(screens.emulatorFor("existing")).toBe(existing);
  expect(made.get("existing")!.disposed).toBe(false);
  screens.dispose();
  dispose();
});

it("u4590_preparing_shell_offers_close_and_minimise_only_after_launch_receipt", async () => {
  const { app } = await mountBubbles("w", [], [workstream("w")]);
  const reply = Promise.withResolvers<{ terminal_id: string }>();
  const open = app.handlers["terminal.open"]!;
  app.handlers["terminal.open"] = () => reply.promise;
  bubbleChord("t");
  await waitFor(() => expect(bubbleCalls(app, "terminal.open")).toHaveLength(1));
  const preparing = document.querySelector<HTMLElement>('.bubble:not([hidden])')!;
  expect(preparing.querySelector('[aria-label="Close"]')).toBeNull();
  expect(preparing.querySelector('[aria-label="Minimise"]')).toBeNull();
  reply.resolve(await open({ workstream: "w" }));
  await waitFor(() => expect(preparing.getAttribute("data-bubble")).toBe("9"));
  const minimise = preparing.querySelector<HTMLElement>('[aria-label="Minimise"]')!;
  expect(preparing.querySelector('[aria-label="Close"]')).not.toBeNull();
  fireEvent.click(minimise);
  await waitFor(() => expect(preparing.hidden).toBe(true));
  expect(bubbleCalls(app, "terminal.close")).toEqual([]);
  expect(bubbleCalls(app, "terminal.open")).toHaveLength(1);
});
