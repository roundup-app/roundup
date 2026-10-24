import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { info, node } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountPane } from "./paneHarness";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, metaKey: true }));

it.each(["dismissal", "clipboard success keeps output failure"] as const)("p3557c_failure_lifetime_screens_%s", async (action) => {
  const readText = vi.fn(async () => "");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText, writeText: vi.fn(async () => {}) } });

  const { app, connected, container } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);

  app.outputFailure = new RpcError(-32603, "channel refused");
  connected.rail.select("a");
  await screen.findByRole("alert", { name: "terminal.output: channel refused" });

  const calls = app.calls.length;

  if (action === "dismissal") {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(app.calls.length).toBe(calls);
  }

  if (action === "clipboard success keeps output failure") {
    readText.mockResolvedValueOnce("ok");
    press(container.querySelector("[data-terminal]")!, "v");
    await waitFor(() => expect(readText).toHaveBeenCalled());
    expect(screen.getByRole("alert", { name: "terminal.output: channel refused" })).toBeTruthy();
  }
});
