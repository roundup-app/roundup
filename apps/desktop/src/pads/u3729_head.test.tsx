import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "./owner";

afterEach(cleanup);

const head = () => document.querySelector<HTMLElement>(".pad-head")!;

it("u3729_the_pad_head_has_no_glyph_and_a_status_after_the_name", async () => {
  await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");
  fireEvent.input(field, { target: { value: "new" } });
  const status = await screen.findByRole("status", {}, { timeout: 3000 });
  const name = head().querySelector<HTMLElement>(".pad-head-name")!;

  expect(status.textContent).toBe("Saved");
  expect(name.textContent).toBe("notes");
  expect(name.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...head().querySelectorAll("svg")].filter(glyph => glyph.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING)).toEqual([]);
});
