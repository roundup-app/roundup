import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp, openWorkProgress } from "../testing/appFixture";
import { progressSeed } from "../testing/progressSeed";
import { RpcError } from "./seam";

it("u3791b_rendered_failure_keeps_explicit_recovery", async () => {
  const seed = progressSeed({ project: "/p", agent: "a" });

  const { app } = await mountApp(app => {
    const tree = app.handlers["rail.tree"]!;
    app.handlers["rail.tree"] = async args => (await tree(args)).map(node => node.id === "a"
      ? { ...node, work: { kind: "work", ask: "Finish the repair", limits: [] } } : node);
    app.handlers["message.progress"] = () => seed.progress;
    app.handlers["message.reconcileWork"] = () => seed.plan;
    app.handlers["message.resumeWork"] = () => { throw new RpcError(-32002, "diagnostic remains exactly as supplied"); };
  });

  await openWorkProgress(app);
  const progress = within(await screen.findByRole("region", { name: "Progress" }));
  fireEvent.click(await progress.findByRole("button", { name: "Resume unfinished work" }));
  await progress.findByRole("alert", { name: /diagnostic remains exactly as supplied/ });
  expect(app.calls.filter(call => call.method === "message.resumeWork")).toHaveLength(1);
  app.handlers["message.resumeWork"] = () => { throw new RpcError(-32006, "refused; choose again"); };

  const retry = progress.getByRole("button", { name: /resuming/i });
  await waitFor(() => expect(retry.getAttribute("aria-disabled")).toBeNull());
  fireEvent.click(retry);
  await progress.findByRole("alert", { name: /choose again/ });
  expect(app.calls.filter(call => call.method === "message.resumeWork")).toHaveLength(2);
});
