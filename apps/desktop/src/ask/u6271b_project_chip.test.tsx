import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
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

describe("u6271b one call per pause", () => {
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
});

describe("u6271c a sent row names its Project", () => {
  it("u6271c_opening_a_row_of_another_project_selects_it", async () => {
    const part = { text: "pay invoices", placement: { kind: "routed" as const, workstream: "w9", project: "other" }, state: "typed" as const };
    const other = createFakeApp();
    const shown: [string, string][] = [];
    const routing = { app: { forProject: () => other }, open: () => open, nodes: () => [workstream("w9", { name: "billing" })], show: (path: string, id: string) => { shown.push([path, id]); } };
    await mountAskBar([ask("a1", 1, [part])], null, [door("lead", "idle", "idle", { name: "lead" })], false, "/p", false, () => true, routing);
    await openAsk();

    const row = await screen.findByText("other / billing", { selector: ".ask-name" });
    fireEvent.click(row.closest("button")!);
    flush();
    expect(shown).toEqual([["/other", "w9"]]);
  });
});
