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

it.each(["Close", "Escape"])("u4590_preparing_shell_cancel_closes_pending_launch_and_restores_focus_%s", async cancel => {
  const { app } = await mountBubbles("w", [], [workstream("w")]);
  const reply = Promise.withResolvers<{ terminal_id: string }>();
  const open = app.handlers["terminal.open"]!;
  app.handlers["terminal.open"] = () => reply.promise;
  const opener = document.querySelector<HTMLElement>(".terminal-new")!;
  opener.focus();
  bubbleChord("t");
  await waitFor(() => expect(bubbleCalls(app, "terminal.open")).toHaveLength(1));
  const preparing = document.querySelector<HTMLElement>('.bubble:not([hidden])')!;
  if (cancel === "Close") fireEvent.click(preparing.querySelector<HTMLElement>('[aria-label="Close"]')!);
  else fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(opener));
  reply.resolve(await open({ workstream: "w" }));
  await waitFor(() => expect(bubbleCalls(app, "terminal.close")).toEqual([{ id: "9" }]));
  await waitFor(() => expect(preparing.isConnected).toBe(false));
  expect(bubbleCalls(app, "terminal.open")).toHaveLength(1);
});

it("u4590_failed_shell_can_retry_opening", async () => {
  const { app, container } = await mountBubbles("w", [], [workstream("w")]);
  const open = app.handlers["terminal.open"]!;
  app.handlers["terminal.open"] = () => { throw new Error("Terminal font did not load"); };

  bubbleChord("t");
  await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  app.handlers["terminal.open"] = open;
  const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  fireEvent.click(retry);
  await waitFor(() => expect(document.querySelector('.bubble[data-bubble="9"]')).not.toBeNull());
  expect(bubbleCalls(app, "terminal.open")).toHaveLength(2);
});
