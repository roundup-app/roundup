import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { buttonNamed, LIST, selectNamed } from "../models/modelsFixture";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const mountAdd = async () => {
  const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g", model: "m-opus", effort: null })]);
  mounted.app.handlers["models.list"] = () => LIST;
  mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
  mounted.rail.select("g");

  return mounted;
};

const pick = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  fireEvent.change(select);
};

const openMenu = async (name = "a") => {
  const mounted = await mountAdd();
  mounted.app.handlers["agent.setModel"] = () => agent("a", "working", "again");
  fireEvent.contextMenu(rowOf(name), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));

  return mounted;
};

describe("u378 the Model at the add", () => {
  it("u378_the_add_passes_nothing_unless_picked", async () => {
    const mounted = await mountAdd();

    fireEvent.click(await screen.findByLabelText("Add Agent"));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g" }]));

    fireEvent.click(await screen.findByRole("button", { name: "Model…" }));
    fireEvent.click(await screen.findByLabelText("Add Agent"));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(2));
    expect(railCallsTo(mounted.app, "agent.spawn")[1]).toEqual({ cwd: "/p", prompt: null, parent: "g" });
  });

  it("u378_a_picked_pair_goes_in_the_spawn_call", async () => {
    const mounted = await mountAdd();

    fireEvent.click(await screen.findByRole("button", { name: "Model…" }));
    pick(await selectNamed("new agent model"), "m-sonnet");
    pick(await selectNamed("new agent effort"), "e-high");
    fireEvent.click(screen.getByLabelText("Add Agent"));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: "m-sonnet", effort: "e-high" }]));
  });
});

describe("u378 the Model on a row", () => {
  it("u378_apply_is_disabled_until_the_pair_changes", async () => {
    await openMenu();

    const apply = buttonNamed("apply");
    const model = await selectNamed("a model");

    expect(model.value).toBe("m-opus");
    expect(apply.disabled).toBe(true);

    pick(model, "m-sonnet");
    expect(apply.disabled).toBe(false);

    pick(model, "m-opus");
    expect(apply.disabled).toBe(true);
  });

  it("u378_apply_opens_one_confirm_that_names_the_model_and_the_reread", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    const text = document.querySelector(".rail-menu-question")?.textContent ?? "";

    expect(text).toContain("a");
    expect(text).toContain("Sonnet");
    expect(text).toContain("re-reads its conversation");
    expect(text).toContain("more of your usage");
    expect(screen.getAllByRole("button").filter((button) => button.closest(".rail-menu")).map((button) => button.textContent)).toEqual(["change", "cancel"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("cancel"));
    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
  });

  it("u378_change_calls_set_model_once_with_confirmed", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "change" }));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([{ id: "a", model: "m-sonnet", effort: null, confirmed: true }]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u378_cancel_calls_nothing", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.contextMenu(rowOf("a"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));
    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("cancel"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u378_a_failure_shows_the_error_line", async () => {
    const mounted = await openMenu();

    mounted.app.handlers["agent.setModel"] = () => {
      throw new RpcError(-32602, "unknown model m-sonnet");
    };

    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "change" }));

    expect((await screen.findByRole("alert")).textContent).toContain("unknown model m-sonnet");
    expect(mounted.rail.nodes.find((node) => node.id === "a")?.model).toBe("m-opus");
  });

  it("u378_the_row_keeps_its_place_after_a_change", async () => {
    const mounted = await openMenu();
    const order = () => mounted.rail.nodes.map((node) => node.id);
    const before = order();

    mounted.app.handlers["rail.tree"] = () => [workstream("g"), agent("a", "working", "again", { parent: "g", model: "m-sonnet", attempt: "2", status_revision: "2" })];
    pick(await selectNamed("a model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "change" }));

    await waitFor(() => expect(mounted.rail.nodes.find((node) => node.id === "a")?.model).toBe("m-sonnet"));
    expect(order()).toEqual(before);
    expect(rowOf("a").title).toBe("again");
  });

  it("u378_a_workstream_row_offers_model_and_changes_its_door", async () => {
    const mounted = await mountRail([door("g", "working", "busy", { model: "m-opus" })]);
    mounted.app.handlers["models.list"] = () => LIST;
    mounted.app.handlers["agent.setModel"] = () => door("g", "working", "again");
    fireEvent.contextMenu(rowOf("g"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));

    pick(await selectNamed("g model"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    fireEvent.click(screen.getByRole("button", { name: "change" }));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([{ id: "g", model: "m-sonnet", effort: null, confirmed: true }]));
  });
});
