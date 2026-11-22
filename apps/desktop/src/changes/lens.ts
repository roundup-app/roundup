import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { groupModules, isTest, noiseOf, type Grouped } from "./modules";

/** U7679a: what the list shows: every module, the modules' logic only, or their tests only. */
export type Lens = "modules" | "logic" | "tests";

export const LENSES: readonly Lens[] = ["modules", "logic", "tests"];

/** U7679c: the first row of every lens, an item that holds no hunk. */
export const OVERVIEW = "o";

/** U7679b: a file is in a lens by U7678b's one rule; a noise file is in every lens. */
const inLens = (lens: Lens, path: string) => noiseOf(path) !== undefined || lens === "modules" || (lens === "tests") === isTest(path);

/** U7679b: the lens's modules and the noise rows, each module with the counts of its files in that lens only. */
export const groupLens = (files: readonly ChangedFile[], lens: Lens): Grouped => groupModules(files.filter(file => inLens(lens, file.path)));

/** U7679d: only the files whose path holds `letters` in one run, whatever their case; a row keeps its `total` and counts. */
export const narrow = (grouped: Grouped, letters: string): Grouped => {
  const wanted = letters.toLowerCase();
  const matching = (files: readonly ChangedFile[]) => files.filter(file => file.path.toLowerCase().includes(wanted));

  return {
    modules: grouped.modules.map(module => ({ ...module, files: matching(module.files) })).filter(module => module.files.length > 0),
    noise: grouped.noise.map(noise => ({ ...noise, files: matching(noise.files) })).filter(noise => noise.files.length > 0),
  };
};

/** U7679a: the lens `step` places after `lens` in the switch's order, wrapping at its ends. */
export const lensAfter = (lens: Lens, step: 1 | -1): Lens => LENSES[(LENSES.indexOf(lens) + step + LENSES.length) % LENSES.length] ?? lens;
