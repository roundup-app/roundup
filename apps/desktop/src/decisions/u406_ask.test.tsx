import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { RpcError } from "../app/seam";
import { askingWith, card, gate, mountApp, rpcCalls, select } from "./decisionsFixture";
import type { Asked } from "./decisionsFixture";

const three: Asked[] = [
  { label: "A · Brief (recommended)", description: "what waits on you leads", preview: "A's preview:\nline two" },
  { label: "B · Conversation", description: "your talk stays in order", preview: "B's preview" },
  { label: "C · Ledger", description: "results show at a glance" },
];

const question = "Which Workstream view do you build?\nAll three show one state at a time.";

const open = async (answers: Asked[] = three, prepare: Parameters<typeof mountApp>[1] = () => {}) => {
  const mounted = await mountApp([askingWith("d1", "a", question, answers)], prepare);

  select("alpha");
  await waitFor(() => expect(card()?.querySelector("textarea")).toBeTruthy());

  return mounted;
};

const rows = () => within(card()!).queryAllByRole("option");

const note = () => card()!.querySelector<HTMLTextAreaElement>(".ask-note textarea")!;

const send = () => within(card()!).getByRole("button", { name: "Send" });

const selected = () => rows().findIndex((row) => row.getAttribute("aria-selected") === "true");

const selectedIs = (at: number) => waitFor(() => expect(selected()).toBe(at));

const press = (target: Element, key: string) => fireEvent.keyDown(target, { key });

const calls = (app: Awaited<ReturnType<typeof open>>["app"]) => rpcCalls(app, "decision.answer");

describe("u406 the Card for ask_user", () => {
  it("u2773a_decisions_restores_exact_work", async () => {
    await open();
    const exact = "  first é\nsecond 👩🏽‍💻  ";
    fireEvent.click(rows()[1]!);
    await selectedIs(1);
    fireEvent.input(note(), { target: { value: exact } });
    note().focus();
    note().setSelectionRange(2, 7, "backward");
    fireEvent.select(note());
    select("beta");
    select("alpha");
    await waitFor(() => expect(note().value).toBe(exact));
    await selectedIs(1);
    expect([note().selectionStart, note().selectionEnd, note().selectionDirection]).toEqual([2, 7, "backward"]);
    cleanup();
    const { app } = await open();
    await waitFor(() => expect(note().value).toBe(exact));
    await selectedIs(1);
    expect(calls(app)).toEqual([]);
  });

  it("u2773a_decisions_native_selection_survives_pointer_navigation", async () => {
    const lane = await openLane(1512, "light", "u2773-decisions", true);

    try {
      const origin = await lane.evaluate<string>("location.origin");
      await lane.browser("open", `${origin}/harness.html?seed=decisions`);
      await lane.until("!!document.querySelector('.rail-row[data-id=\"agent-2\"]')");
      await lane.browser("click", '.rail-row[data-id="agent-2"]');
      await lane.until("!!document.querySelector('textarea.app-listbox-note')");
      await lane.browser("fill", "textarea.app-listbox-note", "  first é");
      await lane.browser("press", "Shift+Enter");
      await lane.browser("keyboard", "inserttext", "second 👩🏽‍💻  ");
      await lane.evaluate("(() => { const field=document.querySelector('textarea.app-listbox-note'); field.setSelectionRange(2,7,'backward'); field.dispatchEvent(new Event('select',{bubbles:true})); return true; })()");
      await lane.browser("click", '.rail-row[data-id="agent-3"]');
      await lane.until("!!document.querySelector('.rail-row[data-id=\"agent-3\"][aria-selected=true]')");
      await lane.browser("click", '.rail-row[data-id="agent-2"]');
      await lane.until("!!document.querySelector('textarea.app-listbox-note')");
      expect(await lane.evaluate("(() => {const field=document.querySelector('textarea.app-listbox-note');return [field.value,field.selectionStart,field.selectionEnd,field.selectionDirection]})()")).toEqual(["  first é\nsecond 👩🏽‍💻  ", 2, 7, "backward"]);
      expect(await lane.calls("decision.answer")).toEqual([]);
    } finally { await lane.close(); }
  }, 60_000);

  it.each(["failed", "unknown", "acknowledged"] as const)("u2773b_decisions_settlement_preserves_other_revisions_%s", async outcome => {
    const pending = gate<null>();
    const { app, drafts } = await open(three, app => { app.handlers["decision.answer"] = () => pending.promise; });
    fireEvent.input(note(), { target: { value: "  revision A\n" } });
    fireEvent.click(send());
    await waitFor(() => expect(calls(app)).toHaveLength(1));
    fireEvent.click(send());
    fireEvent.submit(note().form!);
    fireEvent.click(rows()[1]!);
    await selectedIs(1);
    fireEvent.input(note(), { target: { value: "  revision B é\n👩🏽‍💻  " } });
    const before = drafts("/p").list();
    expect(before.map(draft => [draft.status, draft.value.note])).toEqual([["pending", "  revision A\n"], ["draft", "  revision B é\n👩🏽‍💻  "]]);
    expect(calls(app)).toHaveLength(1);
    app.chooser.path = "/q";
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "q" });

    if (outcome === "acknowledged") pending.resolve(null);
    else pending.reject(new RpcError(outcome === "failed" ? -32602 : -32004, "answer result"));
    await waitFor(() => expect(drafts("/p").list().some(draft => draft.status === "pending")).toBe(false));
    expect(drafts("/p").list()).toEqual(outcome === "acknowledged" ? [before[1]] : [{ ...before[0], status: outcome }, before[1]]);
    expect(drafts("/q").list()).toEqual([]);
    cleanup();
    const restored = await open();
    expect(restored.drafts("/p").list()).toEqual(outcome === "acknowledged" ? [before[1]] : [{ ...before[0], status: outcome }, before[1]]);
    expect(note().value).toBe("  revision B é\n👩🏽‍💻  ");
    await selectedIs(1);
    expect(calls(restored.app)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByRole("region", { name: "Unfinished work" });

    if (outcome !== "acknowledged") {
      fireEvent.click(within(recovery).getByRole("button", { name: new RegExp(before[0]!.revision) }));
      fireEvent.click(within(recovery).getByRole("button", { name: "Discard this revision" }));
    }

    expect(restored.drafts("/p").list()).toEqual([before[1]]);
    expect(calls(restored.app)).toEqual([]);
    expect(calls(app)).toHaveLength(1);
    cleanup();
    const fresh = await open();
    await waitFor(() => expect(note().value).toBe("  revision B é\n👩🏽‍💻  "));
    expect(calls(fresh.app)).toEqual([]);
  });

  it("u2773d_original_prompt_refuses_replacement_reused_form", async () => {
    const original = await open();
    fireEvent.input(note(), { target: { value: "  retired é\n👩🏽‍💻  " } });
    const saved = original.drafts("/p").list()[0]!;
    cleanup();

    const replacement = await open(three, app => {
      app.handlers["decision.capture"] = ({ id }) => ({ daemon: "new-daemon", agent: "a", attempt: "new-attempt", decision: id });
    });

    expect(note().value).toBe("");
    fireEvent.input(note(), { target: { value: "replacement draft" } });
    expect(replacement.drafts("/p").list()).toEqual([saved, expect.objectContaining({ value: { daemon: "new-daemon", agent: "a", attempt: "new-attempt", decision: "d1", choice: three[0]!.label, note: "replacement draft" } })]);
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByRole("region", { name: "Unfinished work" });
    fireEvent.click(within(recovery).getByRole("button", { name: new RegExp(saved.revision) }));
    await within(recovery).findByText("Original object unavailable");
    expect(within(recovery).queryByRole("button", { name: "Send" })).toBeNull();
    expect(calls(replacement.app)).toEqual([]);
  });

  it("u2773e_recovery_actions_keep_surface_draft", async () => {
    const { app, drafts } = await open();
    const key = "roundup:drafts:/p";
    fireEvent.input(note(), { target: { value: "stored" } });
    const bytes = localStorage.getItem(key);
    const write = Storage.prototype.setItem;

    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("roundup:drafts:")) throw new Error("disk full");
      write.call(this, key, value);
    });

    const exact = "  newer é\n👩🏽‍💻  ";
    fireEvent.input(note(), { target: { value: exact } });
    select("beta");
    select("alpha");
    await waitFor(() => expect(note().value).toBe(exact));
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByRole("region", { name: "Unfinished work" });
    expect(within(recovery).getByRole("alert").textContent).toContain("/p");
    expect(localStorage.getItem(key)).toBe(bytes);
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fireEvent.click(within(recovery).getByRole("button", { name: "Copy note" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    writes.mockRestore();
    fireEvent.click(within(recovery).getByRole("button", { name: "Retry storage only" }));
    expect(drafts("/p").problem()).toBeNull();
    expect(calls(app)).toEqual([]);
    cleanup();
    const fresh = await open();
    expect(note().value).toBe(exact);
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard this revision" }));
    expect(fresh.drafts("/p").list()).toEqual([]);
    expect(calls(fresh.app)).toEqual([]);
  });

  it("u2773e_incomplete_decision_restore_keeps_new_memory_and_stored_bytes", async () => {
    await open();
    fireEvent.input(note(), { target: { value: "stored note" } });
    const key = "roundup:drafts:/p";
    const saved = JSON.parse(localStorage.getItem(key)!);
    delete saved.drafts[0].value.note;
    const invalid = JSON.stringify(saved);
    cleanup();
    localStorage.setItem(key, invalid);
    const fresh = await open();
    expect(fresh.drafts("/p").problem()?.operation).toBe("restore");
    fireEvent.input(note(), { target: { value: "  recoverable é\n👩🏽‍💻  " } });
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const recovery = await screen.findByRole("region", { name: "Unfinished work" });
    expect(within(recovery).getByRole("alert").textContent).toContain("Decision");
    fireEvent.click(within(recovery).getByRole("button", { name: "Retry storage only" }));
    expect(localStorage.getItem(key)).toBe(invalid);
    expect(fresh.drafts("/p").list().at(-1)?.value.note).toBe("  recoverable é\n👩🏽‍💻  ");
    expect(calls(fresh.app)).toEqual([]);
  });

  it("u406_title_and_rows", async () => {
    await open();

    const title = card()!.querySelector(".decision-title")!;

    expect(title.textContent).toBe("alpha asks");
    expect(card()!.textContent).not.toContain("ask_user");
    expect(within(card()!).getByRole("listbox")).not.toBeNull();
    expect(rows()).toHaveLength(3);
    expect(within(card()!).getByRole("option", { name: "A · Brief" })).toBe(rows()[0]);
    expect(rows()[0]!.querySelector(".ask-recommended")!.textContent).toBe("Recommended");
    expect(rows()[1]!.querySelector(".ask-recommended")).toBeNull();
    expect(rows()[0]!.getAttribute("aria-describedby")).not.toBeNull();
    expect(rows()[0]!.querySelector(`[id="${rows()[0]!.getAttribute("aria-describedby")}"]`)!.textContent).toBe("what waits on you leads");
    expect(selected()).toBe(0);
  });

  it("u406_arrows_move_focus_and_swap_the_preview", async () => {
    await open();

    const list = within(card()!).getByRole("listbox", { name: "Answers" });
    const preview = () => card()!.querySelector(".ask-preview")?.textContent ?? null;

    expect(preview()).toContain("A's preview");
    press(list, "ArrowDown");
    await selectedIs(1);
    expect(preview()).toContain("B's preview");
    press(list, "ArrowDown");
    await selectedIs(2);
    expect(preview()).toBeNull();
    press(list, "ArrowDown");
    await selectedIs(-1);
    expect(note().placeholder).toBe("Your own answer");
    press(note(), "ArrowDown");
    await selectedIs(0);
    press(note(), "ArrowUp");
    await selectedIs(-1);
    press(note(), "ArrowUp");
    await selectedIs(2);
    fireEvent.click(rows()[1]!);
    await selectedIs(1);
  });

  it("q2_decision_preview", async () => {
    await open([{ label: "A", description: "d", preview: "```text\nsketch\n```\nline one\nline two" }]);

    const preview = card()!.querySelector(".decision-preview")!;

    expect(preview.querySelector("pre")!.textContent).toContain("sketch");
  });

  it("u406_enter_sends_the_focused_label_and_the_note", async () => {
    const { app } = await open();

    app.proof.value = "proof-1";
    fireEvent.click(rows()[1]!);
    expect(calls(app)).toEqual([]);
    await waitFor(() => expect(note().placeholder).toBe("Note for B · Conversation, or your own answer"));
    fireEvent.input(note(), { target: { value: "ship it" } });
    fireEvent.keyDown(note(), { key: "Enter", shiftKey: true });
    expect(calls(app)).toEqual([]);
    fireEvent.input(note(), { target: { value: "ship it\nnext line" } });
    press(note(), "Enter");

    await waitFor(() => expect(calls(app)).toEqual([{ id: "d1", answer: "B · Conversation", note: "ship it\nnext line", proof: "proof-1", identity: { daemon: "daemon", agent: "a", attempt: "attempt-a", decision: "d1" } }]));
  });

  it("u406_an_own_answer_needs_a_note", async () => {
    const { app } = await open();
    const list = within(card()!).getByRole("listbox");

    press(list, "ArrowUp");
    await waitFor(() => expect(note().placeholder).toBe("Your own answer"));
    expect(send().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(send());
    fireEvent.submit(note().form!);
    expect(calls(app)).toEqual([]);

    fireEvent.input(note(), { target: { value: "neither" } });
    expect(send().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(send());

    await waitFor(() => expect(calls(app)).toHaveLength(1));
    expect(calls(app)[0]).toMatchObject({ answer: null, note: "neither" });
  });

  it("u406_pending_failure_and_retry_keep_the_note", async () => {
    const { app } = await open();
    const pending = gate<null>();
    let attempts = 0;

    app.handlers["decision.answer"] = () => {
      attempts += 1;

      if (attempts === 1) return pending.promise;

      return null;
    };

    fireEvent.input(note(), { target: { value: "keep me" } });
    fireEvent.click(send());
    await waitFor(() => expect(calls(app)).toHaveLength(1));
    fireEvent.click(send());
    fireEvent.submit(note().form!);

    expect(calls(app)).toHaveLength(1);
    expect(note().readOnly).toBe(false);
    expect(rows().every((row) => row.getAttribute("aria-disabled") !== "true")).toBe(true);
    await selectedIs(0);

    pending.reject(new RpcError(-32602, "the call is gone"));

    await waitFor(() => expect(within(card()!).getByRole("alert").textContent).toContain("the call is gone"));
    expect(note().value).toBe("keep me");
    expect(note().readOnly).toBe(false);

    fireEvent.click(send());

    await waitFor(() => expect(card()).toBeNull());
    expect(calls(app)).toHaveLength(2);
  });

  it("u406_no_answers_shows_the_field_only", async () => {
    const { app } = await open([]);

    expect(rows()).toEqual([]);
    expect(card()!.querySelector(".ask-preview")).toBeNull();
    expect(card()!.textContent).toContain("Which Workstream view do you build?");
    expect(note().placeholder).toBe("Your own answer");
    expect(send().getAttribute("aria-disabled")).toBe("true");

    fireEvent.input(note(), { target: { value: "docs" } });
    fireEvent.click(send());

    await waitFor(() => expect(calls(app)[0]).toMatchObject({ answer: null, note: "docs" }));
  });
});
