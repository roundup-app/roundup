import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { NOW_TICK_MS } from "../state/clock";
import { asking, card, cleared, decision, opened, mountApp, rpcCalls, select } from "./decisionsFixture";

describe("u113 a reload and a Reopen", () => {
  it("u113_a_webview_reload_restores_the_live_decisions", async () => {
    const live = [decision("d1", "a")];
    const first = await mountApp(live);

    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    cleanup();
    expect(card()).toBeNull();

    await mountApp(live);
    select("alpha");

    await waitFor(() => expect(card()?.textContent).toContain("rm -rf build"));
    expect(rpcCalls(first.app, "decision.list").length).toBeGreaterThan(0);
  });

  it.each(["permission", "question"])("u2773e_credentials_keep_existing_policy_%s", async kind => {
    const live = kind === "permission" ? decision("d1", "a") : asking("d1", "a", "keep?", ["keep", "drop"]);
    const { app } = await mountApp([live]);

    app.proof.value = "proof-old-7f3a";
    app.exitDaemon({ code: 1 });
    app.proof.value = "proof-new-9c1d";
    fireEvent.click(within(screen.getByRole("region", { name: "Rail" })).getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Rail" }).textContent).not.toContain("Daemon exited"));
    await screen.findAllByRole("treeitem");
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());

    if (kind === "question") {
      const field = await within(card()!).findByRole("textbox", { name: "Note" });
      fireEvent.input(field, { target: { value: "recover this answer" } });
      app.handlers["decision.answer"] = () => { throw new RpcError(-32002, "refused"); };
    }

    fireEvent.click(within(card()!).getByRole("button", { name: kind === "permission" ? "Allow" : "Send" }));

    await waitFor(() => expect(rpcCalls(app, "decision.answer")).toHaveLength(1));

    if (kind === "question") await within(card()!).findByRole("alert");
    expect(rpcCalls(app, "decision.answer")).toEqual([kind === "permission"
      ? { id: "d1", answer: "allow", proof: "proof-new-9c1d" }
      : { id: "d1", answer: "keep", note: "recover this answer", proof: "proof-new-9c1d", identity: { daemon: "daemon", agent: "a", attempt: "attempt-a", decision: "d1" } }]);

    const seen = [document.documentElement.outerHTML, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];

    for (const text of seen) {
      expect(text).not.toContain("proof-new-9c1d");
      expect(text).not.toContain("proof-old-7f3a");
    }

    expect(rpcCalls(app, "terminal.write")).toEqual([]);
  });
});

describe("u468 refused Door answers", () => {
  it.each(["permission", "question"])("u468_a_failed_door_answer_keeps_the_request_actionable (%s)", async (kind) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });

    try {
      const original = kind === "permission" ? decision("d1", "a") : asking("d1", "a", "keep v1 routes?", ["keep", "drop"]);
      let live = [original];
      const { app } = await mountApp([], (app) => { app.handlers["decision.list"] = () => live; }, Date.now);
      select("alpha");
      await waitFor(() => expect(card()?.textContent).toContain(kind === "permission" ? "rm -rf build" : "keep v1 routes?"));
      const note = kind === "question" ? within(card()!).getByRole("textbox", { name: "Note" }) : null;

      if (note) {
        note.focus();
        fireEvent.input(note, { target: { value: "keep compatibility" } });
      }

      live = [{ ...original,
        failure: {
          attempt: "attempt-a", answered_by: { kind: "agent", id: "r", parent: null },
          failed_at: 2, error_code: -32602, message: "answer is allow or deny, with no note",
        },
      }];
      // The shared App clock refreshes live requests; no event reports a refused answer.
      await vi.advanceTimersByTimeAsync(NOW_TICK_MS);

      await waitFor(() => expect(card()?.textContent).toContain("harbor"));
      expect(within(card()!).getByRole("alert").textContent).toContain("answer is allow or deny, with no note");
      expect(card()?.textContent).toContain(kind === "permission" ? "rm -rf build" : "keep v1 routes?");

      if (note) {
        const current = within(card()!).getByRole("textbox", { name: "Note" });
        expect(document.activeElement).toBe(current);
        expect(current instanceof HTMLTextAreaElement && current.value).toBe("keep compatibility");
      }

      fireEvent.click(within(card()!).getByRole("button", { name: kind === "permission" ? "Allow" : "Send" }));

      await waitFor(() => expect(card()).toBeNull());
      expect(rpcCalls(app, "decision.answer")).toEqual([kind === "permission"
        ? { id: "d1", answer: "allow", proof: app.proof.value }
        : { id: "d1", answer: "keep", note: "keep compatibility", proof: app.proof.value, identity: { daemon: "daemon", agent: "a", attempt: "attempt-a", decision: "d1" } }]);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("u468_a_replacement_does_not_inherit_the_previous_requests_answer", async () => {
    const first = asking("d1", "a", "keep v1 routes?", ["keep", "drop"]);
    const { app } = await mountApp([first]);
    select("alpha");
    await waitFor(() => expect(card()?.textContent).toContain("keep v1 routes?"));
    fireEvent.input(within(card()!).getByRole("textbox", { name: "Note" }), { target: { value: "only for the first request" } });

    app.emit(opened({ ...first, id: "d2", opened_at: 2 }));
    app.emit(cleared("d1", "replaced"));

    const note = await within(card()!).findByRole("textbox", { name: "Note" });
    expect(note instanceof HTMLTextAreaElement && note.value).toBe("");
  });

});
