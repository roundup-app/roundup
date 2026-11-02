import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { languages } from "@codemirror/language-data";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";

Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("u5562c_language_loads_on_use", async () => {
  const ts = languages.find(language => language.name === "TypeScript")!;
  const python = languages.find(language => language.name === "Python")!;
  const tsLoad = vi.spyOn(ts, "load");
  const pythonLoad = vi.spyOn(python, "load");
  let handle: PadEditorHandle | undefined;
  render(() => <PadRichEditor text="plain" readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { handle = ready; }} />);
  await waitFor(() => expect(handle).toBeDefined());
  expect(languages.every(language => !language.support)).toBe(true);
  handle!.setText("```\nunlabelled\n```\n");
  expect(document.querySelector("pre code")).not.toBeNull();
  expect(languages.every(language => !language.support)).toBe(true);

  const source = "```ts\nconst answer: number = 42; // keeper\n```\n";
  handle!.setText(source);
  await waitFor(() => expect(ts.support).toBeDefined());
  await waitFor(() => expect(document.querySelector(".pad-syntax-keyword")).not.toBeNull());
  expect(ts.support!.language.parser.parse("const answer: number = 42").toString()).toContain("TypeAnnotation");
  expect(handle!.getText()).toBe(source);
  handle!.setText(source + "\n```ts\nlet next = answer;\n```\n");
  await waitFor(() => expect(document.querySelectorAll("pre code")).toHaveLength(2));
  expect(new Set(tsLoad.mock.results.map(result => result.value)).size).toBe(1);
  expect(pythonLoad).not.toHaveBeenCalled();

  handle!.setText("```python\nprint(42)\n```\n");
  await waitFor(() => expect(python.support).toBeDefined());
  expect(new Set(pythonLoad.mock.results.map(result => result.value)).size).toBe(1);
  expect(languages.filter(language => language.support).map(language => language.name).sort()).toEqual(["Python", "TypeScript"]);
  const unknown = "```roundup-unknown\nkeep <this>\n```\n";
  handle!.setText(unknown);
  expect(document.querySelector("pre code")).not.toBeNull();
  expect(handle!.getText()).toBe(unknown);
});
