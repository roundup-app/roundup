import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { colourOf, contrastRatio, loadTokens, withStylesheets } from "../testing/contrast";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

describe("u4 ink contrast: Shelf", () => {
  it("u4_a_todos_title_meets_4_5_to_1", async () => {
    const { tokens, ground } = loadTokens();

    await withStylesheets(async () => {
      await mountTodos([todo(1)]);
      await screen.findByText(/todo 1/);

      expect(contrastRatio(colourOf(screen.getByText(/todo 1/), tokens), ground)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
