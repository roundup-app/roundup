import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { KindGlyph } from "./KindGlyph";
import styles from "./styles.css?inline";

afterEach(cleanup);

it("u446_the_working_arc_turns", () => {
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = styles;
  try {
    const { container } = render(() => <KindGlyph kind="working" />);
    const arc = container.querySelector("path")!;
    const style = getComputedStyle(arc);
    expect(style.animationName).toBe("working-turn");
    expect(style.animationTimingFunction).toBe("linear");
    expect(style.animationIterationCount).toBe("infinite");
    expect(container.querySelector("svg > circle")?.getAttribute("r")).toBe("6");
  } finally {
    sheet.remove();
  }
});
