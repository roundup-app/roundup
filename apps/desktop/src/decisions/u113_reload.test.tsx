import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { AnsweredDecision } from "@contracts/decision/AnsweredDecision";
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

  it("u113_reopen_answers_with_the_new_connections_proof_and_the_proof_never_shows", async () => {
    const { app } = await mountApp([decision("d1", "a")]);

    app.proof.value = "proof-old-7f3a";
    app.exitDaemon({ code: 1 });
    app.proof.value = "proof-new-9c1d";
    fireEvent.click(within(screen.getByRole("region", { name: "Rail" })).getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Rail" }).textContent).not.toContain("Daemon exited"));
    await screen.findAllByRole("treeitem");
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    fireEvent.click(within(card()!).getByRole("button", { name: "Allow" }));

    await waitFor(() => expect(rpcCalls(app, "decision.answer")).toHaveLength(1));
    expect(rpcCalls(app, "decision.answer")).toEqual([{ id: "d1", answer: "allow", proof: "proof-new-9c1d" }]);

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
        expect(current instanceof HTMLInputElement && current.value).toBe("keep compatibility");
      }

      fireEvent.click(within(card()!).getByRole("button", { name: kind === "permission" ? "Allow" : "Send" }));

      await waitFor(() => expect(card()).toBeNull());
      expect(rpcCalls(app, "decision.answer")).toEqual([kind === "permission"
        ? { id: "d1", answer: "allow", proof: app.proof.value }
        : { id: "d1", answer: "keep", note: "keep compatibility", proof: app.proof.value }]);
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

    const note = within(card()!).getByRole("textbox", { name: "Note" });
    expect(note instanceof HTMLInputElement && note.value).toBe("");
  });

});


describe("u468 retained answers", () => {
  it.each(["permission", "question"])("u468_a_door_answer_remains_visible_with_its_identity (%s)", async (kind) => {
    const original = kind === "permission" ? decision("d1", "a") : asking("d1", "a", "keep v1 routes?", ["keep", "drop"]);
    const record: AnsweredDecision = {
      decision: original, kind: kind === "permission" ? "permission" : "question",
      prompt: original.args, attempt: "attempt-a", answer: kind === "permission" ? "allow" : "keep",
      note: "preserve compatibility", answered_by: { kind: "agent", id: "r", parent: null }, answered_at: 2,
    };
    const prepare = (app: Parameters<Parameters<typeof mountApp>[1]>[0]) => {
      app.handlers["decision.answers"] = ({ agent }) => agent === "a" ? [record] : [];
    };
    await mountApp([], prepare);
    select("alpha");
    const answers = await screen.findByRole("region", { name: "Answered requests for alpha" });
    expect(answers.textContent).toContain(kind === "permission" ? "rm -rf build" : "keep v1 routes?");
    expect(answers.textContent).toContain(kind === "permission" ? "allow" : "keep");
    expect(answers.textContent).toContain("preserve compatibility");
    expect(answers.textContent).toContain("harbor");
    expect(within(answers).queryByRole("button", { name: "Allow" })).toBeNull();

    cleanup();
    await mountApp([], prepare);
    select("alpha");
    const reopened = await screen.findByRole("region", { name: "Answered requests for alpha" });
    expect(reopened.textContent).toContain(kind === "permission" ? "rm -rf build" : "keep v1 routes?");
    expect(reopened.textContent).toContain("harbor");
  });
});
