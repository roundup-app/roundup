import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { OwnedChanges } from "@contracts/agent/OwnedChanges";
import { agent } from "../testing/nodes";
import { mountRail, rowOf } from "../rail/railFixture";

afterEach(cleanup);

const OWNED: OwnedChanges = { groups: [{ repo: "/p", branch: "own/x", base: "main", files: [{ path: "a.ts", status: "modified", line: 3 }] }] };

const REFS = { refs: [
  { kind: "worktree" as const, path: "/p", branch: "own/x", label: "p (own/x)" },
  { kind: "worktree" as const, path: "/q", branch: "dev", label: "q (dev)" },
  { kind: "head" as const, branch: "main", label: "main" },
  { kind: "head" as const, branch: "own/x", label: "own/x" },
] };

const open = async () => {
  const mounted = await mountRail([agent("a", "idle", "ready")], [], () => null, () => false, { pane: true }, [], { name: "p", path: "/p" }, app => {
    app.handlers["agent.ownedChanges"] = () => OWNED;
    app.handlers["project.compareRefs"] = () => REFS;
    app.handlers["agent.changedFiles"] = () => ({ files: [{ path: "z.rs", status: "added", line: 1 }] });
  });

  fireEvent.click(await within(rowOf("a")).findByRole("button", { name: "1 changed file" }));
  await screen.findByRole("heading", { name: "Changes: a vs main" });

  return mounted;
};

const choose = async (picker: "From" | "To", option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: picker }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
};

it("u7186d_the_pickers_list_the_endpoints_and_reload_on_choice", async () => {
  const { app } = await open();

  fireEvent.click(screen.getByRole("combobox", { name: "To" }));
  expect((await screen.findAllByRole("option")).map(option => option.textContent)).toEqual(["p (own/x)", "q (dev)", "main", "own/x"]);
  fireEvent.click(screen.getByRole("option", { name: "q (dev)" }));
  await screen.findByRole("button", { name: /z\.rs/ });
  expect(app.calls.find(call => call.method === "agent.changedFiles")?.params).toEqual({ id: "a", from: { kind: "head", branch: "main" }, to: { kind: "worktree", path: "/q", branch: "dev" } });
  expect(screen.queryByRole("button", { name: /a\.ts/ })).toBeNull();
});

it("u7186d_any_two_endpoints_can_be_compared", async () => {
  const { app } = await open();

  await choose("From", "own/x");
  await choose("To", "main");
  await screen.findByRole("heading", { name: "Changes: own/x vs main" });
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.changedFiles").pop()?.params).toEqual({ id: "a", from: { kind: "head", branch: "own/x" }, to: { kind: "head", branch: "main" } }));
});

it("u7186d_the_agent_preset_stays_until_the_user_chooses", async () => {
  await open();
  await within(screen.getByRole("combobox", { name: "From" })).findByText("main");
  await within(screen.getByRole("combobox", { name: "To" })).findByText("p (own/x)");
  await choose("To", "q (dev)");
  await within(screen.getByRole("combobox", { name: "To" })).findByText("q (dev)");
  await within(screen.getByRole("combobox", { name: "From" })).findByText("main");
});

it("u7186d_the_pickers_are_reachable_by_keyboard", async () => {
  await open();

  for (const name of ["From", "To"]) {
    const picker = screen.getByRole("combobox", { name });

    picker.focus();
    expect(document.activeElement).toBe(picker);
    expect(picker.tabIndex).toBeGreaterThanOrEqual(0);
  }
});
