import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { agent, info } from "../testing/nodes";
import { callsTo, fakeEmulators } from "../terminal/paneHarness";

// jsdom has no ClipboardEvent/DataTransfer implementation. Inject only that platform edge.
const paste = (target: Element, text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text, files: [], items: [] } });
  target.dispatchEvent(event);
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("u3560b_paste_reaches_only_the_focused_terminal", async () => {
  localStorage.clear();
  const forbidden = vi.fn(() => { throw new DOMException("permission denied", "NotAllowedError"); });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read: forbidden, readText: forbidden, writeText: forbidden } });
  const app = createFakeApp();
  app.add("/project");
  app.handlers["rail.tree"] = () => [agent("a", "idle", "x"), agent("b", "idle", "x")];
  app.handlers["terminal.list"] = () => [info("t-a"), info("t-b")];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: 0, data: "" });
  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.write"] = () => null;
  const { factory, made } = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} />);
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="a"]')).not.toBeNull());
  fireEvent.click(document.querySelector('.rail-row[data-id="a"]')!);
  await waitFor(() => expect(made.has("t-a")).toBe(true));
  const target = document.querySelector('[data-terminal="t-a"]')!;
  paste(target, "one\n雪 🐈\n");
  await waitFor(() => expect(made.get("t-a")!.pasted).toEqual(["one\n雪 🐈\n"]));
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "b25lCumbqiDwn5CICg==" }]);
  expect(forbidden).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});
