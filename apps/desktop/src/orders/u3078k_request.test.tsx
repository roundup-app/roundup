import { fireEvent, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp, select } from "../testing/appFixture";
import { screen } from "@solidjs/testing-library";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import type { Reconciliation } from "@contracts/message/Reconciliation";
import { progressSeed } from "../testing/progressSeed";
import { agent, clarifying, door } from "../testing/nodes";

const seedA = progressSeed({ project: "/p", agent: "a" });

const seedB = progressSeed({ project: "/p", agent: "b" });

type Sent = { id: string; request: string; action?: string };

let sent_: Sent[] = [];

const open = async (plans: () => Record<string, Reconciliation>) => {
  const sent: Sent[] = [];

  const mounted = await mountApp((app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", { name: "alpha", order: 0, work: { kind: "work", ask: "Fix login", done: "Login passes", limits: [] } }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: "p" });
    app.handlers["message.progress"] = ({ id }) => id === "b" ? seedB.progress : seedA.progress;
    app.handlers["message.reconcileWork"] = ({ id }) => plans()[id]!;

    app.handlers["message.resumeWork"] = (params) => {
      // SAFETY: the fake Daemon hands the handler the resumeWork params, which carry these fields.
      sent.push(params as Sent);

      throw new RpcError(INTERNAL_CODE + 1, "refused");
    };
  });

  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return { sent, ...mounted };
};

/** SAFETY: reconcileWork calls carry the params of that method. */
const paramOf = (call: { params: unknown }) => (call.params as { id: string }).id;

const retry = async () => {
  const view = within(await screen.findByRole("region", { name: "Progress" }));
  fireEvent.click(await view.findByRole("button", { name: /Resume unfinished work|Try resuming again/ }));
  await waitFor(() => expect(view.getByRole("button", { name: /Resume unfinished work|Try resuming again/ })).toBeTruthy());
};

it("u3078k_a_new_agent_starts_without_the_old_request", async () => {
  const { sent, app } = await open(() => ({ a: seedA.plan, b: seedB.plan }));
  await retry();
  select("beta");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);
  await waitFor(() => expect(app.calls.some((call) => call.method === "message.reconcileWork" && paramOf(call) === "b")).toBe(true));
  await retry();

  expect(sent.map((each) => each.id)).toEqual(["a", "b"]);
  expect(sent[1]!.request).not.toBe(sent[0]!.request);
});

it("u3078k_changed_actions_drop_the_old_request", async () => {
  const changed = { ...seedA.plan, actions: [{ ...seedA.action, id: "action-other" }] };
  // The failure's own re-read already finds the changed actions.
  const { sent } = await open(() => ({ a: sent_.length > 0 ? changed : seedA.plan }));
  sent_ = sent;
  await retry();
  await retry();

  expect(sent[1]!.request).not.toBe(sent[0]!.request);
});

it("u3078k_the_same_actions_keep_their_request", async () => {
  const { sent } = await open(() => ({ a: seedA.plan }));
  await retry();
  await retry();

  expect(sent.length).toBe(2);
  expect(sent[1]!.request).toBe(sent[0]!.request);
});
