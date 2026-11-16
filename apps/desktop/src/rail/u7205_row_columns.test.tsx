import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { shownText } from "../testing/rowTip";
import { railAge } from "../shelf/Age";
import { itemOf, mountRail } from "./railFixture";

afterEach(cleanup);

const KINDS = ["error", "needs-you", "blocked", "working", "done", "idle"] as const;

const find = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);

  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const since = () => ({ since: Date.now() - 15 * 60_000, finished: "0" });

it("u7205a_a_row_holds_no_status_words", async () => {
  const nodes = KINDS.map((kind, order) => agent(kind, kind, `${kind} label`, { name: kind, order, status: { kind, label: `${kind} label`, ...since() } }));

  await mountRail(nodes);

  for (const kind of KINDS) {
    const row = itemOf(kind);

    expect(shownText(row)).not.toContain(`${kind} label`);
    expect(row.querySelector(".row-status, .failure-line, [data-failure]")).toBeNull();
  }
});

it("u7205a_the_glyph_tooltip_and_name_carry_the_status", async () => {
  await mountRail([agent("e", "error", "Rate limited, retry later", { name: "e", status: { kind: "error", label: "Rate limited, retry later", ...since() } })]);
  const row = itemOf("e");
  const glyph = find(row, ".row-state [role=img]");

  expect(glyph.getAttribute("aria-label")).toContain("Rate limited, retry later");
  fireEvent.pointerEnter(find(row, ".row-state"), { pointerType: "mouse", clientX: 0, clientY: 0 });
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(glyph.getAttribute("aria-label")));
});

it("u7205a_keyboard_focus_on_the_row_opens_the_glyph_tooltip", async () => {
  await mountRail([agent("e", "working", "building", { name: "e", status: { kind: "working", label: "building", ...since() } })]);
  const row = itemOf("e");

  fireEvent.keyDown(document.body, { key: "Tab" });
  row.focus();
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(find(row, ".row-state [role=img]").getAttribute("aria-label")));
});

it("u7205c_age_text_uses_short_units", () => {
  const now = 10_000_000_000;
  const table: [number, string][] = [[0, "0s"], [59, "59s"], [60, "1m"], [59 * 60, "59m"], [3600, "1h"], [23 * 3600, "23h"], [86400, "1d"], [6 * 86400, "6d"], [28 * 86400, "28d"]];

  for (const [seconds, text] of table) expect(railAge(now - seconds * 1000, now)).toBe(text);
});

it("u7205e_attribution_is_an_icon_with_the_started_by_tooltip", async () => {
  await mountRail([agent("a", "idle", "", { name: "alpha", start_attribution: { project: "p", agent: "s", agent_name: "Sound stack", project_name: "tools" } })]);
  const row = itemOf("alpha");
  const icon = find(row, ".attribution-icon");

  expect(row.querySelector(".reserved-line")).toBeNull();
  fireEvent.pointerEnter(icon, { pointerType: "mouse", clientX: 0, clientY: 0 });
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(icon.getAttribute("aria-label")));
});

it("u7205g_every_row_kind_uses_the_trailing_column", async () => {
  await mountRail([agent("a", "working", "go", { name: "alpha", status: { kind: "working", label: "go", ...since() } }), agent("b", "idle", "", { name: "beta", parent: "a", status: { kind: "idle", label: "", ...since() } })]);

  for (const name of ["alpha", "beta"]) {
    const row = itemOf(name);

    expect(row.querySelectorAll(".row-age")).toHaveLength(1);
    expect(find(row, ".line").lastElementChild?.classList.contains("row-age")).toBe(true);
    expect(find(row, ".row-age").textContent?.endsWith("m")).toBe(true);
  }
});

it("u7205a_u7205g_every_row_kind_holds_one_line_with_its_reasons_in_the_tooltip", async () => {
  const stamp = since();
  await mountRail([
    door("ws", "error", "Door gone", { name: "work", waiting: 2, status: { kind: "error", label: "Door gone", ...stamp } }),
    workstream("idle", { name: "stopped", waiting: 3 }),
    agent("mode", "idle", "", { name: "review mode", mode_prompt: "Review it", status: { kind: "idle", label: "", ...stamp } }),
    agent("spent", "error", "Claude is overloaded", { name: "spent", resume: { at: null }, status: { kind: "error", label: "Claude is overloaded", ...stamp } }),
    agent("lost", "idle", "ready", { name: "lost", unreachable: "no receipt after 30 s", status: { kind: "idle", label: "ready", ...stamp } }),
    agent("child", "idle", "ready", { name: "child", parent: "ws", status: { kind: "idle", label: "ready", ...stamp } }),
  ]);

  for (const name of ["work", "stopped", "review mode", "spent", "lost", "child"]) {
    const row = itemOf(name);

    expect(row.querySelectorAll(".line"), name).toHaveLength(1);
    expect(row.querySelector(".reserved-line, .failure-line, [data-failure], .row-status"), name).toBeNull();
    expect(find(row, ".line").lastElementChild?.classList.contains("row-age"), name).toBe(true);
  }

  expect(find(itemOf("stopped"), ".row-state [role=img]").getAttribute("aria-label")).toContain("Door stopped · 3 waiting");
  expect(find(itemOf("spent"), ".row-state [role=img]").getAttribute("aria-label")).toContain("Claude is overloaded");
  expect(find(itemOf("lost"), ".row-state [role=img]").getAttribute("aria-label")).toContain("no receipt after 30 s");
  expect(find(itemOf("lost"), "button.rail-unreachable").getAttribute("aria-label")).toBe("Retry lost");
});
