import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail } from "./railFixture";

afterEach(cleanup);

it("u447_the_workstreams_head_has_icon_and_label", async () => {
  await mountRail([workstream("w")]);
  const head = screen.getByText("WORKSTREAMS").closest(".section-head")!;
  expect(head).not.toBeNull();
  expect(head.querySelector(".icon")?.getAttribute("aria-hidden")).toBe("true");
  expect(head.querySelector("button, [tabindex]")).toBeNull();
});
