import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VirtualizedFileDiff, getHighlighterType, getSharedHighlighter, renderFileWithHighlighter } from "@pierre/diffs";
import { saveAppSettings } from "../settings/preferences";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, openDiff, openFile, waitDiff } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }


beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); document.documentElement.style.removeProperty("color-scheme"); vi.unstubAllGlobals(); });

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

for (const [mode, theme] of [["dark", "github-dark-default"], ["light", "github-light"]] as const) {
  it(`u8035_the_reader_uses_the_theme_of_the_app (${mode})`, async () => {
    await saveAppSettings({ mode });
    const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
    await openDiff();
    await waitDiff();
    expect(readerOptions(render)).toMatchObject({ theme });
    const highlighter = await getSharedHighlighter({ themes: [theme], langs: ["typescript"], preferredHighlighter: "highlights" });
    expect(JSON.stringify(renderFileWithHighlighter({ name: "a.ts", contents: "const a = 1;\n" }, highlighter, { theme, useTokenTransformer: false, tokenizeMaxLineLength: 1000 }))).toMatch(/#[0-9a-fA-F]{6}/);
  });
}

it("u8035_switching_the_app_theme_redraws_the_diff", async () => {
  await saveAppSettings({ mode: "light" });
  const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
  await openDiff();
  await waitDiff();
  expect(readerOptions(render)).toMatchObject({ theme: "github-light" });
  await saveAppSettings({ mode: "dark" });
  await waitFor(() => expect(readerOptions(render)).toMatchObject({ theme: "github-dark-default" }));
});

it("u8035_a_changed_file_keeps_its_changed_line_ground", async () => {
  const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
  await openDiff();
  await waitDiff();
  expect(readerOptions(render)).toMatchObject({ diffIndicators: "classic", disableBackground: false });
});

it("u8035_a_new_file_draws_no_added_line_ground", async () => {
  const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
  const { app } = await mountControl(undefined, "/p");
  app.handlers["agent.compareFile"] = params => ({ ...COMPARISON, status: "added", oldPath: params.path, newPath: params.path, old: { kind: "text", revision: "none", text: "" } });
  await openChanges();
  await openFile();
  expect(readerOptions(render)).toMatchObject({ diffIndicators: "none", disableBackground: true });
});

it("u7674c_the_reader_wraps_long_lines", async () => {
  const render = vi.spyOn(VirtualizedFileDiff.prototype, "render");
  await openDiff();
  await waitDiff();
  expect(readerOptions(render)).toMatchObject({ overflow: "wrap" });
});
