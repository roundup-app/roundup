// T5456d, T7331c: one judgment of Oxlint's diagnostics against a diff, shared by the commit and push hooks. An error fails when its span meets a line the diff adds; a warning, or an error on an old line, never does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import parseDiff from "parse-diff";

export function errorsOnAddedLines(diagnostics, diffText) {
  const added = new Map(parseDiff(diffText).map(file => [resolve(file.to), new Set(file.chunks.flatMap(chunk => chunk.changes.filter(change => change.type === "add").map(change => change.ln)))]));

  function addsLine({ filename, labels }) {
    if (!labels.length) return true;

    const path = resolve(filename);
    const lines = added.get(path);

    if (!lines) return false;

    const { offset, length, line } = labels[0].span;
    const spanned = readFileSync(path).subarray(offset, offset + length).toString().split("\n").length;

    return Array.from({ length: spanned }, (_, index) => line + index).some(number => lines.has(number));
  }

  return diagnostics.filter(item => item.severity === "error" && addsLine(item));
}

export function reportErrors(failures) {
  for (const { filename, labels, code, message } of failures) {
    const { line, column } = labels[0]?.span ?? {};
    process.stderr.write(`${filename}:${line ?? 0}:${column ?? 0}: error ${code}: ${message}\n`);
  }
}
