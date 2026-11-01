import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp, rpcCalls } from "../testing/appFixture";
import { openProjectPage } from "../testing/menuProbe";

// One owned collection: Project menu → Import Claude Code → fresh candidates.
// Exclusions, refusal recovery and Copy actions are outside it; period and prompt stay native.
const inventory = [{ opening: "Project menu → Import Claude Code", open: () => openProjectPage("import-work") }];

const candidates = ["alpha", "same é 🧭", "same é 🧭", "delta", "終 é 🧭", "hidden", "disabled", "folded"].map((title, at) => ({ source: `source-${at}`, revision: `revision-${at}`, title, cwd: "", last_activity_ms: 1n }));

const row = (at: number) => document.querySelectorAll<HTMLInputElement>(".import-check input")[at]!;

const selected = () => [...document.querySelectorAll<HTMLInputElement>(".import-check input")].flatMap((el, at) => el.checked ? [candidates[at]!.source] : []);

const mount = async (open: () => void) => {
  const result = await mountApp(app => {
    app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [{ source: "excluded", title: "Excluded work", cause: "alreadyImported", reason: "Already imported", last_activity_ms: 1n }] });
    app.handlers["project.importCommit"] = () => ({ outcomes: [] });
  });

  open();
  await screen.findByRole("checkbox", { name: /alpha/ });
  row(5).closest("li")!.hidden = true;
  row(6).disabled = true;
  row(7).closest("li")!.setAttribute("inert", "");
  fireEvent.click(screen.getByRole("button", { name: "1 not importable" }));

  return result;
};

it.each(inventory)("u3787c_each_list_navigates_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  row(1).focus();

  for (const [key, at] of [["Home", 0], ["ArrowUp", 0], ["End", 4], ["ArrowDown", 4], ["ArrowUp", 3], ["ArrowDown", 4], ["a", 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(row(at));
  }

  await waitFor(() => expect(selected()).toEqual(["source-0"]));
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".todo-drawer")).toBeNull();
});

it.each(inventory)("u3787c_each_list_selects_only_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  row(0).focus();
  fireEvent.keyDown(row(0), { key: "End" });
  fireEvent.click(row(1), { shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-1"]));
  fireEvent.click(row(4), { metaKey: true, shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-4"]));
  fireEvent.click(row(1), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-1", "source-4"]));
  fireEvent.click(row(3), { shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-1", "source-2", "source-3"]));
  fireEvent.click(row(2), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-1", "source-3"]));
  fireEvent.click(row(4), { metaKey: true, shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-2", "source-3", "source-4"]));
  fireEvent.keyDown(row(4), { key: "a", metaKey: true });
  await waitFor(() => expect(selected()).toEqual(candidates.slice(0, 5).map(candidate => candidate.source)));
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".todo-drawer")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Import 5" }));
  await waitFor(() => expect(rpcCalls(app, "project.importCommit")).toEqual([{ selections: candidates.slice(0, 5).map(({ source, revision }) => ({ source, revision })) }]));
  expect(rpcCalls(app, "agent.spawn")).toEqual([]);
});

it.each(["Enter", " ", "click"])("u3787c_candidate_activation_toggles_only_its_exact_choice_%s", async activation => {
  const { app } = await mount(inventory[0]!.open);
  row(2).focus();

  if (activation === "click") fireEvent.click(row(2));
  else fireEvent.keyDown(row(2), { key: activation });
  await waitFor(() => expect(selected()).toEqual(["source-2"]));
  expect(rpcCalls(app, "project.importCommit")).toEqual([]);
  expect(rpcCalls(app, "agent.spawn")).toEqual([]);
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(rpcCalls(app, "project.importCommit")).toEqual([{ selections: [{ source: "source-2", revision: "revision-2" }] }]));
});

it("u3787c_import_modifiers_retain_choices_across_the_actual_page_lifetime", async () => {
  const { app } = await mount(inventory[0]!.open);
  fireEvent.click(row(2), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["source-2"]));
  fireEvent.click(within(screen.getByRole("region", { name: "Import Claude Code" })).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(document.querySelector(".import-check")).toBeNull());
  inventory[0]!.open();
  await screen.findByRole("checkbox", { name: /alpha/ });
  await waitFor(() => expect(selected()).toEqual(["source-2"]));
  expect(rpcCalls(app, "project.importCommit")).toEqual([]);
  expect(rpcCalls(app, "agent.spawn")).toEqual([]);
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(rpcCalls(app, "project.importCommit")).toEqual([{ selections: [{ source: "source-2", revision: "revision-2" }] }]));
});
