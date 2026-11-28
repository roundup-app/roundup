import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { PlacedPart } from "@contracts/ask/PlacedPart";
import { createFakeApp } from "../testing/fakeApp";
import { door, workstream } from "../testing/nodes";
import { mountAskBar, input, openAsk } from "./askFixture";

afterEach(cleanup);

const slow = { timeout: 4000 };

const [active, other, third] = [{ name: "p", path: "/p" }, { name: "other", path: "/other" }, { name: "third", path: "/third" }];

const open = [active, other, third];

const setup = async (placed: PlacedPart[]) => {
  const app = createFakeApp();
  const routing = { app: { forProject: () => app }, open: () => open, nodes: () => [workstream("w9", { name: "billing" })], show: () => undefined };

  const mounted = await mountAskBar([], null, [door("lead", "idle", "idle", { name: "lead" })], false, "/p", false, () => true, routing);
  await openAsk();
  mounted.app.handlers["ask.place"] = () => placed;

  return mounted;
};

const field = () => {
  const found = input();

  if (!found) throw new Error("the Ask input is not mounted");

  return found;
};


const type = (text: string) => fireEvent.input(field(), { target: { value: text } });

const pick = () => document.querySelector(".ask-pick");

const routed = (text: string, project: string): PlacedPart => ({ text, placement: { kind: "routed", workstream: "w9", project } });

describe("u8046a the bar is one surface", () => {
  it("u8046a_the_bar_holds_no_select_and_no_send_control", async () => {
    await setup([]);
    const bar = screen.getByRole("dialog");

    expect(bar.querySelector("[data-slot=select], .app-select-trigger, button")).toBeNull();
  });
});

describe("u8046b the Project pick is text at the line's right end", () => {
  it("u8046b_the_pick_reads_the_active_project_until_a_pick_returns", async () => {
    await setup([routed("pay invoices", "other")]);
    type("pay invoices");
    await waitFor(() => expect(pick()?.textContent).toBe(active.name));
    await waitFor(() => expect(pick()?.textContent).toBe(other.name), slow);
  });

  it("u8046b_the_pick_is_absent_with_a_hash_project_token", async () => {
    await setup([]);
    type("pay invoices");
    await waitFor(() => expect(pick()).not.toBeNull());
    type("pay invoices #other ");
    await waitFor(() => expect(pick()).toBeNull());
  });

  it("u8046b_the_pick_is_absent_with_an_at_workstream_token", async () => {
    await setup([]);
    type("pay invoices");
    await waitFor(() => expect(pick()).not.toBeNull());
    type("@billing pay invoices");
    await waitFor(() => expect(pick()).toBeNull());
  });

  it("u8046b_the_pick_is_not_a_control", async () => {
    await setup([]);
    type("pay invoices");
    await waitFor(() => expect(pick()).not.toBeNull());
    const found = pick();

    if (!found) throw new Error("no pick");


    expect(found.getAttribute("role")).toBeNull();
    expect(found.matches("button, a, input, [tabindex]")).toBe(false);
    expect(found.querySelector("button, a, input, [tabindex]")).toBeNull();
  });

  it("u8046b_parts_in_two_projects_list_each_once", async () => {
    await setup([routed("pay", "other"), routed("file", "third"), routed("mail", "other")]);
    type("pay then file then mail");
    await waitFor(() => expect(pick()?.textContent).toBe(`${other.name}, ${third.name}`), slow);
  });
});
