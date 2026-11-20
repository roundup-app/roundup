import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getHighlighterType, getSharedHighlighter, renderFileWithHighlighter } from "@pierre/diffs";
import { openDiff } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }


beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("z3_diff_reader_prefers_highlights", async () => {
  await openDiff();
  await screen.findByRole("button", { name: "Add note" });
  await waitFor(() => expect(getHighlighterType()).toBe("highlights"));
});

it("u7674d_the_reader_uses_github_light_in_both_modes", async () => {
  await openDiff();
  await screen.findByRole("button", { name: "Add note" });
  const highlighter = await getSharedHighlighter({ themes: ["github-light"], langs: ["typescript"], preferredHighlighter: "highlights" });
  const result = JSON.stringify(renderFileWithHighlighter({ name: "a.ts", contents: "const a = 1;\n" }, highlighter, { theme: "github-light", useTokenTransformer: false, tokenizeMaxLineLength: 1000 }));
  expect(result).toMatch(/#[0-9a-fA-F]{6}/);
});
