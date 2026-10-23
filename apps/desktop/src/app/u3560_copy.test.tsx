import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { DrawerHost } from "../drawer/DrawerHost";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import { linkEntries } from "../ui/contextMenu";
import { info, terminal } from "../testing/nodes";
import { callsTo, mountPane } from "../terminal/paneHarness";

const Recovery = () => {
  const menu = useRecoveryMenu();

  return <button onClick={() => void menu()[0]?.run?.()}>Recover</button>;
};

afterEach(cleanup);

it.each(["terminal", "link", "draft"])("u3560c_copy_preserves_the_source_%s", async surface => {
  const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);
  connected.rail.select("a");
  const text = "original e\u0301\n雪 🐈";
  emulators.get("t-a")!.selectedText = text;
  const draft = connected.drafts.edit({ surface: "rail", object: "missing-agent", recipient: null }, { text }, null, "ordinary").draft;
  const before = connected.drafts.list();
  let expected = text;

  if (surface === "terminal") {
    container.querySelector("[data-terminal]")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "c", metaKey: true }));
  } else if (surface === "link") {
    const entries = linkEntries(app, { kind: "agent", id: "a" }, connected.rail.nodes, () => true, message => { if (message) throw new Error(message); });
    await entries.find(entry => entry.id === "copy-link")!.run?.();
    expected = "roundup://agent/a?project=project-0000000000000000";
  } else {
    render(() => <ConnectedProjectContext.Provider value={connected}><Recovery /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    const region = await screen.findByRole("region", { name: "Unfinished work" });
    fireEvent.click(within(region).getByRole("button", { name: "Copy" }));
  }

  await vi.waitFor(() => expect(app.clipboardWrites).toEqual([expected]));
  expect(emulators.get("t-a")!.selectedText).toBe(text);
  expect(connected.drafts.list()).toEqual(before);
  expect(connected.drafts.list()).toContainEqual(draft);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it.each(["link", "draft"])("u3560d_clipboard_failure_preserves_input_copy_action_%s", async surface => {
  const { app, connected } = await mountPane([terminal("a")], [info("t-a")]);
  const text = "retained exact e\u0301 雪";
  const draft = connected.drafts.edit({ surface: "rail", object: "missing-agent", recipient: null }, { text }, null, "ordinary").draft;
  app.clipboardFailure = new Error("pasteboard unavailable");
  let cause: string | null = null;
  let invoke: () => void | Promise<void>;

  if (surface === "link") {
    const entries = linkEntries(app, { kind: "agent", id: "a" }, connected.rail.nodes, () => true, message => { cause = message; });
    invoke = () => entries.find(entry => entry.id === "copy-link")!.run?.();
  } else {
    render(() => <ConnectedProjectContext.Provider value={connected}><Recovery /><DrawerHost drawer={connected.drawer} reducedMotion={() => true} /></ConnectedProjectContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    const region = await screen.findByRole("region", { name: "Unfinished work" });
    invoke = () => { fireEvent.click(within(region).getByRole("button", { name: "Copy" })); };
  }

  await invoke();
  await vi.waitFor(() => expect(surface === "link" ? cause : screen.getByRole("alert").textContent).toContain("Copy failed: pasteboard unavailable"));
  expect(app.clipboardWrites).toEqual([]);
  expect(connected.drafts.list()).toContainEqual(draft);
  expect(callsTo(app, "terminal.write")).toEqual([]);
  app.clipboardFailure = null;
  await invoke();
  await vi.waitFor(() => expect(surface === "link" ? cause : screen.queryByRole("alert")).toBeNull());
  expect(app.clipboardWrites).toEqual([surface === "link" ? "roundup://agent/a?project=project-0000000000000000" : text]);
});
