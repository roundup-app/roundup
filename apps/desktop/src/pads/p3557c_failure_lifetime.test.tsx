import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createSignal, onMount } from "solid-js";
import type { ComponentProps } from "solid-js";
import type { Pad } from "@contracts/pad/Pad";
import type PadRichEditor from "./PadRichEditor";
import { PadDrawer } from "./PadDrawer";
import { ConnectedProjectContext } from "../state/connectedProject";
import { usePadList } from "../rail/pads/padList";
import { USER } from "./owner";
import { deferred, openShelf, padOf, RpcError, waitForReload, writeAdopted } from "./padsFixture";

// Issue #3597 explicitly substitutes the editor binding through its PadEditorHandle contract; capture, submission, RPC and settlement stay real.
// eslint-disable-next-line anti-slop/no-module-mocking
vi.mock("./PadRichEditor", () => ({ default: (props: ComponentProps<typeof PadRichEditor>) => {
  const [text, setText] = createSignal(props.text);
  let baseline = props.text;
  onMount(() => props.onReady({
    getText: () => text() === "unmappable" ? null : text(),
    setText: value => { baseline = value; setText(value); },
    unchanged: () => text() === baseline,
    focus: () => {},
    snapshot: () => ({ source: baseline, text: text(), document: "{}", trailingCaret: false }),
    restoreDocument: () => true,
    selection: () => ({ start: 1, end: 1, direction: "none" }),
    restoreSelection: () => {},
    scrollToHeading: () => {},
  }));

  return <textarea aria-label="Pad body" value={text()} onInput={event => { setText(event.currentTarget.value); props.onChange(); props.onText(text()); }} onFocusOut={event => props.onBlur(event.relatedTarget)} />;
} }));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const open = async (recovery = false) => {
  const original = padOf("notes", USER, "old");
  const other = padOf("other", USER, "unrelated");
  const setup = await openShelf([original, other]);
  const acknowledged = vi.fn();
  const lateFailure = vi.fn();
  // openShelf's DrawerHost keeps the same App/Project owner through closure.

  const Body = () => {
    const list = usePadList();

    const retained = recovery ? setup.connected.drafts.edit({ surface: "pads", object: original.incarnation, recipient: null }, { originalName: "notes", source: "retained", base: "old", baseRevision: 1 }, null, "ordinary", null).draft : null;

    return <PadDrawer name="notes" pads={list.pads} {...(retained ? { recovery: { project: "/p", revision: retained.revision, list } } : {})} onLateFailure={lateFailure} onAcknowledged={acknowledged} />;
  };

  setup.connected.drawer.open(() => <ConnectedProjectContext.Provider value={setup.connected}><Body /></ConnectedProjectContext.Provider>, "key");
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Pad body" });

  return { ...setup, original, other, acknowledged, lateFailure, field };
};

it.each(["open", "closed", "other", "recreated"])("p3557c_failure_lifetime_acknowledges_original_%s", async mode => {
  const { app, state, connected, original, other, field, acknowledged } = await open();
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = ({ text }) => {
    if (text !== "submitted") throw new RpcError(-32000, "Newer save refused");

    return reply.promise;
  };

  fireEvent.input(field, { target: { value: "submitted" } });
  fireEvent.focusOut(field);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);
  fireEvent.input(field, { target: { value: "newer\n  exact ☕  " } });

  const newer = connected.drafts.list().at(-1)!;
  state.pads = [{ ...original, text: "submitted", revision: 2 }, other];
  const before = app.calls.filter(call => call.method === "pad.list").length;
  app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });
  await waitForReload(app, before);
  expect(acknowledged).not.toHaveBeenCalled();

  if (mode !== "open") connected.drawer.close("key");

  if (mode === "other" || mode === "recreated") {
    const current = mode === "other" ? other : { ...original, incarnation: "replacement-notes" };
    state.pads = [current, ...(mode === "other" ? [original] : [other])];
    connected.drawer.open(() => <ConnectedProjectContext.Provider value={connected}><PadDrawer name={current.name} pads={() => state.pads} onLateFailure={() => {}} onAcknowledged={acknowledged} /></ConnectedProjectContext.Provider>, "key");
    await screen.findByRole("textbox", { name: "Pad body" });
  }

  reply.resolve({ ...original, text: "submitted", revision: 2 });
  await waitFor(() => expect(acknowledged.mock.calls).toEqual([["fixture-notes"]]));
  expect(connected.drafts.list()).toContainEqual(expect.objectContaining({ revision: newer.revision, destination: newer.destination, value: newer.value, selection: newer.selection }));

  if (mode === "open") expect(field.value).toBe("newer\n  exact ☕  ");
});

it.each(["failed", "closed-failed", "unknown", "mapping", "discard"])("p3557c_failure_lifetime_does_not_acknowledge_%s", async mode => {
  const { app, connected, original, field, acknowledged, lateFailure } = await open();
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  fireEvent.input(field, { target: { value: mode === "mapping" ? "unmappable" : "submitted" } });
  fireEvent.focusOut(field);

  if (mode === "mapping") {
    expect(app.calls.filter(call => call.method === "pad.write")).toEqual([]);
  } else {
    expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);

    if (mode === "closed-failed") connected.drawer.close("key");
    reply.reject(mode !== "unknown" ? new RpcError(mode === "discard" ? -32003 : -32000, "Write refused") : new Error("Reply lost"));

    if (mode === "closed-failed") await waitFor(() => expect(lateFailure).toHaveBeenCalledWith("Write refused"));
    else await screen.findByText(mode === "unknown" ? "Reply lost" : mode === "discard" ? "Pad changed" : "Write refused");

    if (mode === "unknown") {
      app.handlers["pad.read"] = () => ({ ...original, text: "submitted" });
      fireEvent.click(screen.getByText("Resume"));
      await waitFor(() => expect(app.calls.filter(call => call.method === "pad.read")).toHaveLength(2));
      await writeAdopted();
    }

    if (mode === "discard") {
      fireEvent.click(screen.getByText("Use theirs"));
      expect(connected.drafts.list()).toEqual([]);
    }
  }

  expect(acknowledged).not.toHaveBeenCalled();
});

// Recovery is a read of retained work; only its explicit resumed write can acknowledge.
it.each([false, true])("p3557c_failure_lifetime_recovery_acknowledges_only_resumed_write_%s", async close => {
  const { app, connected, original, acknowledged } = await open(true);
  const reply = deferred<Pad>();
  app.handlers["pad.write"] = () => reply.promise;
  expect(acknowledged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Resume"));
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1);

  if (close) connected.drawer.close("key");
  reply.resolve({ ...original, text: "retained", revision: 2 });
  await waitFor(() => expect(acknowledged.mock.calls).toEqual([["fixture-notes"]]));
  expect(connected.drafts.list()).toEqual([]);
});
