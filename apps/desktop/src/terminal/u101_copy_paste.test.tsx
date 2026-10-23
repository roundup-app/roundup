import { cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonExit } from "../app/seam";
import { pasteEvent } from "../testing/clipboard";
import { info, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "./paneHarness";

const key = (target: Element, key: string, options: Record<string, boolean> = {}) => {
  const press = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options });
  target.dispatchEvent(press);

  return press;
};

afterEach(cleanup);

it("u101_command_c_copies_only_selected_text_and_control_c_still_types", async () => {
  const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  const emulator = emulators.get("t-a")!;
  const target = container.querySelector("[data-terminal]")!;
  const emulatedKey = vi.fn();
  target.addEventListener("keydown", emulatedKey);
  emulator.selectedText = "selected text";
  expect(key(target, "c", { metaKey: true }).defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(app.clipboardWrites).toEqual(["selected text"]));
  expect(callsTo(app, "terminal.write")).toEqual([]);
  expect(emulatedKey).not.toHaveBeenCalled();
  emulator.selectedText = "";
  key(target, "c", { metaKey: true });
  expect(app.clipboardWrites).toHaveLength(1);
  expect(key(target, "c", { ctrlKey: true }).defaultPrevented).toBe(false);
  emulator.type(Uint8Array.of(3));
  await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "Aw==" }]));
});

it("u101_empty_clipboard_and_modified_chords_do_nothing", async () => {
  const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  const target = container.querySelector("[data-terminal]")!;
  emulators.get("t-a")!.selectedText = "text";
  pasteEvent(target);

  for (const chord of [{ key: "c", shiftKey: true }, { key: "c", altKey: true }, { key: "v", shiftKey: true }, { key: "v", altKey: true }]) {
    expect(key(target, chord.key, { metaKey: true, shiftKey: chord.shiftKey ?? false, altKey: chord.altKey ?? false }).defaultPrevented).toBe(chord.key === "v");
  }

  await Promise.resolve();
  expect(emulators.get("t-a")!.pasted).toEqual([]);
  expect(app.clipboardWrites).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it("u101_chords_leave_other_fields_to_the_browser", async () => {
  const { app, connected, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  const field = document.createElement("textarea");
  container.querySelector(".pane-screen")!.append(field);
  field.focus();
  expect(key(field, "c", { metaKey: true }).defaultPrevented).toBe(false);
  expect(key(field, "v", { metaKey: true }).defaultPrevented).toBe(false);
  expect(pasteEvent(field, "field paste").defaultPrevented).toBe(false);
  expect(app.clipboardWrites).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it("u101_exited_terminal_and_daemon_exited_copy_but_never_paste", async () => {
  const [exit, setExit] = createSignal<DaemonExit | null>(null);
  const { app, connected, emulators, container } = await mountPane([terminal("a"), terminal("b")], [info("t-a", { running: false, exit_code: 0 }), info("t-b")], 0, exit);
  connected.rail.select("a");
  emulators.get("t-a")!.selectedText = "exited copy";
  key(container.querySelector("[data-terminal='t-a']")!, "c", { metaKey: true });
  pasteEvent(container.querySelector("[data-terminal='t-a']")!, "paste");
  connected.rail.select("b");
  setExit({ code: 1 });
  emulators.get("t-b")!.selectedText = "daemon copy";
  key(container.querySelector("[data-terminal='t-b']")!, "c", { metaKey: true });
  pasteEvent(container.querySelector("[data-terminal='t-b']")!, "paste");
  await vi.waitFor(() => expect(app.clipboardWrites).toEqual(["exited copy", "daemon copy"]));
  expect(emulators.get("t-a")!.pasted).toEqual([]);
  expect(emulators.get("t-b")!.pasted).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});
