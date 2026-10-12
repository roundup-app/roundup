import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, rowOf } from "./railFixture";
import { agent, MINUTE, NOW } from "../testing/nodes";
import styles from "./styles.css?inline";

afterEach(cleanup);

const asking = () =>
  agent("gateway", "needs-you", "asks: keep v1 routes?", {
    status: { kind: "needs-you", label: "asks: keep v1 routes?", since: NOW - 4 * MINUTE },
  });

const part = (cls: string) => rowOf("gateway").querySelector(`.live .${cls}`);

describe("u393 the Live line is the label alone", () => {
  it("u393_no_row_holds_an_age", async () => {
    await mountRail([asking()]);

    expect([part("live-label")?.textContent, rowOf("gateway").querySelector(".live-age")]).toEqual(["asks: keep v1 routes?", null]);
    expect(part("live-label")?.nextElementSibling).toBeNull();
  });

  it("u393_the_label_shrinks_and_gets_the_ellipsis", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([asking()]);

    const label = getComputedStyle(part("live-label")!);

    sheet.remove();

    expect([label.flexShrink, label.minWidth, label.overflow, label.textOverflow]).toEqual(["1", "0px", "hidden", "ellipsis"]);
  });
});
