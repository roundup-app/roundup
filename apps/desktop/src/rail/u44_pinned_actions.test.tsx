import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import styles from "./styles.css?inline";
import { mountRail, pinnedAdd, rowOf } from "./railFixture";

afterEach(cleanup);

describe("u44 a row brought into view is never under the pinned actions", () => {
  it("u44_the_footer_sits_below_the_list_so_no_row_reserves_room_for_it", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([agent("a", "idle", "i")]);

    const bar = getComputedStyle(pinnedAdd().closest(".rail-actions") ?? document.body);
    const row = getComputedStyle(rowOf("a"));
    const values = [bar.height, row.scrollMarginBottom, bar.position];

    sheet.remove();

    expect(values).toEqual(["var(--rail-actions-height)", "0", "static"]);
    expect(styles).toMatch(/:root\s*{\s*--rail-actions-height: 40px/);
  });
});
