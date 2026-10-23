import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { imageFile, pasteEvent } from "../testing/clipboard";
import { info, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";

afterEach(cleanup);

it.each(["read", "write", "save"])("u3560d_clipboard_failure_preserves_input_%s", async operation => {
  const { app, connected, container, emulators } = await mountPane([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  connected.rail.select("a");
  const emulator = emulators.get("t-a")!;
  const target = container.querySelector("[data-terminal]")!;
  emulator.selectedText = "original unsent 雪";
  const cause = new RpcError(-32603, "pasteboard disconnected");
  const copy = () => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));

  if (operation === "write") { app.clipboardFailure = cause; copy(); }
  else if (operation === "save") { app.saveImageFailure = cause; pasteEvent(target, "", [imageFile()]); }
  else pasteEvent(target, "", [], cause);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(`${operation === "write" ? "Copy" : "Paste"} failed: pasteboard disconnected`);
  expect(alert.textContent).toContain("Try again");
  expect(alert.closest(".pane-failure")).not.toBeNull();
  expect(emulator.selectedText).toBe("original unsent 雪");
  expect(emulator.pasted).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  connected.rail.select("b");
  expect(screen.queryByRole("alert")).toBeNull();
  connected.rail.select("a");
  expect(screen.getByRole("alert").textContent).toContain("pasteboard disconnected");
  app.clipboardFailure = null;
  app.saveImageFailure = null;

  // Alternate operations clear the same clipboard failure slot as well.
  if (operation === "write") pasteEvent(container.querySelector('[data-terminal="t-a"]')!, "recovered");
  else container.querySelector('[data-terminal="t-a"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));
  await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
