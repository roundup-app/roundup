import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { KindGlyph } from "./KindGlyph";

afterEach(cleanup);

it("u471_previous_copy_assertions_are_preserved_decorative_marks_have_no_spoken_label", () => {
  const { container } = render(() => <><KindGlyph kind="working" decorative /></>);
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelectorAll("[aria-label]").length).toBe(0);
});
