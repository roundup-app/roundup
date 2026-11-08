import type { AppSeam } from "../app/seam";
import { CHORD_ROWS, recordable } from "../keys/chords";
import { setFileKeys, setFileLook } from "./configFile";
import { copy } from "./copy";
import { checkFilePress } from "./shortcutRules";

/** MC41: why `keys` cannot apply whole, or null; the Daemon already checked each press parses. */
export const refuseKeys = (keys: Readonly<Record<string, string>>): string | null => {
  const names = new Set(CHORD_ROWS.filter(recordable).map(chord => chord.name));
  const taken = new Map<string, string>();

  for (const [name, press] of Object.entries(keys)) {
    if (!names.has(name)) return copy.keysUnknownAction(name);

    const refusal = checkFilePress(name, press) ?? (taken.has(press) ? copy.keysSharedPress(press, taken.get(press) ?? "") : null);

    if (refusal) return `${name}: ${refusal}`;

    taken.set(press, name);
  }

  return null;
};

/** MC40, MC41: read the Daemon's Config and apply it at once; keys the App refuses leave the last good keys, which the caller shows. */
export const applyConfig = async (app: AppSeam, refused: (file: string, cause: string) => void): Promise<void> => {
  const state = await app.rpc("config.read", null).catch(() => null);

  if (!state) return;

  setFileLook(state.look);

  const cause = refuseKeys(state.keys);

  if (cause) refused("keys.json", cause);
  else setFileKeys(state.keys);
};
