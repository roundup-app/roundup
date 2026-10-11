import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChecks } from "../testing/checks";
import { door } from "../testing/nodes";
import { mountThread, reportFixture, threadInput } from "./threadFixture";

const WIDTHS = [700, 1280];

const at = (width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
};

const mountReport = async (width: number) => {
  at(width);

  const { tree, messages } = reportFixture();
  const mounted = await mountThread(tree, { messages });

  await vi.waitFor(() => expect(document.querySelectorAll("[data-message-body]").length).toBeGreaterThan(0));

  return mounted;
};

const sends = (app: { calls: { method: string }[] }) => app.calls.filter((call) => call.method === "message.send");

afterEach(() => {
  cleanup();
  at(1024);
});

describe("u197 the Thread is one page in one column", () => {
  // The one-x and 80-character clauses need layout: `src/testing/u197_column.test.ts` asserts them in a headless browser.
  it.each(WIDTHS)("u197_every_row_sits_in_the_column_with_no_inset_of_its_own at %i", async (width) => {
    await mountReport(width);

    for (const row of document.querySelectorAll(".thread-ask, .thread-limits, .thread-sender, .thread-body, .thread-card-body, .thread-composer textarea")) {
      expect(row.closest(".thread-column"), row.className).not.toBeNull();
    }

    for (const row of document.querySelectorAll(".thread-sender, .thread-body, .thread-card-body, .thread-ask")) {
      const style = getComputedStyle(row);

      expect(style.marginLeft || "0").toMatch(/^(0|0px)$/);
      expect(style.paddingLeft || "0").toMatch(/^(0|0px)$/);
    }

    expect(getComputedStyle(document.querySelector(".thread-column")!).maxWidth).toBe("var(--measure)");
  });

  it.each(WIDTHS)("u197_the_order_is_the_header_and_take_over_is_in_it at %i", async (width) => {
    const { connected } = await mountReport(width);

    const header = document.querySelector<HTMLElement>("[data-thread-header]")!;
    const order = screen.getByRole("button", { name: "order of workstream-1" });

    expect(header.parentElement?.firstElementChild).toBe(header);
    expect(order.closest("[data-thread-header]")).toBe(header);
    expect(readFileSync(resolve(process.cwd(), "src/thread/styles.css"), "utf8")).toMatch(/\.thread-ask\s*{[^}]*-webkit-line-clamp:\s*2/);
    expect(header.querySelector(".thread-ask")!.textContent).toContain("Give a short tour");
    expect(header.querySelector(".thread-limits")!.textContent).toBe("3 limits");
    expect(header.textContent).not.toContain("must not");
    expect(header.contains(screen.getByRole("button", { name: "take over" }))).toBe(true);
    expect(document.querySelectorAll(".thread-take-over")).toHaveLength(0);

    fireEvent.click(order);
    expect(connected.drawer.content()).not.toBeNull();
  });

  it("u197_the_header_counts_limits_in_q5s_words_and_reads_a_clarification", async () => {
    const counts: [string[], string][] = [[[], "no limits"], [["a"], "1 limit"], [["a", "b"], "2 limits"]];

    for (const [limits, text] of counts) {
      await mountThread([door("r1", "working", "working", { name: "w", work: { kind: "work", ask: "x", limits } })]);
      expect(document.querySelector(".thread-limits")!.textContent).toBe(text);
      cleanup();
    }

    await mountThread([door("r1", "working", "working", { name: "w", work: { kind: "clarification", question: "what for?" } })]);
    expect(screen.getByRole("button", { name: "order of w" }).textContent).toBe("clarifying: what for?");
  });

  it("u197_during_a_takeover_the_header_holds_the_one_end_takeover", async () => {
    await mountReport(1280);
    fireEvent.click(screen.getByRole("button", { name: "take over" }));

    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "end takeover" })).toHaveLength(1));

    const header = document.querySelector("[data-thread-header]")!;

    expect(header.contains(screen.getByRole("button", { name: "end takeover" }))).toBe(true);
    expect(screen.queryByRole("button", { name: "take over" })).toBeNull();
    expect(document.querySelectorAll("[aria-label='order of workstream-1']")).toHaveLength(1);
  });

  it.each(WIDTHS)("u197_every_gap_is_a_space_token_and_runs_are_space_4_apart at %i", async (width) => {
    await mountReport(width);

    const feed = document.querySelector<HTMLElement>(".thread-feed")!;

    expect(getComputedStyle(feed).gap).toBe("var(--space-4)");
    expect(getComputedStyle(document.querySelector(".thread-run")!).gap).toBe("var(--space-1)");
    expect(getComputedStyle(document.querySelector(".thread-card")!).gap).toBe("var(--space-1)");

    const sheet = [...document.styleSheets].flatMap((each) => [...each.cssRules]).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && /\.thread/.test(rule.selectorText));
    const spaced = /^(0|0px|auto|var\(--space-[1-6]\)|var\(--measure\))$/;

    for (const rule of sheet) {
      for (const property of ["margin", "padding", "gap", "row-gap", "column-gap"]) {
        const value = rule.style.getPropertyValue(property);

        for (const part of value.split(/\s+/).filter(Boolean)) expect(part, `${rule.selectorText} ${property}`).toMatch(spaced);
      }
    }
  });

  it("u197_the_users_messages_differ_by_tone_only", async () => {
    await mountReport(1280);

    const runs = [...document.querySelectorAll<HTMLElement>(".thread-run")];
    const mine = runs.find((run) => run.hasAttribute("data-user"))!;
    const door = runs.find((run) => !run.hasAttribute("data-user"))!;

    expect(mine.querySelector("[data-message-sender]")!.textContent).toMatch(/^you /);
    expect(getComputedStyle(mine.querySelector(".thread-body")!).color).toBe("var(--grey)");
    expect(getComputedStyle(door.querySelector(".thread-body")!).color).not.toBe("var(--grey)");

    for (const property of ["textAlign", "fontFamily", "fontSize", "fontWeight"] as const) {
      expect(getComputedStyle(mine.querySelector(".thread-body")!)[property]).toBe(getComputedStyle(door.querySelector(".thread-body")!)[property]);
    }

    expect(runChecks().D5).toMatchObject({ status: "pass" });
  });

  it("u197_the_card_has_no_border_and_answer_is_a_button", async () => {
    await mountReport(1280);

    const card = document.querySelector<HTMLElement>(".thread-card")!;
    const style = getComputedStyle(card);

    expect(card.querySelector(".thread-card-body strong")!.textContent).toBe("just check");
    expect(style.borderWidth || "0").toMatch(/^(0|0px)$/);
    expect(style.backgroundColor).toMatch(/^(|transparent|rgba\(0, 0, 0, 0\))$/);
    expect(style.borderRadius || "0").toMatch(/^(0|0px)$/);

    const answer = screen.queryByRole("button", { name: "answer" });

    // The report's user note already answers the question; an unanswered one keeps the button.
    expect(answer).toBeNull();
    expect(card.querySelector("[data-answered]")?.textContent).toBe("answered");

    cleanup();

    const { tree } = reportFixture();
    await mountThread(tree, { messages: [reportFixture().messages[1]!] });

    const button = await screen.findByRole("button", { name: "answer" });

    expect(button.classList.contains("word")).toBe(true);
    expect(getComputedStyle(button).color).toBe("var(--accent)");
    expect(getComputedStyle(button).fontWeight).toBe("500");
    expect(getComputedStyle(button).minHeight).toBe("var(--space-5)");
  });

  it("u197_no_thread_element_draws_a_forbidden_border", async () => {
    await mountReport(1280);

    const drawn = [...document.querySelectorAll<HTMLElement>(".thread, .thread *")].filter((el) => {
      const style = getComputedStyle(el);

      return ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"].some((side) => {
        // SAFETY: each `side` is a key of CSSStyleDeclaration holding a width.
        const width = style[side as "borderTopWidth"];

        return width !== "" && width !== "0" && width !== "0px" && width !== "medium";
      });
    });

    expect(drawn.map((el) => el.className)).toEqual([]);
    expect(runChecks().D8).toMatchObject({ status: "pass" });
  });

  it("u197_the_composer_names_the_door_and_says_enter_sends", async () => {
    const { app } = await mountReport(1280);
    const field = threadInput();

    expect(field.placeholder).toBe("Tell workstream-1 · ⏎ sends");
    expect(field.getAttribute("aria-label")).toBe("Tell workstream-1 · ⏎ sends");
    expect(field.rows).toBe(1);
    expect(getComputedStyle(document.querySelector(".thread-composer")!).backgroundColor).toBe("var(--sunken)");
    expect(getComputedStyle(document.querySelector(".thread-composer")!).borderWidth || "0").toMatch(/^(0|0px)$/);

    fireEvent.input(field, { target: { value: "hello" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await vi.waitFor(() => expect(sends(app)).toHaveLength(1));
  });

  it("u197_d11_fails_a_thread_it_cannot_measure_and_a_wide_line", async () => {
    await mountReport(1280);
    // jsdom has no layout: D11 must fail rather than pass by default.
    expect(runChecks().D11).toMatchObject({ status: "fail" });

    const body = document.querySelector<HTMLElement>(".thread-body")!;
    const measured = [...document.querySelectorAll<HTMLElement>(".thread-ask, .thread-limits, .thread-sender, .thread-body, .thread-card-body, .thread-card-answer, .thread-card-meta, .thread-composer textarea")];

    document.querySelector<HTMLElement>(".thread-ask")!.textContent = "short";

    const columnWide = (width: number) => {
      for (const el of document.querySelectorAll<HTMLElement>(".thread-column")) el.getBoundingClientRect = () => new DOMRect(0, 0, width, 100);
    };

    for (const el of measured) el.getBoundingClientRect = () => new DOMRect(40, 0, 100, 20);

    columnWide(400);
    expect(runChecks().D11, JSON.stringify(runChecks().D11)).toMatchObject({ status: "pass" });

    body.textContent = "x".repeat(81);
    expect(runChecks().D11).toMatchObject({ status: "fail" });

    body.textContent = "short";
    columnWide(900);
    expect(runChecks().D11).toMatchObject({ status: "fail" });

    columnWide(400);
    document.querySelector<HTMLElement>(".thread-ask")!.getBoundingClientRect = () => new DOMRect(52, 0, 100, 20);
    expect(runChecks().D11).toMatchObject({ status: "fail" });
  });
});
