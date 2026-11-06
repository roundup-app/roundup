import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Ask } from "@contracts/ask/Ask";
import type { SendParams } from "@contracts/ask/SendParams";
import type { PlacedPart } from "@contracts/ask/PlacedPart";
import { createFakeApp } from "../testing/fakeApp";
import { door, workstream } from "../testing/nodes";
import { ask, mountAskBar, input, openAsk, press } from "./askFixture";

afterEach(cleanup);

const slow = { timeout: 4000 };

const open = [{ name: "p", path: "/p" }, { name: "other", path: "/other" }];

const setup = async () => {
  const other = createFakeApp();
  other.handlers["rail.tree"] = () => [workstream("w9", { name: "billing" })];
  const sent: SendParams[] = [];
  const reply = (params: SendParams): Ask => ({ id: "o1", text: params.text, at: 1n, parts: [], submission: params.submission ?? "" });
  other.handlers["ask.send"] = (params: SendParams): Ask => sent.push(params) > 0 ? reply(params) : reply(params);
  const shown: [string, string][] = [];

  const routing = { app: { forProject: () => other }, open: () => open, nodes: () => [workstream("w9", { name: "billing" })], show: (path: string, id: string) => void shown.push([path, id]) };
  const mounted = await mountAskBar([], null, [door("lead", "idle", "idle", { name: "lead" })], false, "/p", false, () => true, routing);
  await openAsk();
  const placed: PlacedPart[] = [{ text: "pay invoices", placement: { kind: "routed", workstream: "w9", project: "other" } }];
  const places: string[] = [];
  mounted.app.handlers["ask.place"] = (params: { text: string }) => places.push(params.text) > 0 ? placed : placed;
  mounted.app.handlers["ask.send"] = reply;

  return { ...mounted, places, sent, shown, routing };
};

const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });

const enter = () => press("Enter", {}, input()!);

const chip = () => screen.findByRole("combobox", { name: "Project" }, slow);

/** The Project the chip currently holds: the value of the Select's hidden native field. */
const chosen = () => document.querySelector<HTMLSelectElement>(".ask-chips select")?.value;

describe("u6271b the Project chip", () => {
  it("u6271b_the_chip_reads_the_active_project_until_a_pick_returns", async () => {
    const { places } = await setup();

    await chip();
    expect(chosen()).toBe("p");
    type("pay invoices");
    await chip();
    expect(chosen()).toBe("p");
    expect(places).toEqual([]);

    await waitFor(() => expect(chosen()).toBe("other"), slow);
    expect(places).toEqual(["pay invoices"]);
  });

  it("u6271b_typing_pausing_then_sending_unchanged_text_makes_one_call", async () => {
    const { places, sent } = await setup();

    for (const text of ["p", "pa", "pay", "pay invoices"]) type(text);
    await waitFor(() => expect(places).toEqual(["pay invoices"]), slow);
    enter();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(places).toEqual(["pay invoices"]);
    expect(sent[0]).toMatchObject({ text: "pay invoices", workstream: "w9" });

    type("pay invoices now");
    await waitFor(() => expect(places).toEqual(["pay invoices", "pay invoices now"]), slow);
  });

  it("u6271b_a_chip_pick_sends_with_the_project_fixed", async () => {
    const { app, places, sent } = await setup();

    type("ship it");
    fireEvent.click(await chip());
    const choice = await screen.findByRole("option", { name: "other" });
    fireEvent.pointerDown(choice, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(choice, { pointerType: "mouse", button: 0 });
    fireEvent.click(choice);
    await waitFor(() => expect(chosen()).toBe("other"));
    enter();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: "ship it", project: "other" });
    expect(sent[0]!.parts).toBeUndefined();
    expect(places).toEqual([]);
    expect(app.calls.filter(call => call.method === "ask.send")).toEqual([]);
  });
});

describe("u6271b each part's chip", () => {
  it("u6271b_a_pick_on_one_part_sends_only_that_part_to_the_project", async () => {
    const { app, sent } = await setup();

    const two: PlacedPart[] = [
      { text: "fix login", placement: { kind: "routed", workstream: "w1", project: "p" } },
      { text: "pay invoices", placement: { kind: "routed", workstream: "w9", project: "p" } },
    ];

    app.handlers["ask.place"] = () => two;
    type("fix login. pay invoices");
    fireEvent.click(await screen.findByRole("combobox", { name: "Project for fix login" }, slow));
    const choice = await screen.findByRole("option", { name: "other" });
    fireEvent.pointerDown(choice, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(choice, { pointerType: "mouse", button: 0 });
    fireEvent.click(choice);
    await waitFor(() => expect([...document.querySelectorAll<HTMLSelectElement>(".ask-chips select")].map(select => select.value)).toEqual(["other", "p"]));
    enter();
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.find(request => request.text === "fix login")?.parts).toEqual([{ text: "fix login", placement: { kind: "new", title: "fix login", project: "other" } }]);
    expect(sent.find(request => request.text === "pay invoices")).toMatchObject({ workstream: "w9" });
  });
});

describe("u6271b the chip's list", () => {
  it("u6271b_escape_in_the_open_list_keeps_the_ask_open", async () => {
    await setup();
    type("ship it");
    fireEvent.click(await chip());
    const choice = await screen.findByRole("option", { name: "other" });

    press("Escape", {}, choice);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(() => screen.getByRole("dialog", { name: "Ask" })).not.toThrow();
  });
});

describe("u6271c a sent row names its Project", () => {
  it("u6271c_opening_a_row_of_another_project_selects_it", async () => {
    const part = { text: "pay invoices", placement: { kind: "routed" as const, workstream: "w9", project: "other" }, state: "typed" as const };
    const other = createFakeApp();
    const shown: [string, string][] = [];
    const routing = { app: { forProject: () => other }, open: () => open, nodes: () => [workstream("w9", { name: "billing" })], show: (path: string, id: string) => { shown.push([path, id]); } };
    await mountAskBar([ask("a1", 1, [part])], null, [door("lead", "idle", "idle", { name: "lead" })], false, "/p", false, () => true, routing);
    await openAsk();

    const row = await screen.findByText("other / billing");
    fireEvent.click(row.closest("button")!);
    expect(shown).toEqual([["/other", "w9"]]);
  });
});
