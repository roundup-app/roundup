import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openShelf } from "./padsFixture";

afterEach(cleanup);

it("u4464_empty_actions_do_what_the_existing_buttons_do_pad", async () => {
  await openShelf([]);
  fireEvent.click(await screen.findByRole("button", { name: "+ Pad" }));
  const field = await screen.findByRole("textbox", { name: /name/i });
  expect(document.activeElement).toBe(field);
});
