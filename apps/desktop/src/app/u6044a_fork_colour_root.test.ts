import { afterEach, describe, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { applyForkColour } from "./forkColour";

afterEach(() => { delete document.documentElement.dataset.forkColour; });

describe("u6044a the root wears the Fork's colour", () => {
  it("u6044a_app_sets_the_root_attribute_from_fork_colour", async () => {
    await applyForkColour({ ...createFakeApp(), forkColour: async () => "blue" }, document.documentElement);

    expect(document.documentElement.dataset.forkColour).toBe("blue");
  });

  it("u6044a_live_app_sets_no_root_attribute", async () => {
    document.documentElement.dataset.forkColour = "red";
    await applyForkColour(createFakeApp(), document.documentElement);

    expect(document.documentElement.hasAttribute("data-fork-colour")).toBe(false);
  });
});
