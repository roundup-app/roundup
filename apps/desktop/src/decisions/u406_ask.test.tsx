import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
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
  await waitFor(() => expect(card()).not.toBeNull());

  return mounted;
};

const rows = () => within(card()!).queryAllByRole("option");

const note = () => card()!.querySelector<HTMLInputElement>(".ask-note input")!;

const send = () => within(card()!).getByRole("button", { name: "Send" });

const selected = () => rows().findIndex((row) => row.getAttribute("aria-selected") === "true");

const selectedIs = (at: number) => waitFor(() => expect(selected()).toBe(at));

const press = (target: Element, key: string) => fireEvent.keyDown(target, { key });

const calls = (app: Awaited<ReturnType<typeof open>>["app"]) => rpcCalls(app, "decision.answer");

describe("u406 the Card for ask_user", () => {
  it("u406_title_and_rows", async () => {
    await open();

    const title = card()!.querySelector(".decision-title")!;

    expect(title.textContent).toBe("alpha asks");
    expect(card()!.textContent).not.toContain("ask_user");
    expect(title.className).toContain("ink");
    expect(title.getAttribute("data-tone")).toBe("amber");
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
    fireEvent.submit(note().form!);

    await waitFor(() => expect(calls(app)).toEqual([{ id: "d1", answer: "B · Conversation", note: "ship it", proof: "proof-1" }]));
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
    fireEvent.click(rows()[2]!);

    expect(calls(app)).toHaveLength(1);
    expect(note().readOnly).toBe(true);
    expect(rows().every((row) => row.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(selected()).toBe(0);

    pending.reject(new RpcError(-32000, "the call is gone"));

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


it("u2773a_decisions_restores_exact_work", async () => {
  await open();
  fireEvent.click(rows()[1]!);
  fireEvent.input(note(), { target: { value: "  e\u0301 😀 exact  " } });
  note().setSelectionRange(2, 5, "backward");
  fireEvent.select(note());
  select("beta");
  select("alpha");
  await waitFor(() => expect(note().value).toBe("  e\u0301 😀 exact  "));
  expect(selected()).toBe(1);
  expect([note().selectionStart, note().selectionEnd, note().selectionDirection]).toEqual([2, 5, "backward"]);
  cleanup();
  const reloaded = await open();
  await waitFor(() => expect(note().value).toBe("  e\u0301 😀 exact  "));
  expect(selected()).toBe(1);
  expect(calls(reloaded.app)).toEqual([]);
});
