import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { flush } from "solid-js";
import { linkEntries } from "../ui/contextMenu";
import { info, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "../terminal/paneHarness";

afterEach(cleanup);

it.each(["terminal", "link"])("u3560c_copy_preserves_the_source_%s", async surface => {
  const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  flush();
  const text = "original e\u0301\n雪 🐈";
  emulators.get("t-a")!.selectedText = text;
  const draft = connected.drafts.edit({ surface: "rail", object: "missing-agent", recipient: null }, { text }, null, "ordinary").draft;
  flush();
  const before = connected.drafts.list();
  let expected = text;

  if (surface === "terminal") {
    container.querySelector("[data-terminal]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));
  } else if (surface === "link") {
    const entries = linkEntries(app, { kind: "agent", id: "a" }, connected.rail.nodes, () => true, message => { if (message) throw new Error(message); });
    await entries.find(entry => entry.id === "copy-link")!.run?.();
    expected = "roundup://agent/a?project=project-0000000000000000";
  }

  await vi.waitFor(() => expect(app.clipboardWrites).toEqual([expected]));
  expect(emulators.get("t-a")!.selectedText).toBe(text);
  expect(connected.drafts.list()).toEqual(before);
  expect(connected.drafts.list()).toContainEqual(draft);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it("u3560d_clipboard_failure_preserves_input_copy_action_link", async () => {
  const { app, connected } = await mountPane([terminal("a")], [info("t-a")]);
  const text = "retained exact e\u0301 雪";
  const draft = connected.drafts.edit({ surface: "rail", object: "missing-agent", recipient: null }, { text }, null, "ordinary").draft;
  flush();
  const failure = new Error("pasteboard unavailable");
  app.clipboardFailure = failure;
  let cause: string | null = null;
  const entries = linkEntries(app, { kind: "agent", id: "a" }, connected.rail.nodes, () => true, message => { cause = message; }, () => { cause = null; });
  const invoke = () => entries.find(entry => entry.id === "copy-link")!.run?.();

  await invoke();
  await vi.waitFor(() => expect(cause).toContain(failure.message));
  expect(app.clipboardWrites).toEqual([]);
  expect(connected.drafts.list()).toContainEqual(draft);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  app.clipboardFailure = null;
  await invoke();
  await vi.waitFor(() => expect(cause).toBeNull());
  expect(app.clipboardWrites).toEqual(["roundup://agent/a?project=project-0000000000000000"]);
});
