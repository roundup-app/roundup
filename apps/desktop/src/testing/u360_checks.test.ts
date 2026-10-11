import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_IDS, runChecks } from "./checks";
import designSystem from "../../../../docs/design-system.md?raw";

/** U360: D12 to D14 on fixture pages whose boxes are stubbed (`data-box="left,top,width,height"`), since jsdom has no layout. */

const box = (left: number, top: number, width: number, height: number) => `${left},${top},${width},${height}`;

type Row = { glyph?: number; title?: number; line?: number; top?: number; height?: number; titleHeight?: number; style?: string; titleStyle?: string; metaStyle?: string };

const list = (name: string, rows: Row[], top: number, gap = 0, head = 4) => {
  let at = top + 24 + head;

  const body = rows
    .map((row) => {
      const y = row.top ?? at;
      const h = row.height ?? 32;

      at = y + h + gap;

      return `<div class="shelf-row" style="${row.style ?? ""}" data-box="${box(0, y, 160, h)}">
        <span class="shelf-glyph"><span data-box="${box(row.glyph ?? 0, y, 16, 24)}">g</span></span>
        <div class="shelf-text">
          <div class="row-head"><button><span class="shelf-title" style="${row.titleStyle ?? ""}" data-box="${box(row.title ?? 24, y, 100, row.titleHeight ?? 16)}">title</span></button></div>
          <p class="shelf-meta" style="${row.metaStyle ?? ""}" data-box="${box(row.line ?? 24, y + 24, 100, 16)}">meta</p>
        </div>
      </div>`;
    })
    .join("");

  return `<section aria-label="${name}" data-box="${box(0, top, 160, at - top)}"><div class="group-head" data-box="${box(0, top, 160, 24)}">${name}</div>${body}</section>`;
};

const page = (body: string) => {
  document.body.innerHTML = `<div class="shelf">${body}</div>`;
};

const tokens = document.createElement("style");

tokens.textContent = ":root { --font-ui: -apple-system, sans-serif; --font-mono: ui-monospace, monospace; }";

beforeEach(() => {
  document.head.appendChild(tokens);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    // SAFETY: every `data-box` this file writes holds four numbers.
    const [left, top, width, height] = (this.getAttribute("data-box") ?? "0,0,0,0").split(",").map(Number) as [number, number, number, number];

    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  });
});

afterEach(() => {
  tokens.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const two = (todos: Row[] = [{}, {}], pads: Row[] = [{}, {}], listGap = 12) => page(list("todos", todos, 0) + list("pads", pads, 24 + 4 + todos.length * 32 + listGap));

describe("u360 D12 left edges", () => {
  it("u360_d12_passes_when_the_glyphs_the_titles_and_the_later_lines_share_their_edges", () => {
    two();

    expect(runChecks().D12).toMatchObject({ status: "pass", value: 0 });
  });

  it("u360_d12_fails_with_the_largest_difference_when_a_glyph_is_off", () => {
    two([{}, { glyph: 5 }]);

    expect(runChecks().D12).toMatchObject({ status: "fail", value: 5 });
  });

  it("u360_d12_fails_when_a_title_is_off", () => {
    two([{}, {}], [{}, { title: 40 }]);

    expect(runChecks().D12).toMatchObject({ status: "fail", value: 16 });
  });

  it("u360_d12_fails_when_a_line_after_the_first_starts_left_of_its_title", () => {
    two([{ line: 8 }]);

    expect(runChecks().D12).toMatchObject({ status: "fail", value: 16, selector: "div.shelf-row" });
  });

  it("u360_d12_passes_with_no_shelf_row_and_fails_not_measurable_with_no_layout", () => {
    page("");
    expect(runChecks().D12.status).toBe("pass");

    two();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });

    expect(runChecks().D12).toMatchObject({ status: "fail", value: "not measurable" });
  });
});

describe("u360 D13 font role", () => {
  it("u360_d13_passes_when_only_ids_and_paths_are_mono", () => {
    two();
    document.querySelector(".shelf-meta")!.innerHTML = '<span data-mono style="font-family: var(--font-mono)">#1</span>';

    expect(runChecks().D13).toMatchObject({ status: "pass", value: 0 });
  });

  it("u360_d13_counts_the_mono_words_that_are_neither_ids_nor_paths", () => {
    two();
    document.querySelectorAll(".shelf-title").forEach((title) => title.setAttribute("style", "font-family: var(--font-mono)"));

    expect(runChecks().D13).toMatchObject({ status: "fail", value: 4, selector: "span.shelf-title" });
  });
});

describe("u360 D14 row shape", () => {
  it("u360_d14_passes_on_plain_rows_with_equal_step_gaps", () => {
    two();

    expect(runChecks().D14).toMatchObject({ status: "pass" });
  });

  it("u360_d14_fails_on_a_filled_row", () => {
    two([{ style: "background-color: rgb(10, 10, 10)" }]);

    expect(runChecks().D14).toMatchObject({ status: "fail", value: { backgroundColor: "rgb(10, 10, 10)" } });
  });

  it("u360_d14_fails_on_a_row_with_a_border_or_a_shadow", () => {
    two([{ style: "border: 1px solid red" }]);
    expect(runChecks().D14.status).toBe("fail");

    two([{ style: "box-shadow: 0 0 2px black" }]);
    expect(runChecks().D14.status).toBe("fail");
  });

  it("u360_d14_fails_on_a_gap_that_is_no_space_step", () => {
    page(list("todos", [{}, {}], 0, 5) + list("pads", [{}, {}], 100, 5));

    expect(runChecks().D14).toMatchObject({ status: "fail", value: { gap: 5 } });
  });

  it("u360_d14_fails_when_the_two_lists_keep_different_step_gaps", () => {
    page(list("todos", [{}, {}], 0, 0) + list("pads", [{}, {}], 100, 4));

    expect(runChecks().D14).toMatchObject({ status: "fail", value: { between: [0, 4] } });
  });

  it("u360_d14_fails_on_a_title_of_three_lines_or_one_wider_than_its_row", () => {
    two([{ titleHeight: 48, titleStyle: "line-height: 16px" }]);
    expect(runChecks().D14).toMatchObject({ status: "fail", value: { lines: 3 } });

    two([{ title: 100 }]);
    expect(runChecks().D14).toMatchObject({ status: "fail", value: { overflow: 40 } });
  });

  it("u360_d14_fails_not_measurable_with_no_layout", () => {
    two();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });

    expect(runChecks().D14).toMatchObject({ status: "fail", value: "not measurable" });
  });
});

describe("u360 the registry", () => {
  it("u360_the_three_checks_are_in_check_ids_and_in_the_design_system_table", () => {
    expect(CHECK_IDS.slice(-3)).toEqual(["D12", "D13", "D14"]);

    for (const id of ["D12", "D13", "D14"]) expect(designSystem).toMatch(new RegExp(`^\\| ${id} \\|`, "m"));
  });
});
