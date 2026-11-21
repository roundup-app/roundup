import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VirtualizedFileDiff, getHighlighterType, getSharedHighlighter, renderFileWithHighlighter } from "@pierre/diffs";
import { openDiff, waitDiff } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }


beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.style.removeProperty("color-scheme"); vi.unstubAllGlobals(); });

it("z3_diff_reader_prefers_highlights", async () => {
  await openDiff();
  await waitDiff();
  await waitFor(() => expect(getHighlighterType()).toBe("highlights"));
});

/** The options the reader gave the library: the open view's diff instance holds them as `options`. */
const readerOptions = (render: { mock: { contexts: unknown[] } }) => {
  const view = render.mock.contexts.at(-1);

  if (!(view instanceof VirtualizedFileDiff)) throw new Error("The reader rendered no diff");

  return view.options;
};

for (const mode of ["dark", "light"]) {
  it(`u7674d_the_reader_uses_github_light_in_both_modes (${mode})`, async () => {
    document.documentElement.style.colorScheme = mode;
    const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
    await openDiff();
    await waitDiff();
    expect(readerOptions(render)).toMatchObject({ theme: "github-light" });
    const highlighter = await getSharedHighlighter({ themes: ["github-light"], langs: ["typescript"], preferredHighlighter: "highlights" });
    expect(JSON.stringify(renderFileWithHighlighter({ name: "a.ts", contents: "const a = 1;\n" }, highlighter, { theme: "github-light", useTokenTransformer: false, tokenizeMaxLineLength: 1000 }))).toMatch(/#[0-9a-fA-F]{6}/);
  });
}

it("u7674c_the_reader_wraps_long_lines", async () => {
  const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
  await openDiff();
  await waitDiff();
  expect(readerOptions(render)).toMatchObject({ overflow: "wrap" });
});
