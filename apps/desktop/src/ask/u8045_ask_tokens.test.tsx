import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { door, workstream } from "../testing/nodes";
import { mountAskBar, input, openAsk, press } from "./askFixture";

afterEach(cleanup);

const open = [{ name: "p", path: "/p" }, { name: "Education", path: "/education" }];

const setup = async () => {
  const other = createFakeApp();
  const routing = { app: { forProject: () => other }, open: () => open, nodes: (path: string) => path === "/education" ? [workstream("w9", { name: "meta-harness" })] : [], show: () => undefined };
  const mounted = await mountAskBar([], null, [door("lead", "idle", "idle", { name: "lead" })], false, "/p", false, () => true, routing);
  await openAsk();

  return mounted;
};

const field = () => {
  const found = input();

  if (!found) throw new Error("the Ask input is not mounted");

  return found;
};

const type = (text: string) => fireEvent.input(field(), { target: { value: text } });

const options = async () => within(await screen.findByRole("listbox")).getAllByRole("option").map(item => item.textContent);

describe("u8045a a typed # or @ opens its list anywhere", () => {
  it("u8045a_hash_after_a_space_mid_text_opens_the_project_list", async () => {
    await setup();
    type("fix the login bug in #ed");
    expect(await options()).toEqual(["Education"]);
  });

  it("u8045a_at_mid_text_opens_the_workstream_list", async () => {
    await setup();
    type("tell @meta");
    expect(await options()).toEqual(["meta-harness"]);
  });

  it("u8045a_the_hash_list_holds_only_open_projects", async () => {
    await setup();
    type("in #");
    expect(await options()).toEqual(["p", "Education"]);
  });

  it("u8045a_a_hash_inside_a_word_opens_nothing", async () => {
    await setup();
    type("a#b");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("u8045a_picking_a_project_writes_the_token_and_a_space", async () => {
    await setup();
    field().focus();
    type("fix #ed");
    await options();
    press("Enter", {}, field());
    await waitFor(() => expect(field().value).toBe("fix #Education "));
  });

  it("u8045a_escape_closes_only_the_hash_list", async () => {
    await setup();
    field().focus();
    type("fix #ed");
    await options();
    press("Escape", {}, field());
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(field().value).toBe("fix #ed");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("u8045b a set token shows tinted in the text", () => {
  it("u8045b_a_set_token_is_marked_and_an_unknown_one_is_not", async () => {
    await setup();
    type("fix #Education and #nowhere with @meta-harness");
    const names = screen.getAllByRole("mark").map(mark => mark.getAttribute("aria-label"));

    expect(names).toEqual(["Project Education", "Workstream meta-harness"]);
  });
});

describe("u8045c #Project fixes the Project of the Ask", () => {
  it("u8045c_the_bar_has_no_project_chip", async () => {
    await setup();
    type("pay invoices");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
