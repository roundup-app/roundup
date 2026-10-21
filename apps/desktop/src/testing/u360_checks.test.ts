import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChecks } from "./checks";

/** U360: D12 to D14 on fixture pages whose boxes are stubbed (`data-box="left,top,width,height"`), since jsdom has no layout. */

const box = (left: number, top: number, width: number, height: number) => `${left},${top},${width},${height}`;

const list = (name: string, count: number, top: number) => {
  const rows = Array.from({ length: count }, (_, index) => {
    const y = top + 24 + 4 + index * 32;

    return `<div class="shelf-row" data-box="${box(0, y, 160, 32)}">
        <span class="shelf-glyph"><span data-box="${box(0, y, 16, 24)}">g</span></span>
        <div class="shelf-text">
          <div class="row-head"><button><span class="shelf-title" data-box="${box(24, y, 100, 16)}">title</span></button></div>
          <p class="shelf-meta" data-box="${box(24, y + 24, 100, 16)}">meta</p>
        </div>
      </div>`;
  }).join("");

  return `<section aria-label="${name}" data-box="${box(0, top, 160, 28 + count * 32)}"><div class="group-head" data-box="${box(0, top, 160, 24)}">${name}</div><div class="shelf-list">${rows}</div></section>`;
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

const two = () => page(list("todos", 2, 0) + list("pads", 2, 24 + 4 + 2 * 32 + 12));

describe("u360 D12 left edges", () => {
  it("u360_d12_passes_when_the_glyphs_the_titles_and_the_later_lines_share_their_edges", () => {
    two();

    expect(runChecks().D12).toMatchObject({ status: "pass", value: 0 });
  });

  it("u3727_d12_measures_the_entry_text_with_tick_only_titles", () => {
    for (const value of ["", "Keep this draft"]) {
      for (const offset of [0, 1, 2, -3]) {
        page(list("todos", 1, 0));
        document.querySelector("section")!.insertAdjacentHTML("beforeend", `
          <div class="shelf-row entry-row" data-id="new-todo" data-box="0,60,160,32">
            <span class="shelf-glyph"><input class="todo-tick" type="checkbox" data-box="0,60,24,24"></span>
            <div class="shelf-text"><input class="entry-field" placeholder="New Todo" value="${value}"
              style="padding-left: 3px; border-left: 1px solid" data-box="${box(20 + offset, 60, 120, 24)}"></div>
          </div>`);
        document.querySelector(".shelf-glyph > span")!.className = "todo-tick";

        expect(runChecks().D12).toMatchObject({
          status: Math.abs(offset) <= 1 ? "pass" : "fail",
          value: Math.abs(offset),
          selector: 'div.shelf-row[data-id="new-todo"]',
        });
      }
    }
  });

  it("u360_d12_passes_with_no_shelf_row", () => {
    page("");
    expect(runChecks().D12.status).toBe("pass");
  });
});

describe("u360 D13 font role", () => {
  it("u360_d13_passes_when_only_ids_and_paths_are_mono", () => {
    two();
    document.querySelector(".shelf-meta")!.innerHTML = '<span data-mono style="font-family: var(--font-mono)">#1</span>';

    expect(runChecks().D13).toMatchObject({ status: "pass", value: 0 });
  });
});

describe("u360 D14 row shape", () => {
  it("u360_d14_passes_on_plain_rows_with_equal_step_gaps", () => {
    two();

    expect(runChecks().D14).toMatchObject({ status: "pass" });
  });
});
