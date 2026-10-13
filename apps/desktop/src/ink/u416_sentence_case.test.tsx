import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { KindGlyph } from "./KindGlyph";
import { OwnerMark } from "./OwnerMark";

afterEach(cleanup);

it.each([
  ["error", "Error"], ["needs-you", "Needs-you"], ["blocked", "Blocked"],
  ["working", "Working"], ["idle", "Idle"], ["done", "Done"],
] as const)("u416_glyph_names_use_sentence_case_for_%s", (kind, label) => {
  render(() => <KindGlyph kind={kind} />);
  expect(screen.getByRole("img", { name: label })).toBeTruthy();
});

it.each([
  ["user", "User owned"], ["agent", "Agent owned"], ["extension", "Extension owned"],
] as const)("u416_owner_marks_use_sentence_case_for_%s", (kind, label) => {
  render(() => <OwnerMark owner={{ kind, id: "workstream", parent: null }} />);
  expect(screen.getByRole("img", { name: label })).toBeTruthy();
});

it("u416_decorative_marks_have_no_spoken_label", () => {
  const { container } = render(() => <><KindGlyph kind="working" decorative /><OwnerMark owner={{ kind: "agent", id: "workstream", parent: null }} decorative /></>);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelectorAll("[aria-label]").length).toBe(0);
});
