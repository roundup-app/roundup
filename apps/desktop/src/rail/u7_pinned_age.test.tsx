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

describe("u7 the elapsed time is pinned at the row's right edge", () => {
  it("u7_the_label_and_the_age_are_two_elements_with_the_age_last", async () => {
    await mountRail([asking()]);

    expect([part("live-label")?.textContent, part("live-age")?.textContent]).toEqual(["asks: keep v1 routes?", "4m"]);
    expect(part("live-label")?.nextElementSibling).toBe(part("live-age"));
  });

  it("u7_the_age_advances_with_the_clock", async () => {
    const { setNow } = await mountRail([asking()]);

    setNow(NOW + MINUTE);

    expect(part("live-age")?.textContent).toBe("5m");
  });

  it("u7_the_title_is_still_the_full_label_and_age", async () => {
    await mountRail([asking()]);

    expect(rowOf("gateway").querySelector(".live")?.getAttribute("title")).toBe("asks: keep v1 routes?  4m");
  });

  it("u7_only_the_label_shrinks_and_gets_the_ellipsis", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([asking()]);

    const label = getComputedStyle(part("live-label")!);
    const age = getComputedStyle(part("live-age")!);

    sheet.remove();

    expect([label.flexShrink, label.minWidth, label.overflow, label.textOverflow]).toEqual(["1", "0px", "hidden", "ellipsis"]);
    expect([age.flexShrink, age.whiteSpace]).toEqual(["0", "nowrap"]);
  });
});

describe("u356 a blocked row keeps its label readable", () => {
  it("u356_an_agent_live_line_and_its_label_hold_a_floor_the_name_gives_way_to", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([agent("gateway", "blocked", "waits on #12", { status: { kind: "blocked", label: "waits on #12", since: NOW - 4 * MINUTE } })]);

    const live = getComputedStyle(rowOf("gateway").querySelector(".live")!);
    const label = getComputedStyle(part("live-label")!);
    const name = getComputedStyle(rowOf("gateway").querySelector(".name")!);

    sheet.remove();

    expect([label.minWidth, live.minWidth, name.minWidth]).toEqual(["104px", "144px", "0px"]);
    expect([label.display, label.visibility]).not.toContain("none");
    expect(part("live-label")?.textContent).toBe("waits on #12");
  });
});
