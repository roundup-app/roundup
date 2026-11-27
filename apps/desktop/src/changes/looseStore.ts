import { createEffect, createSignal } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import type { AppSeam } from "../app/seam";
import { compareParams } from "./fileState";
import { reply } from "./notes";

/** U7923a: the lines a file's diff changes, by side. */
export type Changed = { old: number[]; new: number[] };

/** The most files a listing reads to find hunks outside every flow. */
const MAX_FILES = 50;

const patchLines = async (path: string, old: string, next: string) => {
  const { structuredPatch } = await import("diff");
  const found: Changed = { old: [], new: [] };

  for (const hunk of structuredPatch(path, path, old, next).hunks) {
    let before = hunk.oldStart;
    let after = hunk.newStart;

    for (const line of hunk.lines) {
      if (line.startsWith("+")) found.new.push(after++);
      else if (line.startsWith("-")) found.old.push(before++);
      else if (line.startsWith(" ")) { before++; after++; }
    }
  }

  return found;
};

const sideText = (side: { kind: string; text?: string } | undefined) => (side?.kind === "text" ? (side.text ?? "") : side?.kind === "absent" ? "" : null);

/**
 * U7923a: the changed lines of the files a flow holds, read once for each blob, so Unplaced can list a file whose hunk sits in no function. A new comparison target drops every answer; a failed read leaves the file as the flows hold it.
 */
export const createChangedLines = (input: { app: AppSeam; id: string; to: () => CompareTarget; group: () => OwnedGroupKey | undefined; files: () => readonly ChangedFile[] }) => {
  const [lines, setLines] = createSignal<ReadonlyMap<string, Changed>>(new Map());
  const asked = new Set<string>();
  let generation = 0;

  const read = async (file: ChangedFile) => {
    const result = await reply(() => input.app.rpc("agent.compareFile", compareParams(input.id, file.path, input.to(), input.group())));
    const old = result.kind === "ok" ? sideText(result.value.old) : null;
    const next = result.kind === "ok" ? sideText(result.value.new) : null;

    if (old === null || next === null) return null;

    return await patchLines(file.path, old, next);
  };

  createEffect(() => [input.to(), input.group() ?? ""].join("|"), () => {
    generation += 1;
    asked.clear();
    setLines(new Map());
  });

  createEffect(() => input.files().slice(0, MAX_FILES), files => {
    const mine = generation;

    for (const file of files) {
      const key = `${file.path}\0${file.blob}`;

      if (asked.has(key)) continue;
      asked.add(key);

      void read(file).then(found => {
        if (found && mine === generation) setLines(map => new Map(map).set(file.path, found));
      });
    }
  });

  return lines;
};
