import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { buttonNamed, LIST, settings, selectNamed } from "../models/modelsFixture";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const mountAdd = async () => {
  const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g", model: "m-opus", effort: null })]);
  mounted.app.handlers["models.list"] = () => LIST;
  mounted.app.handlers["project.get"] = () => settings(["subagent"]);
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
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
  });

  it("u378_a_picked_pair_goes_in_the_spawn_call", async () => {
    const mounted = await mountAdd();

    fireEvent.click(await screen.findByLabelText("Choose Model and Effort"));
    pick(await selectNamed("Model"), "m-sonnet");
    pick(await selectNamed("Effort"), "e-high");
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: "m-sonnet", effort: "e-high" }]));
  });
  it("u378_the_workstream_row_has_one_split_add", async () => {
    await mountAdd();
    const row = rowOf("g");
    expect(row.querySelector(".rail-split-add")?.textContent).toBe("Agent");
    expect(row.querySelector(".rail-split-add svg.lucide-plus")).toBeTruthy();
    expect(row.querySelector(".rail-split-add svg.lucide-chevron-down")).toBeTruthy();
    expect(row.querySelectorAll("[aria-label='Add Agent']")).toHaveLength(1);
    expect(document.querySelector(".rail-adds")).toBeNull();
  });

  it("u378_a_failed_project_defaults_read_can_be_retried", async () => {
    const mounted = await mountAdd();

    mounted.app.handlers["project.get"] = () => { throw new RpcError(-32603, "Project defaults unavailable"); };

    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    await screen.findByText("Project defaults unavailable");
    expect(screen.getByRole("button", { name: "Add agent" }).getAttribute("aria-disabled")).toBe("true");
    mounted.app.handlers["project.get"] = () => settings(["subagent"]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add agent" }).hasAttribute("aria-disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Add agent" }));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
  });

  it("u378_the_picker_opens_on_labelled_project_defaults", async () => {
    const mounted = await mountAdd();
    mounted.app.handlers["project.get"] = () => ({ ...settings(["subagent"]), models: { roles: [{role: "subagent", model: "m-sonnet", effort: "e-high"}], allowed: [] } });
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    await waitFor(() => expect(screen.getByText("Default (Sonnet)")).toBeTruthy());
    expect(screen.getByText("Default (High)")).toBeTruthy();
    expect((await selectNamed("Model")).value).toBe("");
    expect((await selectNamed("Effort")).value).toBe("");
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u378_unset_project_defaults_name_claude_code", async () => {
    await mountAdd();
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    await selectNamed("Model");
    expect(screen.getAllByText("Default (Claude Code)")).toHaveLength(2);
  });

  it("u378_the_picker_defaults_spawn_nulls", async () => {
    const mounted = await mountAdd();
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    await waitFor(() => expect(screen.getByRole("button", {name: "Add agent"}).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("button", {name: "Add agent"}));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{cwd: "/p", prompt: null, parent: "g", model: null, effort: null}]));
    expect(screen.queryByLabelText("Model")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Choose Model and Effort"));
  });

  it("u378_one_picked_field_leaves_the_other_null", async () => {
    const mounted = await mountAdd();
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    pick(await selectNamed("Model"), "m-sonnet");
    await waitFor(() => expect(screen.getByRole("button", {name: "Add agent"}).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("button", {name: "Add agent"}));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")[0]).toMatchObject({model: "m-sonnet", effort: null}));
  });

  it("u378_the_immediate_add_ignores_a_previous_pick", async () => {
    const mounted = await mountAdd();
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    pick(await selectNamed("Model"), "m-sonnet");
    fireEvent.click(screen.getByLabelText("Add Agent"));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")[0]).toMatchObject({model: null, effort: null}));
  });

  it("u378_escape_discards_the_pair_and_returns_focus", async () => {
    const mounted = await mountAdd();
    const trigger = screen.getByLabelText("Choose Model and Effort");
    fireEvent.click(trigger);
    pick(await selectNamed("Model"), "m-sonnet");
    fireEvent.keyDown(await selectNamed("Model"), {key: "Escape"});
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
    fireEvent.click(trigger);
    expect((await selectNamed("Model")).value).toBe("");
  });

  it("u378_a_failed_picker_add_keeps_the_pair_and_shows_the_error", async () => {
    const mounted = await mountAdd();
    mounted.app.handlers["agent.spawn"] = () => { throw new RpcError(-32602, "cannot start agent"); };

    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    pick(await selectNamed("Model"), "m-sonnet");
    await waitFor(() => expect(screen.getByRole("button", {name: "Add agent"}).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("button", {name: "Add agent"}));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot start agent");
    expect((await selectNamed("Model")).value).toBe("m-sonnet");
    expect(screen.getByLabelText("Choose Model and Effort").getAttribute("aria-expanded")).toBe("true");
  });

  it("u378_the_split_add_is_keyboard_complete", async () => {
    await mountAdd();

    for (const name of ["Add Agent", "Choose Model and Effort"]) {
      const button = screen.getByRole("button", {name});
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
    }

    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    await selectNamed("Model");
    expect(screen.getByLabelText("Choose Model and Effort").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", {name: "Add agent"}).tabIndex).toBe(0);
  });

  it("u378_both_add_paths_honour_can_spawn", async () => {
    const [exit, setExit] = createSignal<{code: number} | null>(null);
    const mounted = await mountRail([workstream("g")], [], exit);
    setExit({code: 1});

    for (const name of ["Add Agent", "Choose Model and Effort"]) {
      const button = screen.getByLabelText(name);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(button);
    }

    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
    expect(screen.queryByLabelText("Model")).toBeNull();
  });

  it("u378_both_add_paths_focus_an_open_composing_field", async () => {
    const mounted = await mountAdd();
    fireEvent.keyDown(document, {key: "n", metaKey: true, shiftKey: true});
    const field = await screen.findByLabelText("Prompt");

    for (const name of ["Add Agent", "Choose Model and Effort"]) {
      fireEvent.click(screen.getByLabelText(name));
      expect(document.activeElement).toBe(field);
    }

    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u378_command_n_keeps_composing_and_default_add_behaviour", async () => {
    const mounted = await mountAdd();
    fireEvent.click(screen.getByLabelText("Choose Model and Effort"));
    pick(await selectNamed("Model"), "m-sonnet");
    fireEvent.keyDown(document, {key: "n", metaKey: true});
    await waitFor(() => expect(screen.queryByLabelText("Model")).toBeNull());
    expect(railCallsTo(mounted.app, "agent.spawn")[0]).toMatchObject({model: null, effort: null});
    await waitFor(() => expect(screen.getByLabelText("Add Agent").getAttribute("aria-disabled")).toBeNull());
    fireEvent.keyDown(document, {key: "n", metaKey: true, shiftKey: true});
    const field = await screen.findByLabelText("Prompt");
    fireEvent.keyDown(document, {key: "n", metaKey: true});
    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);
  });

});

describe("u378 the Model on a row", () => {
  it("u378_apply_is_disabled_until_the_pair_changes", async () => {
    await openMenu();

    const apply = buttonNamed("Apply");
    const model = await selectNamed("Model for a");

    expect(model.value).toBe("m-opus");
    expect(apply.disabled).toBe(true);

    pick(model, "m-sonnet");
    expect(apply.disabled).toBe(false);

    pick(model, "m-opus");
    expect(apply.disabled).toBe(true);
  });

  it("u378_apply_opens_one_confirm_that_names_the_model_and_the_reread", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const text = document.querySelector(".rail-menu-question")?.textContent ?? "";

    expect(text).toContain("a");
    expect(text).toContain("Sonnet");
    expect(text).toContain("re-reads its conversation");
    expect(text).toContain("more of your Usage");
    expect(screen.getAllByRole("button").filter((button) => button.closest(".rail-menu")).map((button) => button.textContent)).toEqual(["Change", "Cancel"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
  });

  it("u378_change_calls_set_model_once_with_confirmed", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([{ id: "a", model: "m-sonnet", effort: null, confirmed: true }]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u378_cancel_calls_nothing", async () => {
    const mounted = await openMenu();

    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.contextMenu(rowOf("a"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));
    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("u378_a_failure_shows_the_error_line", async () => {
    const mounted = await openMenu();

    mounted.app.handlers["agent.setModel"] = () => {
      throw new RpcError(-32602, "unknown model m-sonnet");
    };

    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect((await screen.findByRole("alert")).textContent).toContain("unknown model m-sonnet");
    expect(mounted.rail.nodes.find((node) => node.id === "a")?.model).toBe("m-opus");
  });

  it("u378_the_row_keeps_its_place_after_a_change", async () => {
    const mounted = await openMenu();
    const order = () => mounted.rail.nodes.map((node) => node.id);
    const before = order();

    mounted.app.handlers["rail.tree"] = () => [workstream("g"), agent("a", "working", "again", { parent: "g", model: "m-sonnet", attempt: "2", status_revision: "2" })];
    pick(await selectNamed("Model for a"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => expect(mounted.rail.nodes.find((node) => node.id === "a")?.model).toBe("m-sonnet"));
    expect(order()).toEqual(before);
    expect(rowOf("a").title).toBe("again");
  });

  it("u378_a_workstream_row_offers_model_and_changes_its_door", async () => {
    const mounted = await mountRail([door("g", "working", "busy", { model: "m-opus" })]);
    mounted.app.handlers["models.list"] = () => LIST;
    mounted.app.handlers["project.get"] = () => settings(["subagent"]);
    mounted.app.handlers["agent.setModel"] = () => door("g", "working", "again");
    fireEvent.contextMenu(rowOf("g"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));

    pick(await selectNamed("Model for g"), "m-sonnet");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() => expect(railCallsTo(mounted.app, "agent.setModel")).toEqual([{ id: "g", model: "m-sonnet", effort: null, confirmed: true }]));
  });
});
