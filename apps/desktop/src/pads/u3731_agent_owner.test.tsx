import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { CHORDS, HELP_ROWS } from "../keys/chords";
import { copy } from "../copy";
import { USER } from "../testing/nodes";
import { AGENT, CONFLICT, openShelf, padOf, RpcError } from "./padsFixture";

afterEach(cleanup);

const calls = (app: { calls: { method: string; params?: unknown }[] }, ...methods: string[]) => app.calls.filter(call => methods.includes(call.method));

const groups = () => [...document.querySelectorAll("[data-shelf-group]")].map(el => el.getAttribute("data-shelf-group"));

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

const mount = async () => {
  const shelf = await openShelf([padOf("mine", USER), padOf("theirs", AGENT), padOf("lost", { kind: "agent", id: "gone", parent: null })], true);

  await waitFor(() => expect(groups()).toEqual(["me", AGENT.id, "unassigned"]));

  return shelf;
};

const assignWord = (pad: string) => document.querySelector<HTMLElement>(`[data-pad="${pad}"] [aria-label="assign ${pad}"]`)!;

const row = (pad: string) => document.querySelector<HTMLElement>(`[data-pad="${pad}"]`)!;

it("u3732_pads_group_by_owner_once_each", async () => {
  await mount();
  const own = (id: string) => [...document.querySelectorAll(`[data-shelf-group="${id}"] [data-pad]`)].map(el => el.getAttribute("data-pad"));

  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);
  expect([own("me"), own(AGENT.id), own("unassigned")]).toEqual([["mine"], ["theirs"], ["lost"]]);
});

it("u3732_o_and_the_assign_word_open_the_owner_list_and_return_focus", async () => {
  const { app } = await mount();
  const button = within(row("theirs")).getByRole("button", { name: "theirs" });

  button.focus();
  fireEvent.keyDown(button, { key: "o", code: "KeyO" });
  const list = await screen.findByRole("menu", { name: "Owners for theirs" });

  expect(within(list).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Me"]);
  fireEvent.click(within(list).getByText("Me"));
  await waitFor(() => expect(calls(app, "pad.setOwner")).toEqual([{ method: "pad.setOwner", params: { name: "theirs", owner: USER } }]));
  app.emit({ actor: USER, name: "pad.changed", data: { name: "theirs" } });
  await waitFor(() => expect(document.querySelector('[data-shelf-group="me"] [data-pad="theirs"]')).toBeTruthy());
  await waitFor(() => expect(document.activeElement?.closest("[data-pad]")?.getAttribute("data-pad")).toBe("theirs"));

  fireEvent.click(assignWord("mine"));
  expect(await screen.findByRole("menu", { name: "Owners for mine" })).toBeTruthy();
});

it("u3732_a_refused_reassign_keeps_the_row_and_shows_its_cause", async () => {
  const { app } = await mount();

  app.handlers["pad.setOwner"] = () => { throw new RpcError(-32004, "no such owner"); };

  fireEvent.click(assignWord("theirs"));
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));

  expect(await screen.findByText(/no such owner/)).toBeTruthy();
  expect(document.querySelector(`[data-shelf-group="${AGENT.id}"] [data-pad="theirs"]`)).toBeTruthy();
});

it("u3732_home_is_unchanged_by_an_owner_change", async () => {
  const { app } = await mount();

  fireEvent.click(assignWord("theirs"));
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));
  await waitFor(() => expect(calls(app, "pad.setOwner")).toHaveLength(1));

  expect(calls(app, "pad.move")).toEqual([]);
});

it("u3732_the_key_is_registered_and_listed_in_help", () => {
  expect(CHORDS.filter(chord => chord.presses.includes("KeyO"))).toHaveLength(1);
  expect(HELP_ROWS).toContainEqual(expect.objectContaining({ keys: "O", what: copy.assignTodo }));
});
