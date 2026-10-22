import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { openDiff } from "./noteHarness";

const seen: Array<Record<string, unknown>> = [];

vi.mock("@pierre/diffs", async importOriginal => {
  const real = await importOriginal<typeof import("@pierre/diffs")>();

  return { ...real, VirtualizedFileDiff: class extends real.VirtualizedFileDiff<unknown> { constructor(options: Record<string, unknown>, ...rest: unknown[]) { seen.push(options); super(options as never, ...(rest as [never, never])); } } };
});

afterEach(cleanup);

it("z3_diff_reader_prefers_highlights", async () => {
  await openDiff();
  await screen.findByRole("button", { name: "Add note" });
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  expect(seen.every(options => options.preferredHighlighter === "highlights" && options.theme === "roundup")).toBe(true);
});

it("z3_highlights_uses_roundup_theme", async () => {
  const { registerCustomCSSVariableTheme, renderFileWithHighlighter, getSharedHighlighter } = await import("@pierre/diffs");
  registerCustomCSSVariableTheme("roundup", {});
  const highlighter = await getSharedHighlighter({ themes: ["roundup"], langs: ["typescript"], preferredHighlighter: "highlights" });
  const result = renderFileWithHighlighter({ name: "a.ts", contents: "const a = 1;\n" }, highlighter, { theme: "roundup" } as never);
  const json = JSON.stringify(result);
  expect(json).toMatch(/var\(--/);
  expect(json).not.toMatch(/#[0-9a-fA-F]{6}/);
});
