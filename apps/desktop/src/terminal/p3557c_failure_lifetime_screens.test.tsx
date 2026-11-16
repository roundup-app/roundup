import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { info, node } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { pasteEvent } from "../testing/clipboard";
import { mountPane } from "./paneHarness";
import { notices } from "../testing/notices";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["dismissal", "clipboard success keeps output failure"] as const)("p3557c_failure_lifetime_screens_%s", async (action) => {
  const { app, connected, container } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);

  app.outputFailure = new RpcError(-32603, "channel refused");
  connected.rail.select("a");
  await screen.findByRole("alert", { name: /^Terminal output stopped\.\s+channel refused$/ });

  const calls = app.calls.length;

  if (action === "dismissal") {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(notices("alert")).toHaveLength(0));
    expect(app.calls.length).toBe(calls);
  }

  if (action === "clipboard success keeps output failure") {
    pasteEvent(container.querySelector("[data-terminal]")!, "ok");
    await waitFor(() => expect(app.calls.length).toBeGreaterThan(calls));
    expect(notices("alert")).toHaveLength(1);
  }
});


it("u3791c_terminal_replacement_keeps_failure_ownership", async () => {
  const { app, connected, screens, emulators } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);
  app.outputFailure = new RpcError(-32603, "first connection failure");
  connected.rail.select("a");
  await waitFor(() => expect(screens().failure("t-a")).not.toBeNull());
  app.outputFailure = new RpcError(-32603, "second connection failure");
  connected.rail.select("b");
  await waitFor(() => expect(screens().failure("t-b")).not.toBeNull());
  expect(screens().failure("t-a")).toBeNull();
  const current = screens().failure("t-b");
  screens().dismiss("t-a");
  flush();
  expect(screens().failure("t-b")).toBe(current);
  app.clipboardFailure = new Error("clipboard permission refused");
  emulators.get("t-b")!.selectedText = "exact clipboard input";
  await screens().copy("t-b");
  flush();
  screens().dismiss("t-b");
  flush();
  expect(screens().failure("t-b")).toBe(current);
});
