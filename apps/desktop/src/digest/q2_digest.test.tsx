import { render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { message, mountThread } from "../thread/threadFixture";
import { DigestCard, digestOf } from "./DigestCard";

const entry = {
  name: "alpha",
  kind: "idle" as const,
  last: "Change no file in the repo ".repeat(12).slice(0, 300),
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

  it("q2_digest_in_the_thread", async () => {
    await mountThread([door("r1", "idle", "idle", { name: "lead" })], {
      messages: [
        message(1, { from: { kind: "ext", id: "rupd", parent: null }, to: "r1", body: `[digest] ${JSON.stringify(entry)}` }),
      ],
    });
    await waitFor(() => expect(document.querySelector(".digest-card")).not.toBeNull());
    expect(document.querySelector(".digest-card")!.textContent).toContain("3 open todos");
    expect(entry.last).toHaveLength(300);
  });

  it("q3_digest_is_plain_text", () => {
    const { container } = render(() => <DigestCard entry={{ ...entry, last: "Run `just check` now", pads: ["```x```"] }} />);
    const card = container.querySelector(".digest-card")!;
    // A Digest is plain text (Q2): backticks stay as typed, and nothing in the card is preformatted.
    expect(getComputedStyle(card).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(card).whiteSpace).not.toBe("pre");
    expect(card.textContent).toContain("Run `just check` now");
    expect(card.querySelector("pre")).toBeNull();
  });

  it("q2_digest_reads_a_pushed_body", () => {
    expect(digestOf(`[digest] ${JSON.stringify(entry)}`)).toEqual(entry);
    expect(digestOf("[digest] nope")).toBeNull();
    expect(digestOf("hello")).toBeNull();
  });
});
