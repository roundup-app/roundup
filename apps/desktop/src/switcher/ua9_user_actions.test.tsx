import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { ActionRow } from "@contracts/action/ActionRow";
import { RpcError } from "../app/seam";
import { event } from "../testing/nodes";
import { mountToasts } from "../toasts/toastFixture";
import { field, mountSwitcher, openSwitcher, switcherKey as press } from "./switcherFixture";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

const user = (name: string, label: string, over: Partial<ActionRow> = {}): ActionRow => ({ name, label, keys: "", args: [], available: true, source: "user", ...over });

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.switcher [role="option"]')];

const actionValues = (): string[] => options().filter(row => row.dataset.value?.startsWith("action:")).map(row => row.dataset.value!);

const show = async () => {
  openSwitcher();
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

it("ua9_user_actions_follow_the_built_in_actions_and_rank_with_them", async () => {
  let rows = [user("user.deploy", "Deploy site"), user("user.sync", "Sync notes"), user("user.pick", "Pick", { args: [{ key: "t", type: "string", required: true }] })];
  const { app } = await mountSwitcher("ops", undefined, undefined, undefined, { userActions: () => rows });
  await show();
  await waitFor(() => expect(actionValues().slice(-2)).toEqual(["action:user:user.deploy", "action:user:user.sync"]));
  expect(actionValues()).not.toContain("action:user:user.pick");

  fireEvent.input(field()!, { target: { value: "sync" } });
  await waitFor(() => expect(actionValues()[0]).toBe("action:user:user.sync"));

  fireEvent.input(field()!, { target: { value: "" } });
  press("Escape", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  rows = [user("user.other", "Other thing")];
  app.emit(event({ name: "action.userChanged" }));
  await show();
  await waitFor(() => expect(actionValues().slice(-1)).toEqual(["action:user:user.other"]));
  expect(actionValues()).not.toContain("action:user:user.deploy");
});

it("ua10_choosing_a_user_action_runs_it_once_by_name", async () => {
  const { app } = await mountSwitcher("ops", undefined, undefined, undefined, { userActions: () => [user("user.deploy", "Deploy site")] });
  app.handlers["action.run"] = () => ({ status: "done" });
  await show();
  fireEvent.input(field()!, { target: { value: "Deploy site" } });
  await waitFor(() => expect(actionValues()).toContain("action:user:user.deploy"));
  press("Enter", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());
  expect(app.calls.filter(call => call.method === "action.run").map(call => call.params)).toEqual([{ name: "user.deploy", args: [] }]);
});

it("ua11_a_refusal_and_a_problem_each_raise_one_toast", async () => {
  const notified: unknown[] = [];
  const { app } = await mountSwitcher("ops", undefined, undefined, undefined, { userActions: () => [user("user.deploy", "Deploy site")] }, candidate => notified.push(candidate));

  app.handlers["action.run"] = () => { throw new RpcError(-32602, "Deploy denied: no network."); };

  await show();
  fireEvent.input(field()!, { target: { value: "Deploy site" } });
  await waitFor(() => expect(actionValues()).toContain("action:user:user.deploy"));
  press("Enter", {}, field()!);
  await waitFor(() => expect(notified).toHaveLength(1));
  expect(notified[0]).toMatchObject({ name: "Deploy site", line: "Deploy denied: no network." });

  cleanup();
  vi.useFakeTimers();
  const { app: daemon, toasts } = await mountToasts([]);
  daemon.emit(event({ name: "extension.problem", data: { extension: "deploy-kit", cause: "module.js threw" } }));
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersToNextFrame();
  expect(toasts().map(card => card.textContent?.trim())).toEqual(["deploy-kit module.js threw"]);
  vi.useRealTimers();
});

it("ua12_user_actions_move_nothing_built_in", async () => {
  let rows: ActionRow[] = [];
  const { app } = await mountSwitcher("ops", undefined, undefined, undefined, { userActions: () => rows });
  await show();
  const base = options().map(row => row.dataset.value);
  press("Escape", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());

  rows = [user("agent.new", "Imposter"), user("user.deploy", "Deploy site")];
  app.emit(event({ name: "action.userChanged" }));
  await show();
  await waitFor(() => expect(actionValues()).toContain("action:user:user.deploy"));
  expect(actionValues()).not.toContain("action:user:agent.new");
  expect(options().map(row => row.dataset.value).slice(0, base.length)).toEqual(base);

  press("Escape", {}, field()!);
  await waitFor(() => expect(field()).toBeNull());

  app.handlers["action.userList"] = () => { throw new RpcError(-32000, "boom"); };
  app.emit(event({ name: "action.userChanged" }));

  await show();
  expect(options().map(row => row.dataset.value)).toEqual(base);
});
