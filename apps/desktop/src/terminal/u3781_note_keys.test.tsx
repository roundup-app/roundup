import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { CHORDS } from "../keys/chords";
import { node, info, workstream } from "../testing/nodes";
import { press } from "../switcher/switcherFixture";
import { mountNotes, note, noteField, rowsOf, sent } from "./noteQueueHarness";

afterEach(cleanup);

const mount = async () => {
  const mounted = await mountNotes([workstream("w"), node("a", { name: "Ann", parent: "w" })], [info("t-a")]);

  mounted.connected.rail.select("a");

  const field = await noteField("Ann");

  field.focus();

  return { ...mounted, field };
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], ...methods: string[]) => app.calls.filter((call) => methods.includes(call.method)).map((call) => call.method);

const queueing = (app: Awaited<ReturnType<typeof mount>>["app"], held = false) => {
  app.handlers["message.send"] = (params) => note(1, params.body, held ? { status: "held", reason: "takeover" } : {});
  app.handlers["message.deliver"] = () => note(1, "x");
};

it("u3781_enter_queues_one_message_and_interrupts_nothing", async () => {
  const { app, field } = await mount();

  queueing(app);
  fireEvent.input(field, { target: { value: "line" } });
  expect(press("Enter", { shiftKey: true }, field).defaultPrevented).toBe(false);
  expect(calls(app, "message.send")).toEqual([]);

  press("Enter", {}, field);
  await waitFor(() => expect(field.value).toBe(""));
  expect(app.calls.filter((call) => call.method === "message.send").map((call) => call.params)).toEqual([{ to: "a", kind: "note", body: "line", replyTo: null }]);
  expect(calls(app, "agent.interrupt")).toEqual([]);

  app.emit(sent(note(1, "line")));
  await waitFor(() => expect(rowsOf()).toEqual(["line"]));
});

it("u3781_cmd_enter_sends_then_interrupts_and_a_refusal_interrupts_nothing", async () => {
  const { app, field } = await mount();

  queueing(app);
  fireEvent.input(field, { target: { value: "now" } });
  press("Enter", { metaKey: true }, field);
  await waitFor(() => expect(calls(app, "message.send", "message.deliver", "agent.interrupt")).toEqual(["message.send", "agent.interrupt"]));
  expect(app.calls.find((call) => call.method === "agent.interrupt")?.params).toEqual({ id: "a" });

  app.calls.length = 0;
  queueing(app, true);
  fireEvent.input(field, { target: { value: "held" } });
  press("Enter", { metaKey: true }, field);
  await waitFor(() => expect(calls(app, "message.send", "message.deliver", "agent.interrupt")).toEqual(["message.send", "message.deliver", "agent.interrupt"]));

  app.calls.length = 0;
  app.handlers["message.send"] = () => { throw new RpcError(-32602, "refused"); };

  fireEvent.input(field, { target: { value: "no" } });
  press("Enter", { metaKey: true }, field);
  expect(await screen.findByText("refused")).toBeTruthy();
  expect(calls(app, "agent.interrupt")).toEqual([]);
});

it("u3781_note_keys_are_scoped_to_the_field_and_u531_is_unchanged", async () => {
  const { app, connected, field } = await mount();
  const screenTarget = document.querySelector<HTMLElement>(".pane-screen [tabindex]")!;

  expect(CHORDS.filter((chord) => chord.inNote).flatMap((chord) => chord.presses)).toEqual(["Enter", "meta+Enter"]);
  queueing(app);
  fireEvent.input(field, { target: { value: "kept" } });
  screenTarget.focus();
  press("Enter", { metaKey: true }, screenTarget);
  await waitFor(() => expect(connected.takeover.taken()).toBe("a"));
  expect(calls(app, "message.send", "agent.interrupt")).toEqual([]);
  expect(field.value).toBe("kept");
});

it("u3781_a_double_enter_sends_one_message", async () => {
  const { app, field } = await mount();
  let release: () => void = () => {};

  app.handlers["message.send"] = () => new Promise((resolve) => { release = () => resolve(note(1, "once")); });
  fireEvent.input(field, { target: { value: "once" } });
  press("Enter", {}, field);
  press("Enter", {}, field);
  release();
  await waitFor(() => expect(field.value).toBe(""));
  expect(calls(app, "message.send")).toEqual(["message.send"]);
});
