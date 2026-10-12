import { describe, expect, it } from "vitest";
import { digestOf } from "./DigestCard";

describe("B33: the Digest Card reads the plain text body", () => {
  it("b33_digest_card_reads_the_text_body", () => {
    const plain = "[digest] fix-rail is needs-you\n  last: I filed #1077 (Mode: specify)\n  open todos: 2\n  pads: notes, plan\n  (3 changes)";

    expect(digestOf(plain)).toEqual({
      note: null,
      entries: [{ name: "fix-rail", kind: "needs-you", last: "I filed #1077 (Mode: specify)", todos: 2, pads: ["notes", "plan"] }],
      more: null,
    });

    const rollup = "[digest] [2 updates held back]\nb is idle\n  last: x\n  open todos: 0\na is error\n  last: y\n  open todos: 1\n[+3 more: c, d, e]";
    const read = digestOf(rollup)!;

    expect(read.note).toBe("[2 updates held back]");
    expect(read.entries.map((e) => [e.name, e.kind, e.todos])).toEqual([["b", "idle", 0], ["a", "error", 1]]);
    expect(read.more).toBe("[+3 more: c, d, e]");
  });
});
