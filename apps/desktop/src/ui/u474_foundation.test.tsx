import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { IconButton } from "./index";

afterEach(cleanup);

it("u474_icon_button_has_its_name", () => {
  render(() => <IconButton aria-label="Close Project">×</IconButton>);
  expect(screen.getByRole("button", { name: "Close Project" }).dataset.button).toBe("icon");
});

// u474_icon_button_requires_a_name: tsc checks both sides of the contract.
const named = <IconButton aria-label="Close Project">×</IconButton>;
// @ts-expect-error An icon alone is not an accessible name.
const unnamed = <IconButton>×</IconButton>;
void [named, unnamed];
