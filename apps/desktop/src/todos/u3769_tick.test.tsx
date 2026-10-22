import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

describe("u3769 the tick box draws its tick", () => {
  it("u3769_the_tick_is_the_one_native_checkbox", async () => {
    await mountTodos([todo(1), todo(2, { done: true })]);
    await waitFor(() => expect(document.querySelectorAll(".todo-row").length).toBeGreaterThan(0));

    const box = await screen.findByRole("checkbox", { name: "Complete todo 1" });

    expect(box.tagName).toBe("INPUT");
    expect(box.getAttribute("type")).toBe("checkbox");
    expect(screen.getAllByRole("checkbox").every((item) => item.closest(".todo-tick-box") !== null)).toBe(true);
    expect(box.nextElementSibling?.querySelector("path")?.getAttribute("pathLength")).toBe("1");
  });

  it("u3769_a_done_row_mounts_with_the_tick_drawn", async () => {
    await mountTodos([todo(1, { done: true }), todo(2)], false);

    fireEvent.click(await screen.findByRole("button", { name: /1 done/ }));
    await waitFor(() => expect(document.querySelector("[data-todo='1'] input.todo-tick")).not.toBeNull());

    expect(document.querySelector<HTMLInputElement>("[data-todo='1'] input.todo-tick")?.checked).toBe(true);
    expect(document.querySelectorAll(".todo-row[data-motion], .app-progress[data-motion]")).toHaveLength(0);
  });
});

describe("u3771 the motion reads its timings from Tokens", () => {
  it("u3771_no_literal_duration_or_ease_outside_tokens", () => {
    for (const file of ["rowButton.styles.css", "../ui/Progress.css"]) {
      const css = readFileSync(new URL(file, import.meta.url), "utf8");

      const timed = css.split("\n").filter((line) => /animation|transition/.test(line) && !/^\s*\/?\*/.test(line));

      expect(timed.filter((line) => /[1-9]\d*m?s\b|cubic-bezier|(?<![-\w])ease(-in|-out)?\b/.test(line)), file).toEqual([]);
      expect(css).not.toMatch(/transition(-property)?:\s*all/);
    }
  });

  it("u3771_the_effects_resolve_the_token_durations", () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
    const tokens = read("../tokens.css");
    const rows = read("rowButton.styles.css");
    const bar = read("../ui/Progress.css");

    const effects: [string, string, string][] = [
      [rows, "todo-ring-pop", "--duration-ring"],
      [rows, "todo-tick-draw", "--duration-tick"],
      [rows, "todo-strike-grow", "--duration-strike"],
      [rows, "todo-count-roll", "--duration-count"],
      [bar, "transition-duration", "--duration-bar"],
    ];

    const strike = rows.match(/@keyframes todo-strike-grow\s*\{([^@]*?\})\s*\}/)?.[1] ?? "";
    expect([...strike.matchAll(/([\w-]+)\s*:/g)].flatMap((m) => (m[1] === "text-decoration-color" ? [] : [m[1]]))).toEqual([]);

    for (const [css, effect, token] of effects) {
      expect(css, effect).toMatch(new RegExp(`${effect}[^;]*var\\(${token}\\)|${effect}:\\s*var\\(${token}\\)`));
      expect(tokens, token).toMatch(new RegExp(`${token}:\\s*\\d+m?s`));
    }
  });
});
