import type { Lens } from "../changes/lens";
import type { Place } from "../changes/lines";

/** U7675d, U7675f, U7679c: one Agent's open item, the lens it was in and each file's place in the Changes view. */
export type Remembered = { open: string | undefined; lens: Lens; places: Map<string, Place> };

/** U7675f: each Agent's open file and every file's place, kept for the connection's session like its Changes view choice (U7672d). */
export const createChangePlaces = () => {
  const remembered = new Map<string, Remembered>();

  return {
    of: (id: string): Remembered => {
      const found = remembered.get(id);

      if (found) return found;
      const made: Remembered = { open: undefined, lens: "modules", places: new Map() };

      remembered.set(id, made);

      return made;
    },
  };
};
