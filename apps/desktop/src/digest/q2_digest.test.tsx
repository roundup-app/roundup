import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { DigestCard, digestOf } from "./DigestCard";

const entry = {
  name: "alpha",
  kind: "idle" as const,
  last: "Change no file in the repo ".repeat(12).trim(),
  todos: 3,
  pads: ["notes", "plan", "log"],
};

describe("Q2, Q3: the Digest Card", () => {
  it("q2_digest", () => {
    const { container } = render(() => <DigestCard entry={entry} />);
    const card = container.querySelector(".digest-card")!;
    const style = getComputedStyle(card);

    expect(style.textAlign).toBe("left");
    expect(style.fontFamily).toBe("var(--font-ui)");
    expect(style.overflowWrap).toBe("anywhere");
    expect(card.textContent).toContain(entry.last);
    expect(card.textContent).toContain("3 open todos");
    expect(card.querySelectorAll("li")).toHaveLength(3);
    expect(card.querySelector("pre")).toBeNull();
  });

  it("q2_digest_reads_a_pushed_body", () => {
    expect(digestOf(`[digest] ${JSON.stringify(entry)}`)).toEqual(entry);
    expect(digestOf("[digest] nope")).toBeNull();
    expect(digestOf("hello")).toBeNull();
  });
});
