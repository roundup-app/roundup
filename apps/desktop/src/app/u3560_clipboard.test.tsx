import { pasteEvent, imageFile } from "../testing/clipboard";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door, info } from "../testing/nodes";
import { callsTo, fakeEmulators } from "../terminal/paneHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["agent", "door", "bubble"].flatMap(placement => ["text", "image"].map(payload => ({ placement, payload }))))("u3560b_paste_reaches_only_the_focused_terminal_$placement/$payload", async ({ placement, payload }) => {
  localStorage.clear();
  const forbidden = vi.fn(() => { throw new DOMException("permission denied", "NotAllowedError"); });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: forbidden, readText: forbidden, writeText: forbidden } });
  const app = createFakeApp();
  app.add("/project");
  app.handlers["rail.tree"] = () => [placement === "door" ? door("a", "idle", "x") : agent("a", "idle", "x"), agent("b", "idle", "x")];
  app.handlers["terminal.list"] = () => [info("t-a"), info("t-b"), info("plain", { owner: "a" })];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  const { factory, made } = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} />);
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="a"]')).not.toBeNull());
  fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  await waitFor(() => expect(made.has("t-a")).toBe(true));

  if (placement === "bubble") {
    window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: "plain" }));
    await waitFor(() => expect(document.querySelector('[data-terminal="plain"]')).not.toBeNull());
  }

  const id = placement === "bubble" ? "plain" : "t-a";
  made.get(id)!.focus();
  const target = document.querySelector(`[data-terminal="${id}"]`)!;
  const expected = payload === "text" ? "one\n雪 🐈\n" : "'/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png' ";
  pasteEvent(target, payload === "text" ? expected : "", payload === "image" ? [imageFile()] : []);
  await waitFor(() => expect(made.get(id)!.pasted).toEqual([expected]));
  expect(callsTo(app, "terminal.write")).toEqual([{ id, data: payload === "text" ? "b25lCumbqiDwn5CICg==" : btoa(expected) }]);
  expect(app.savedImages).toEqual(payload === "image" ? [{ type: "image/png", bytes: Uint8Array.of(137, 80, 78, 71) }] : []);
  expect(forbidden).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});
