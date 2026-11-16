import { cleanup, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { imageFile, pasteEvent } from "../testing/clipboard";
import { info, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";
import { notices } from "../testing/notices";

afterEach(cleanup);

it.each(["read", "write", "save"])("u3560d_clipboard_failure_preserves_input_%s", async operation => {
  const { app, connected, container, emulators } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  connected.rail.select("a");
  flush();
  const emulator = emulators.get("t-a")!;
  const target = container.querySelector("[data-terminal]")!;
  emulator.selectedText = "original unsent 雪";
  const cause = new RpcError(-32603, "pasteboard disconnected");
  const copy = () => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));

  if (operation === "write") { app.clipboardFailure = cause; copy(); }
  else if (operation === "save") { app.saveImageFailure = cause; pasteEvent(target, "", [imageFile()]); }
  else pasteEvent(target, "", [], cause);
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(1));
  const alert = notices("alert")[0]!;
  expect(alert.textContent).toContain(`${operation === "write" ? "Copy" : "Paste"} failed: pasteboard disconnected`);
  expect(alert.textContent).toContain("Try again");
  expect(alert.closest(".pane-failure")).not.toBeNull();
  expect(emulator.selectedText).toBe("original unsent 雪");
  expect(emulator.pasted).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  connected.rail.select("b");
  flush();
  expect(notices("alert")).toHaveLength(0);
  connected.rail.select("a");
  flush();
  expect(notices("alert")[0]!.textContent).toContain(cause.message);
  app.clipboardFailure = null;
  app.saveImageFailure = null;

  // Alternate operations clear the same clipboard failure slot as well.
  if (operation === "write") pasteEvent(container.querySelector('[data-terminal="t-a"]')!, "recovered");
  else container.querySelector('[data-terminal="t-a"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(0));
});

it("u3560d_a_terminal_in_an_open_bubble_shows_its_failure_there_and_not_in_the_pane", async () => {
  const { connected, container, screens } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  flush();
  const cause = new RpcError(-32603, "pasteboard disconnected");
  pasteEvent(container.querySelector("[data-terminal]")!, "", [], cause);
  await vi.waitFor(() => expect(notices("alert")).not.toHaveLength(0));
  screens().viewing("t-a", true);
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(0));
  screens().viewing("t-a", false);
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(1));
  expect(notices("alert")[0]!.textContent).toContain(cause.message);
});
