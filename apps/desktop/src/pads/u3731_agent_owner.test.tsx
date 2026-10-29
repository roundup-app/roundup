import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { USER } from "../testing/nodes";
import { AGENT, openShelf, padOf, RpcError } from "./padsFixture";

afterEach(cleanup);

const calls = (app: { calls: { method: string; params?: unknown }[] }, ...methods: string[]) => app.calls.filter(call => methods.includes(call.method));

const groups = () => [...document.querySelectorAll("[data-shelf-group]")].map(el => el.getAttribute("data-shelf-group"));

const mount = async () => {
  const shelf = await openShelf([padOf("mine", USER), padOf("theirs", AGENT), padOf("lost", { kind: "agent", id: "gone", parent: null })], true);

  await waitFor(() => expect(groups()).toEqual([AGENT.id, "unassigned"]));

  return shelf;
};

const assignMenu = async (app: { pickMenu(label: string): Promise<void> }, pad: string) => {
  fireEvent.contextMenu(row(pad));
  await app.pickMenu("Assign");
};

const row = (pad: string) => document.querySelector<HTMLElement>(`[data-pad="${pad}"]`)!;

it("u2744a_root_home_pads_use_agent_or_unassigned_placement", async () => {
  await mount();
  const own = (id: string) => [...document.querySelectorAll(`[data-shelf-group="${id}"] [data-pad]`)].map(el => el.getAttribute("data-pad"));

  fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]')!);
  expect([own("me"), own(AGENT.id), own("unassigned")]).toEqual([[], ["theirs"], ["mine", "lost"]]);
});

it("u3732_o_and_assign_menu_open_the_owner_list_and_return_focus", async () => {
  const { app } = await mount();
  const button = within(row("theirs")).getByRole("button", { name: "theirs" });

  button.focus();
  fireEvent.keyDown(button, { key: "o", code: "KeyO" });
  const list = await screen.findByRole("menu", { name: "Owners for theirs" });

  expect(within(list).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Me"]);
  fireEvent.click(within(list).getByText("Me"));
  await waitFor(() => expect(calls(app, "pad.setOwner")).toEqual([{ method: "pad.setOwner", params: { name: "theirs", owner: USER } }]));
  app.emit({ actor: USER, name: "pad.changed", data: { name: "theirs" } });
  await waitFor(() => expect(document.querySelector('[data-shelf-group="unassigned"] [data-pad="theirs"]')).toBeTruthy());
  await waitFor(() => expect(document.activeElement?.closest("[data-pad]")?.getAttribute("data-pad")).toBe("theirs"));

  if (row("mine").closest("[hidden]")) fireEvent.click(document.querySelector('[data-shelf-group="unassigned"] .shelf-group-control')!);
  await assignMenu(app, "mine");
  const owners = await screen.findByRole("menu", { name: "Owners for mine" });
  expect(owners.contains(document.activeElement)).toBe(true);
});

it("u3732_a_refused_reassign_keeps_the_row_and_shows_its_cause", async () => {
  const { app } = await mount();

  app.handlers["pad.setOwner"] = () => { throw new RpcError(-32004, "no such owner"); };

  await assignMenu(app, "theirs");
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));

  expect(await screen.findByText(/no such owner/)).toBeTruthy();
  expect(document.querySelector(`[data-shelf-group="${AGENT.id}"] [data-pad="theirs"]`)).toBeTruthy();
});

it("u3732_home_is_unchanged_by_an_owner_change", async () => {
  const { app } = await mount();

  await assignMenu(app, "theirs");
  fireEvent.click(within(await screen.findByRole("menu")).getByText("Me"));
  await waitFor(() => expect(calls(app, "pad.setOwner")).toHaveLength(1));

  expect(calls(app, "pad.move")).toEqual([]);
});
