import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { asking, card, decision, mountApp, select } from "../decisions/decisionsFixture";
import { runChecks } from "../testing/checks";
import { agent, door, USER } from "../testing/nodes";
import { openPad, openShelf, padOf, AGENT } from "../pads/padsFixture";
import { message, mountThread } from "../thread/threadFixture";

const long = "Change no file in the repo ".repeat(12).trim();

const work = { kind: "work" as const, ask: "Give a tour", limits: [long] };

const laidOut = (element: Element | null) => {
  expect(element).not.toBeNull();
  const style = getComputedStyle(element!);
  expect(style.textAlign).toBe("left");
  expect(style.fontFamily).toBe("var(--font-ui)");
};

const meetsD2D5 = () => {
  // the test container is outside the app's stylesheet and holds no text of its own
  document.body.firstElementChild!.setAttribute("style", "font-size: var(--text-body)");
  const checks = runChecks();
  expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
  expect(checks.D5.status, JSON.stringify(checks.D5.value)).toBe("pass");
};

describe("Q2, Q3: generated text is laid out as hold:Plain asks", () => {
  it("q2_order_line", async () => {
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() =>
      expect(document.querySelector(".order-line")).not.toBeNull(),
    );
    // jsdom's own `button { text-align: center }` beats the author rule, so the alignment is read from the rule itself.
    const rule = readFileSync(resolve(process.cwd(), "src/orders/styles.css"), "utf8").match(/\.order-line \{[^}]*\}/)![0];
    expect(rule).toMatch(/text-align:\s*left/);
    expect(
      getComputedStyle(document.querySelector(".order-line")!).fontFamily,
    ).toBe("var(--font-ui)");
  });

  it("q2_order_drawer", async () => {
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() =>
      expect(document.querySelector(".order-line")).not.toBeNull(),
    );
    fireEvent.click(document.querySelector(".order-line")!);
    const drawer = await screen.findByLabelText("full order of alpha");
    laidOut(drawer);
    expect(drawer.textContent).toContain(long);
  });

  it("q2_decision_card", async () => {
    await mountApp([
      asking("d1", "a", "Which folder should I use?", ["src", "docs"]),
    ]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    laidOut(card()!.querySelector(".decision-question"));
  });

  it("q2_decision_args_keep_code_font", async () => {
    await mountApp([decision("d2", "a")]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    const args = card()!.querySelector(".decision-args");
    expect(args).not.toBeNull();
    expect(getComputedStyle(args!).fontFamily).not.toBe("var(--font-ui)");
  });

  it("q2_thread_message", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "lead" })], {
      messages: [
        message(1, {
          from: { kind: "agent", id: "r1", parent: null },
          to: "you",
          body: "Done.",
        }),
      ],
    });
    await waitFor(() =>
      expect(document.querySelector("[data-message-body]")).not.toBeNull(),
    );
    laidOut(document.querySelector("[data-message-body]"));
  });

  const toYou = (body: string) =>
    mountThread([door("r1", "idle", "idle", { name: "lead" })], {
      messages: [message(1, { from: { kind: "agent", id: "r1", parent: null }, to: "you", body })],
    });

  it("q3_a_status_reply_of_rows_is_a_table", async () => {
    await toYou("Status\n| Agent | State |\n| --- | --- |\n| alpha | editing |\n| beta | idle |\n| gamma | done |\nNext: wait.");
    await waitFor(() => expect(document.querySelector("[data-message-body] table")).not.toBeNull());
    const body = document.querySelector("[data-message-body]");
    laidOut(body);
    expect(body!.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(body!.querySelectorAll("th")).toHaveLength(2);
    expect(body!.textContent).not.toContain("| ---");
    expect(getComputedStyle(body!.querySelector("table")!).fontFamily).toBe("var(--font-ui)");
  });

  it("q2_pad_reply", async () => {
    const scribe = { kind: "agent" as const, id: "scribe-1", parent: null };
    const reply = message(2, { from: scribe, to: "you", body: long });
    const { app, connected } = await openShelf([padOf("notes", AGENT, "x")]);
    app.handlers["rail.tree"] = () => [agent("scribe-1", "working", "editing", { name: "scribe", order: 0 })];
    await connected.rail.refresh();
    app.handlers["pad.ask"] = ({ text }) => ({ agent: scribe.id, message: message(1, { from: USER, to: scribe.id, body: text }) });
    app.handlers["message.list"] = () => [reply];
    await openPad("notes");
    const field = await screen.findByLabelText<HTMLInputElement>("Ask or edit this pad");
    fireEvent.input(field, { target: { value: "shorten" } });
    fireEvent.keyDown(field, { key: "Enter" });
    app.emit({ actor: scribe, name: "message.sent", data: reply });
    await waitFor(() => expect(document.querySelectorAll(".pad-exchange li")).toHaveLength(2));
    const row = document.querySelectorAll(".pad-exchange li")[1]!;
    // the rows inherit the list's layout
    laidOut(row.parentElement);
    expect(row.textContent).toContain(long);
  });

  it("q3_a_code_fence_and_inline_code_stay_mono", async () => {
    await toYou("Run `just check` first.\n```\ncargo test\n```\nThen wait.");
    await waitFor(() => expect(document.querySelector("[data-message-body] pre")).not.toBeNull());
    const body = document.querySelector("[data-message-body]")!;
    laidOut(body);
    expect(getComputedStyle(body.querySelector("p code")!).fontFamily).toBe("var(--font-mono)");
    expect(body.querySelector("p code")!.textContent).toBe("just check");
    expect(getComputedStyle(body.querySelector("pre")!).fontFamily).toBe("var(--font-mono)");
    expect(body.querySelector("pre")!.textContent).toBe("cargo test");
    expect(body.textContent).not.toContain("`");
  });

  it("q3_thread_text_meets_d2_d5", async () => {
    await toYou("Run `just check` first.\n```\ncargo test\n```\n| Agent | State |\n| --- | --- |\n| alpha | editing |\n| beta | idle |\nNext: wait.");
    await waitFor(() => expect(document.querySelector("[data-message-body] table")).not.toBeNull());
    expect(document.querySelector("[data-message-body] pre")).not.toBeNull();
    meetsD2D5();
  });

  it("q3_decision_card_meets_d2_d5", async () => {
    await mountApp([asking("d1", "a", "Which folder should I use?", ["src", "docs"])]);
    select("alpha");
    await waitFor(() => expect(card()).not.toBeNull());
    meetsD2D5();
  });

  it("q3_digest_card_meets_d2_d5", async () => {
    const entry = { name: "alpha", kind: "idle", last: long, todos: 3, pads: ["notes", "plan"] };
    await mountThread([door("r1", "idle", "idle", { name: "lead" })], {
      messages: [message(1, { from: { kind: "ext", id: "rupd", parent: null }, to: "r1", body: `[digest] ${JSON.stringify(entry)}` })],
    });
    await waitFor(() => expect(document.querySelector(".digest-card")).not.toBeNull());
    meetsD2D5();
  });

  it.each([700, 1280])("q3_pad_reply_wraps_and_meets_d2_d5 at %i", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));
    const path = `/home/user/${"deeply-nested-directory/".repeat(12)}file.txt`;
    const scribe = { kind: "agent" as const, id: "scribe-1", parent: null };
    const reply = message(2, { from: scribe, to: "you", body: path });
    const { app, connected } = await openShelf([padOf("notes", AGENT, "x")]);
    app.handlers["rail.tree"] = () => [agent("scribe-1", "working", "editing", { name: "scribe", order: 0 })];
    await connected.rail.refresh();
    app.handlers["pad.ask"] = ({ text }) => ({ agent: scribe.id, message: message(1, { from: USER, to: scribe.id, body: text }) });
    app.handlers["message.list"] = () => [reply];
    await openPad("notes");
    const field = await screen.findByLabelText<HTMLInputElement>("Ask or edit this pad");
    fireEvent.input(field, { target: { value: "where" } });
    fireEvent.keyDown(field, { key: "Enter" });
    app.emit({ actor: scribe, name: "message.sent", data: reply });
    await waitFor(() => expect(document.querySelectorAll(".pad-exchange li")).toHaveLength(2));
    const list = document.querySelector(".pad-exchange")!;
    expect(document.querySelectorAll(".pad-exchange li")[1]!.textContent).toContain(path);
    // an unbroken path wraps: the list neither scrolls sideways nor holds a line that cannot break
    expect(getComputedStyle(list).overflowX).toBe("hidden");
    expect(getComputedStyle(list).overflowWrap).toBe("anywhere");
    meetsD2D5();
  });

  it.each([700, 1280])("q3_the_surfaces_wrap_and_meet_d2_d5 at %i", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    window.dispatchEvent(new Event("resize"));
    await mountApp([], (app) => {
      app.handlers["rail.tree"] = () => [
        agent("a", "working", "editing", { name: "alpha", order: 0, work }),
        agent("b", "working", "editing", { name: "beta", order: 1 }),
        door("r", "working", "editing", { name: "harbor", order: 2 }),
      ];
    });
    select("alpha");
    await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
    fireEvent.click(document.querySelector(".order-line")!);
    const drawer = await screen.findByLabelText("full order of alpha");
    // the long limit wraps: the Drawer neither scrolls sideways nor holds a line that cannot break
    expect(getComputedStyle(drawer).overflowX).not.toBe("scroll");

    for (const part of drawer.querySelectorAll(".order-ask, .order-limits")) {
      expect(getComputedStyle(part).overflowWrap).toBe("anywhere");
      expect(getComputedStyle(part).whiteSpace).not.toBe("nowrap");
    }

    // the test container is outside the app's stylesheet and holds no text of its own
    document.body.firstElementChild!.setAttribute("style", "font-size: var(--text-body)");

    const checks = runChecks();
    expect(checks.D2.status, JSON.stringify(checks.D2)).toBe("pass");
    expect(checks.D5.status, JSON.stringify(checks.D5.value)).toBe("pass");
  });
});
