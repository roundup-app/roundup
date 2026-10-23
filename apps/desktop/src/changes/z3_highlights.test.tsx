import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getHighlighterType, getSharedHighlighter, registerCustomCSSVariableTheme, renderFileWithHighlighter } from "@pierre/diffs";
import { openDiff } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }


beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("z3_diff_reader_prefers_highlights", async () => {
  await openDiff();
  await screen.findByRole("button", { name: "Add note" });
  await waitFor(() => expect(getHighlighterType()).toBe("highlights"));
});

it("z3_highlights_uses_roundup_theme", async () => {
  registerCustomCSSVariableTheme("roundup", {});
  const highlighter = await getSharedHighlighter({ themes: ["roundup"], langs: ["typescript"], preferredHighlighter: "highlights" });
  const result = JSON.stringify(renderFileWithHighlighter({ name: "a.ts", contents: "const a = 1;\n" }, highlighter, { theme: "roundup", useTokenTransformer: false, tokenizeMaxLineLength: 1000 }));
  expect(result).toMatch(/var\(--/);
  expect(result).not.toMatch(/#[0-9a-fA-F]{6}/);
});
