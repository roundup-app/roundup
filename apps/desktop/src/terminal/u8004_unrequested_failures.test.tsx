import { cleanup } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { appLog } from "../app/log";
import { copy } from "../app/copy";
import { info, terminal } from "../testing/nodes";
import { notice, notices } from "../testing/notices";
import { mountPane } from "./paneHarness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RAW = "Unknown error while interacting with the clipboard: NSPasteboard#writeObjects: returned false";

const mountFailing = async () => {
  const lines: string[] = [];

  vi.spyOn(appLog, "write").mockImplementation(line => { lines.push(line); });

  const mounted = await mountPane([terminal("a")], [info("t-a")]);
  mounted.connected.rail.select("a");
  flush();

  const emulator = mounted.emulators.get("t-a");

  if (!emulator) throw new Error("no emulator");

  mounted.app.clipboardFailure = new Error(RAW);
  emulator.selectedText = "selected";

  const target = mounted.container.querySelector("[data-terminal]");

  if (!target) throw new Error("no terminal");

  return { emulator, lines, copyKey: () => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true })) };
};

it("u8004a_a_program_clipboard_write_failure_only_logs", async () => {
  const { emulator, lines } = await mountFailing();

  await emulator.programCopy("");
  expect(lines).toEqual([]);

  await emulator.programCopy("from the program");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(RAW);
  flush();
  expect(notices("alert")).toHaveLength(0);
  expect(document.querySelector("[title]")).toBeNull();
});

it("u8004b_a_user_copy_failure_is_plain_and_logged", async () => {
  const { copyKey, lines } = await mountFailing();

  copyKey();
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(1));

  const text = notice("alert").textContent;

  expect(text).toContain(copy.clipboardCopyRetry);
  expect(/NSPasteboard|writeObjects/.test(text)).toBe(false);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(RAW);
});

it("u8004c_no_notice_repeats_itself_in_a_tooltip", async () => {
  const { copyKey } = await mountFailing();

  copyKey();
  await vi.waitFor(() => expect(notices("alert")).toHaveLength(1));
  expect(document.querySelector("[title]")).toBeNull();
});
