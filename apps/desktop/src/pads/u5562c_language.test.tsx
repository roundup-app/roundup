import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";

Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u5562c_language_loads_on_use", async () => {
  // jsdom has no viewport; deliver the browser's visible-block observation.
  vi.stubGlobal("IntersectionObserver", class implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly scrollMargin = "0px";
    readonly thresholds = [];
    takeRecords() { return []; }
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => this.callback([{ target, isIntersecting: true, intersectionRatio: 1, time: 0, boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(), rootBounds: null }], this));
    }
    unobserve() {}
    disconnect() {}
  });
  const ts = languages.find(language => language.name === "TypeScript")!;
  const python = languages.find(language => language.name === "Python")!;
  const tsLoad = vi.spyOn(ts, "load");
  const pythonLoad = vi.spyOn(python, "load");
  let handle: PadEditorHandle | undefined;
  render(() => <PadRichEditor text="plain" readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { handle = ready; }} />);
  await waitFor(() => expect(handle).toBeDefined());
  expect(languages.every(language => !language.support)).toBe(true);
  handle!.setText("```\nunlabelled\n```\n");
  await waitFor(() => expect(document.querySelector(".cm-content")).not.toBeNull());
  expect(languages.every(language => !language.support)).toBe(true);

  const source = "```ts\nconst answer: number = 42; // keeper\n```\n";
  handle!.setText(source);
  await waitFor(() => expect(ts.support).toBeDefined());
  const content = document.querySelector<HTMLElement>(".cm-content")!;
  const view = EditorView.findFromDOM(content)!;
  expect(syntaxTree(view.state).toString()).toContain("TypeAnnotation");
  expect(handle!.getText()).toBe(source);
  handle!.setText(source + "\n```ts\nlet next = answer;\n```\n");
  await waitFor(() => expect(document.querySelectorAll(".cm-content")).toHaveLength(2));
  expect(tsLoad).toHaveBeenCalledTimes(1);
  expect(pythonLoad).not.toHaveBeenCalled();

  handle!.setText("```python\nprint(42)\n```\n");
  await waitFor(() => expect(python.support).toBeDefined());
  expect(pythonLoad).toHaveBeenCalledTimes(1);
  expect(languages.filter(language => language.support).map(language => language.name).sort()).toEqual(["Python", "TypeScript"]);
  const unknown = "```roundup-unknown\nkeep <this>\n```\n";
  handle!.setText(unknown);
  await waitFor(() => expect(EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-content")!)?.state.doc.toString()).toBe("keep <this>"));
  expect(handle!.getText()).toBe(unknown);
});
