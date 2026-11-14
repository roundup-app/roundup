import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { copy } from "./copy";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const send = async (mounted: Awaited<ReturnType<typeof mountRail>>, choose?: string) => {
  mounted.app.handlers["agent.spawn"] = () => workstream("spawned");
  fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
  const field = screen.getByLabelText<HTMLTextAreaElement>("Work");

  if (choose) {
    fireEvent.click(await screen.findByRole("combobox", { name: copy.startMachine }));
    fireEvent.click(await screen.findByRole("option", { name: choose }));
  }

  fireEvent.input(field, { target: { value: "go" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));

  return railCallsTo(mounted.app, "agent.spawn")[0];
};

it("mc34_override_starts_on_named_machine", async () => {
  const mounted = await mountRail([workstream("w")], [], undefined, undefined, { machines: [{ name: "box", details: {} }] });
  const call = await send(mounted, "box");
  expect(call).toMatchObject({ machine: "box" });
});

it("mc34_no_override_leaves_the_pick_to_the_door", async () => {
  const mounted = await mountRail([workstream("w")], [], undefined, undefined, { machines: [{ name: "box", details: {} }] });
  await waitFor(() => expect(mounted.app.calls.some(call => call.method === "machine.list")).toBe(true));
  const call = await send(mounted);
  expect(call).toEqual(expect.not.objectContaining({ machine: expect.anything() }));
});

it("mc34_no_machine_field_while_this_mac_is_the_only_machine", async () => {
  const mounted = await mountRail([workstream("w")]);
  await waitFor(() => expect(mounted.app.calls.some(call => call.method === "machine.list")).toBe(true));
  fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
  await screen.findByLabelText("Work");
  expect(screen.queryByRole("combobox", { name: copy.startMachine })).toBeNull();
});
