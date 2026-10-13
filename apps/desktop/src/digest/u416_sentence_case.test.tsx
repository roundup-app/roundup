import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { DigestCard, DigestCards } from "./DigestCard";

afterEach(cleanup);

const entry = { name: "agent lower", kind: "idle" as const, last: "keep API_CASE in src/a.ts", todos: 2, pads: ["lower pad", "API_CASE"] };

it.each<[Kind, string]>([
  ["error", "Error"], ["needs-you", "Needs-you"], ["blocked", "Blocked"],
  ["working", "Working"], ["idle", "Idle"], ["done", "Done"],
])("u416_digest_status_uses_sentence_case_for_%s", (kind, label) => {
  render(() => <DigestCard entry={{ ...entry, kind }} />);

  expect(screen.getByRole("region", { name: "Digest of agent lower" }).querySelector(".digest-title .light")?.textContent).toBe(label);
});

it.each<[number, string]>([[0, "0 open Todos"], [1, "1 open Todo"], [2, "2 open Todos"]])("u416_digest_todo_count_keeps_glossary_case_for_%s", (todos, label) => {
  render(() => <DigestCard entry={{ ...entry, todos }} />);

  expect(screen.getByText(label)).toBeTruthy();
});

it("u416_digest_authored_text_stays_as_written", () => {
  const { container } = render(() => <DigestCards digest={{ entries: [entry], note: "[2 updates held back]", more: "[+1 more: lower name]" }} />);

  expect(screen.getByRole("region", { name: "Digest of agent lower" }).querySelector(".digest-title span")?.textContent).toBe("agent lower");
  expect(screen.getByText("keep API_CASE in src/a.ts")).toBeTruthy();
  expect([...container.querySelectorAll("li")].map((pad) => pad.textContent)).toEqual(["lower pad", "API_CASE"]);
  expect([...container.querySelectorAll(".digest-note")].map((note) => note.textContent)).toEqual(["[2 updates held back]", "[+1 more: lower name]"]);
});
