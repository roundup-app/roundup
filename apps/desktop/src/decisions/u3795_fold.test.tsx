import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { card, cleared, decision, gate, mountApp, opened, rpcCalls, select } from "./decisionsFixture";

const scoped = () => decision("d1", "a", { scopes: ["once", "session", "project"] });

const line = () => document.querySelector<HTMLElement>(".decision-fold");

const answer = async (scope: "Once" | "This session" | "This Project" | "Deny", reduced = false) => {
  const mounted = await mountApp([scoped()], () => {}, () => 0, reduced);

  mounted.app.proof.value = "proof-1";
  select("alpha");
  await waitFor(() => expect(card()).not.toBeNull());

  if (scope === "Deny") fireEvent.click(within(card()!).getByRole("button", { name: "Deny" }));
  else {
    for (let step = 0; step < ["Once", "This session", "This Project"].indexOf(scope); step += 1) fireEvent.keyDown(card()!, { key: "ArrowRight" });

    fireEvent.click(within(card()!).getByRole("button", { name: "Allow" }));
  }

  await waitFor(() => expect(line()).not.toBeNull());

  return mounted;
};

describe("u3795 an answered permission folds to one line", () => {
  it("u3795_an_answer_folds_to_its_line", async () => {
    for (const [pick, words] of [["Once", "Allowed once"], ["This session", "Allowed for this session"], ["This Project", "Allowed for this Project"], ["Deny", "Denied"]] as const) {
      const { container } = await answer(pick);

      expect(card()).toBeNull();
      expect(line()!.textContent).toContain(words);
      expect(line()!.textContent).toContain("rm -rf build");
      expect(line()!.getAttribute("role")).toBe("status");
      expect(within(line()!).queryByRole("button", { name: "Revoke" }) !== null).toBe(pick === "This Project");
      container.remove();
      document.body.replaceChildren();
    }
  });

  it("u3795_a_terminal_answer_leaves_no_line", async () => {
    const { app } = await mountApp([scoped()]);

    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    app.emit(cleared("d1", "terminal"));

    await waitFor(() => expect(card()).toBeNull());
    expect(line()).toBeNull();
  });

  it("u3795_revoke_calls_once_and_removes_the_line", async () => {
    const { app } = await answer("This Project");
    const pending = gate<null>();

    app.handlers["decision.revoke"] = () => pending.promise;
    fireEvent.click(within(line()!).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(line()!).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(rpcCalls(app, "decision.revoke")).toHaveLength(1));

    expect(rpcCalls(app, "decision.revoke")).toEqual([{ id: "d1", proof: "proof-1" }]);
    expect(within(line()!).getByRole("button", { name: "Revoke" }).matches('[aria-disabled="true"]')).toBe(true);

    pending.resolve(null);

    await waitFor(() => expect(line()).toBeNull());
  });

  it("u3795_revoke_not_found_and_failure", async () => {
    const { app } = await answer("This Project");

    app.handlers["decision.revoke"] = () => {
      throw new RpcError(-32000, "disk full");
    };

    fireEvent.click(within(line()!).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk full"));
    expect(within(line()!).getByRole("button", { name: "Revoke" })).not.toBeNull();

    app.handlers["decision.revoke"] = () => {
      throw new RpcError(-32001, "not found");
    };

    fireEvent.click(within(line()!).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(line()!.textContent).toContain("Allowed for this Project (already removed)"));
    expect(within(line()!).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("u3795_the_line_stays_until_next_decision_esc_or_agent_gone", async () => {
    const { app } = await answer("Once");

    expect(line()).not.toBeNull();
    select("beta");
    select("alpha");
    await waitFor(() => expect(line()).not.toBeNull());

    fireEvent.keyDown(line()!, { key: "Escape" });

    await waitFor(() => expect(line()).toBeNull());

    await Promise.resolve();
    app.emit(opened(scoped()));
    await waitFor(() => expect(card()).not.toBeNull());
    fireEvent.click(within(card()!).getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(line()).not.toBeNull());
    app.emit(opened(decision("d2", "a", { opened_at: 5 })));

    await waitFor(() => expect(line()).toBeNull());
  });
});
