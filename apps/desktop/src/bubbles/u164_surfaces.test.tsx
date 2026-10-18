import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountBubbles } from "./bubblesFixture";

afterEach(cleanup);

describe("u164 surfaces", () => {
  it("u164_the_bubble_layer_floats_over_the_stack", async () => {
    await mountBubbles("a");
    await waitFor(() => expect(document.querySelector(".bubbles")).not.toBeNull());

    expect(document.querySelector(".bubbles")!.parentElement!.className).toBe("centre-stack");
  });
});
