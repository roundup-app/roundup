import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import styles from "./styles.css?inline";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

describe("u46 hovering or selecting never moves a row", () => {
  it("u46_the_rows_height_is_28px_at_rest_hovered_and_selected", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    const mounted = await mountRail([agent("docs", "working", "writing docs/auth.md")]);
    const height = () => getComputedStyle(rowOf("docs")).minHeight;

    const rest = height();
    fireEvent.mouseEnter(rowOf("docs"));
    const hovered = height();
    mounted.rail.select("docs");
    const selected = height();

    sheet.remove();

    expect([rest, hovered, selected]).toEqual(["28px", "28px", "28px"]);
  });

  it("u46_no_item_has_a_margin_because_the_row_gap_spaces_them", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([agent("docs", "working", "writing docs/auth.md")]);
    fireEvent.mouseEnter(rowOf("docs"));

    const result = getComputedStyle(rowOf("docs").querySelector(".name")!).marginLeft;

    sheet.remove();

    expect(result).toBe("0");
  });
});
