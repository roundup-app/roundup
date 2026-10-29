import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, CONFLICT, openShelf, RpcError } from "./padsFixture";

afterEach(cleanup);

// The frozen N7 inventory pins this historical path; its surviving creation proofs now run in jsdom.
const calls = (app: { calls: { method: string; params?: unknown }[] }, ...methods: string[]) => app.calls.filter(call => methods.includes(call.method));

const name = async (value: string) => {
  fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));
  const field = await screen.findByLabelText<HTMLInputElement>("Pad name");

  fireEvent.input(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });

  return field;
};

it("u3731_a_pad_made_under_an_agent_is_owned_by_it_and_listed_in_its_group", async () => {
  const { app, connected } = await openShelf([], true);

  connected.rail.select(AGENT.id);
  await name("notes");
  await waitFor(() => expect(calls(app, "pad.create", "pad.setOwner")).toHaveLength(2));

  expect(calls(app, "pad.create", "pad.setOwner")).toEqual([
    { method: "pad.create", params: { name: "notes", text: null } },
    { method: "pad.setOwner", params: { name: "notes", owner: AGENT } },
  ]);
  app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });
  await waitFor(() => expect(document.querySelector(`[data-shelf-group="${AGENT.id}"] [data-pad="notes"]`)).toBeTruthy());
});

it("u3731_another_selection_keeps_the_user_as_owner", async () => {
  const { app, connected } = await openShelf([], true);

  connected.rail.select(null);
  await name("notes");
  await waitFor(() => expect(calls(app, "pad.create")).toHaveLength(1));

  expect(calls(app, "pad.setOwner")).toEqual([]);
});

it("u3731_a_refused_step_keeps_the_name_and_shows_its_cause", async () => {
  const { app, connected } = await openShelf([], true);
  const create = app.handlers["pad.create"]!;

  connected.rail.select(AGENT.id);
  app.handlers["pad.create"] = () => { throw new RpcError(CONFLICT, "pad notes exists"); };

  const field = await name("notes");

  expect(await screen.findByText("pad notes exists")).toBeTruthy();
  expect(field.value).toBe("notes");

  app.handlers["pad.create"] = create;
  app.handlers["pad.setOwner"] = () => { throw new RpcError(-32004, "agent gone"); };

  fireEvent.keyDown(field, { key: "Enter" });

  expect(await screen.findByText(/stays yours: agent gone/)).toBeTruthy();
  expect(field.value).toBe("notes");
});

