import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChecks } from "../testing/checks";
import { door } from "../testing/nodes";
import { chooseFromMenu, mountThread, reportFixture, threadInput } from "./threadFixture";

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
  // The one-x and 120-character clauses need layout: `src/testing/u197_column.test.ts` asserts them in a headless browser.
  it.each(WIDTHS)("u197_every_row_sits_in_the_column_with_no_inset_of_its_own at %i", async (width) => {
    await mountReport(width);

    for (const row of document.querySelectorAll(".thread-goal, .thread-sender, .thread-body, .thread-card-body, .thread-composer textarea")) {
      expect(row.closest(".thread-column"), row.className).not.toBeNull();
    }

    for (const row of document.querySelectorAll(".thread-sender, .thread-body, .thread-card-body, .thread-goal")) {
      const style = getComputedStyle(row);

      expect(style.marginLeft || "0").toMatch(/^(0|0px)$/);
      expect(style.paddingLeft || "0").toMatch(/^(0|0px)$/);
    }

    expect(getComputedStyle(document.querySelector(".thread-column")!).maxWidth).toBe("var(--measure)");
  });

  it.each(WIDTHS)("u197_the_goal_is_the_header_and_the_menu_holds_take_over at %i", async (width) => {
    const { connected } = await mountReport(width);

    const header = document.querySelector<HTMLElement>("[data-thread-header]")!;
    const order = screen.getByRole("button", { name: "order of workstream-1" });

    expect(header.parentElement?.firstElementChild).toBe(header);
    expect(order.closest("[data-thread-header]")).toBe(header);
    expect(header.querySelector(".thread-goal")!.textContent).toContain("Give a short tour");
    expect(header.textContent).not.toContain("must not");
    expect(header.textContent).not.toMatch(/limit/);
    expect(header.contains(screen.getByRole("button", { name: "More" }))).toBe(true);
    expect(screen.queryByRole("button", { name: "take over" })).toBeNull();
    expect(document.querySelectorAll(".thread-take-over")).toHaveLength(0);

    fireEvent.click(order);
    expect(connected.drawer.content()).not.toBeNull();
  });

  it("u197_a_clarification_reads_as_the_goal", async () => {
    await mountThread([door("r1", "working", "working", { name: "w", work: { kind: "clarification", question: "what for?" } })]);
    expect(screen.getByRole("button", { name: "order of w" }).textContent).toBe("what for?");
  });

  it("u197_during_a_takeover_the_menu_holds_the_one_end_takeover", async () => {
    await mountReport(1280);
    await chooseFromMenu("Take over");

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    expect(screen.getAllByRole("menuitem", { name: "End takeover" })).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: "Take over" })).toBeNull();
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
    const { tree } = reportFixture();
    await mountThread(tree, { messages: [reportFixture().messages[1]!] });

    const card = await vi.waitFor(() => expect(document.querySelector(".thread-card")).not.toBeNull()).then(() => document.querySelector<HTMLElement>(".thread-card")!);
    const style = getComputedStyle(card);

    expect(card.querySelector(".thread-card-body strong")!.textContent).toBe("just check");
    expect(style.borderWidth || "0").toMatch(/^(0|0px)$/);
    expect(style.backgroundColor).toMatch(/^(|transparent|rgba\(0, 0, 0, 0\))$/);
    expect(style.borderRadius || "0").toMatch(/^(0|0px)$/);

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
    const measured = [...document.querySelectorAll<HTMLElement>(".thread-goal, .thread-sender, .thread-body, .thread-card-body, .thread-card-answer, .thread-card-meta, .thread-composer textarea")];

    document.querySelector<HTMLElement>(".thread-goal")!.textContent = "short";

    const columnWide = (width: number) => {
      for (const el of document.querySelectorAll<HTMLElement>(".thread-column")) el.getBoundingClientRect = () => new DOMRect(0, 0, width, 100);
    };

    for (const el of measured) el.getBoundingClientRect = () => new DOMRect(40, 0, 100, 20);

    columnWide(400);
    expect(runChecks().D11, JSON.stringify(runChecks().D11)).toMatchObject({ status: "pass" });

    body.textContent = "x".repeat(121);
    expect(runChecks().D11).toMatchObject({ status: "fail" });

    body.textContent = "short";
    columnWide(1300);
    expect(runChecks().D11).toMatchObject({ status: "fail" });

    columnWide(400);
    document.querySelector<HTMLElement>(".thread-goal")!.getBoundingClientRect = () => new DOMRect(52, 0, 100, 20);
    expect(runChecks().D11).toMatchObject({ status: "fail" });
  });
});
