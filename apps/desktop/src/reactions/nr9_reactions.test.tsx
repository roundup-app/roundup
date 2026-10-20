import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Reaction } from "@contracts/reaction/Reaction";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { mountAskBar } from "../ask/askFixture";
import { copy } from "../copy";

afterEach(cleanup);

const saved = (patch: Partial<Reaction> = {}): Reaction => ({
  project: "p", id: "r1", name: "Ship it", actor: { kind: "user", id: "u", parent: null }, home: null, target: "a",
  instruction: "go", condition: { kind: "agents", ids: ["a"], any: false }, max_firings: 1, remaining: 1, rearm: false,
  expires_at: "2026-10-21T09:00:00Z", created_at: "2026-10-20T09:00:00Z", state: "active",
  observation: { health: "observing", cursor: null, gap: null, recovery: null, evidence: null }, firings: [], ...patch,
});

const mount = async (list: () => Reaction[]) => {
  const mounted = await mountAskBar([], null, [agent("a", "idle", "ready")]);

  mounted.app.handlers["reaction.list"] = list;
  window.dispatchEvent(new Event("focus"));

  return mounted;
};

it("nr9_create_inspect_stop_run_and_focus", async () => {
  let current = saved();
  const { app } = await mount(() => [current]);
  const row = await screen.findByRole("button", { name: /Ship it/ });

  row.focus();
  fireEvent.click(row);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(within(detail).getByText("go")).toBeTruthy();
  expect(app.calls.map((call) => call.method)).not.toContain("reaction.run");
  app.handlers["reaction.stop"] = () => (current = saved({ state: "stopped" }));
  app.handlers["reaction.run"] = () => current;
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionRun }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "reaction.run")).toHaveLength(1));
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", true));
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionBack }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ship it/ })));
});

it("nr9_failed_creation_preserves_original_draft", async () => {
  const { app, connected } = await mount(() => []);
  await screen.findByText(copy.reactionsEmpty);

  const destination = { surface: "reactions", object: "create", recipient: null };

  const value = {
    operation: "op-1", name: "Mine", target: "a", instruction: "exact\n words ", kind: "pr-checks", ids: [], any: false,
    repository: "o/r", number: "7", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z",
    maxFirings: "1", rearm: false,
  };

  connected.drafts.edit(destination, value, null, "ordinary");
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let refuse = true;

  app.handlers["reaction.create"] = () => {
    if (refuse) throw new RpcError(-32000, "no room");

    return saved();
  };

  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));

  const save = await screen.findByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await screen.findByText(copy.reactionNotCreated("no room"));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "exact\n words ");
  refuse = false;
  fireEvent.click(screen.getByRole("button", { name: copy.reactionSave }));
  await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  const sent = app.calls.filter((call) => call.method === "reaction.create").map((call) => call.params);

  expect(sent).toMatchObject([{ operation: "op-1", instruction: "exact\n words " }, { operation: "op-1", instruction: "exact\n words " }]);
  expect(connected.drafts.list().filter((draft) => draft.destination.surface === "reactions")).toEqual([]);
});

it("nr9_overlapping_names_keep_the_selected_identity_through_creation", async () => {
  const { app, connected } = await mountAskBar([], null, [
    agent("a", "idle", "ready", { name: "Builder" }),
    agent("b", "idle", "ready", { name: "Builder" }),
  ]);

  app.handlers["reaction.list"] = () => [];
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  app.handlers["reaction.create"] = () => saved({ target: "b", condition: { kind: "agents", ids: ["a"], any: false } });
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "op-overlap", name: "Ship it", target: "", instruction: "go", kind: "agents", ids: [], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z",
    maxFirings: "1", rearm: false,
  }, null, "ordinary");
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "Builder (b)" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });

  await within(preview).findByText("Builder (b)");
  fireEvent.click(screen.getByRole("checkbox", { name: "Builder (a)" }));
  await within(preview).findByText(/Builder \(a\)/);
  const save = screen.getByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(app.calls.find((call) => call.method === "reaction.create")?.params).toMatchObject({ target: "b", condition: { ids: ["a"] } });
  expect(within(detail).getByText("Builder (b)")).toBeTruthy();
  expect(within(detail).getByText(/Builder \(a\)/)).toBeTruthy();
});

it("nr9_firing_opens_only_its_recorded_message_and_returns_focus", async () => {
  const { app } = await mount(() => [saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "held" }] })]);
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "exact accepted instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver removed", passedFrom: null, at: 0 });
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const link = await screen.findByRole("button", { name: /Message #42/ });
  fireEvent.click(link);
  await screen.findByText("exact accepted instruction");
  expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
  expect(screen.getByText("receiver removed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
  await waitFor(() => expect(document.activeElement).toBe(link));
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
});

it("nr9_acknowledged_older_submit_preserves_newer_revision_and_navigation", async () => {
  const { app, connected } = await mount(() => []);
  const destination = { surface: "reactions", object: "create", recipient: null };
  connected.drafts.edit(destination, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  app.handlers["reaction.create"] = () => new Promise(resolve => { acknowledge = resolve; });
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "old exact words");
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " newer\n exact 🧭 " } });
  acknowledge(saved());
  await waitFor(() => expect(connected.drafts.list()).toHaveLength(1));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
  expect(connected.drafts.list()[0]?.value.operation).not.toBe("original");
  fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
});
