import { expect, it } from "vitest";
import { bodyOf, excerptOf } from "./excerpt";

const bytes = (text: string) => new TextEncoder().encode(text).length;

it("u515_a_long_excerpt_keeps_its_end_and_says_what_it_cut", () => {
  const rows = Array.from({ length: 2000 }, (_, at) => `line ${at} é`);
  const excerpt = excerptOf(rows.join("\n"))!;

  expect(bytes(excerpt)).toBeLessThanOrEqual(6000);
  expect(excerpt).toMatch(/^\[… \d+ lines cut\]\nline /);
  expect(excerpt.endsWith("line 1999 é")).toBe(true);
  expect(excerpt).not.toContain("�");
  expect(excerptOf("short   \nrows  ")).toBe("short\nrows");
});

it("u516_the_body_is_note_then_the_fenced_excerpt_then_the_known_facts", () => {
  expect(bodyOf("why?", "ls\na", { command: "ls", cwd: "/work", exit: 2 })).toBe("why?\n\n```\nls\na\n```\n\ncommand: ls\ncwd: /work\nexit: 2");
  expect(bodyOf("", "sleep", { command: "sleep 9", cwd: null, exit: "running" })).toBe("```\nsleep\n```\n\ncommand: sleep 9\nexit: running");
  expect(bodyOf("", "   ", null)).toBeNull();
});

it("u516_the_fence_outgrows_backticks_in_the_excerpt", () => {
  expect(bodyOf("", "a ``` b\n`` c", null)).toBe("````\na ``` b\n`` c\n````");
});

it("u516_plain_text_sends_no_facts", () => {
  expect(bodyOf("", "text", null)).toBe("```\ntext\n```");
});

it("u516_the_body_stays_within_b1s_bound_at_the_largest_inputs", () => {
  const body = bodyOf("é".repeat(280), "x".repeat(20000), { command: "c".repeat(900), cwd: "/".repeat(900), exit: 1 })!;

  expect(bytes(body)).toBeLessThanOrEqual(8192);
});
