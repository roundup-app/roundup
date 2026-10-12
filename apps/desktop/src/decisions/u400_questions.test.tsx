import { waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { card, decision, mountApp, select } from "./decisionsFixture";

const lines = [
  "Layout",
  "Which layout?",
  "1. Grid",
  "   Tiles",
  "   first",
  "   second",
  "   third",
  "2. List",
  "   Rows",
  "",
  "Parts",
  "Which parts? (choose several)",
  "1. Head",
  "2. Foot",
];

const asked = () => decision("d1", "a", { tool: "AskUserQuestion", answerable: false, args: lines.join("\n") });

describe("u400 the Card for AskUserQuestion", () => {
  it("u400_reads_as_text", async () => {
    await mountApp([asked()]);
    select("alpha");

    await waitFor(() => expect(card()).not.toBeNull());

    const args = card()!.querySelector(".decision-args")!;

    expect(args.textContent!.split("\n")).toEqual(lines);
    expect(args.textContent).not.toMatch(/[{["\\]/);
  });

  it("u400_keeps_the_terminal_buttons", async () => {
    await mountApp([asked()]);
    select("alpha");

    await waitFor(() => expect(card()).not.toBeNull());
    expect(within(card()!).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(["focus Terminal"]);
    expect(card()!.textContent).toContain("answer in the Terminal");
  });
});
