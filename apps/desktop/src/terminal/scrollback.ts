import * as v from "valibot";
import { storageSchema, storedValue } from "../state/storage";

const grid = v.pipe(v.number(), v.integer(), v.minValue(1));

const schema = storageSchema("roundup:terminal-scrollback", v.strictObject({
  cols: grid,
  rows: grid,
  after: v.pipe(v.number(), v.integer(), v.minValue(0)),
  data: v.pipe(v.string(), v.maxLength(10 * 1024 * 1024)),
}));

/** Output belongs to one original Terminal, never a later program reusing its id. */
export const scrollbackStorage = (project: string, incarnation: string) =>
  storedValue(`roundup:terminal-scrollback:${project}:${incarnation}`, schema);


import type { ConnectedProject } from "../state/connectedProject";
import type { Emulator } from "./emulator";
import { fromBase64 } from "./base64";

/** A damaged or externally replaced record remains recoverable through the existing storage owner. */
export const retainScrollback = (project: string, incarnation: string, output: v.InferOutput<typeof schema>, failed: (cause: string) => void): void => {
  const storage = scrollbackStorage(project, incarnation);
  const saved = storage.restore();

  if (saved.status === "failed") { failed(saved.cause);

 return; }

  void storage.write(output, saved.status === "restored" ? saved.value : null);
};

/** Only a contiguous authoritative handoff licenses replay of locally retained output. */
export const restoreScrollback = async (
  connected: ConnectedProject, id: string, incarnation: string | undefined, emulator: Emulator,
  complete: boolean, after: number | undefined, current: () => boolean, failed: (cause: string) => void,
): Promise<number | null> => {
  if (!incarnation || !current()) return null;
  const saved = !complete && emulator.serialize ? scrollbackStorage(connected.project.path, incarnation).restore() : null;

  if (saved?.status === "failed") failed(saved.cause);
  const local = saved?.status === "restored" ? saved.value : null;
  after ??= local?.after;

  if ((!complete && !local) || after === undefined) return null;

  const replay = await connected.app.rpc("terminal.catchUp", { id, incarnation, after }).catch(thrown => {
    if (!(thrown instanceof Error)) throw thrown;

    return null;
  });

  if (!current() || replay?.kind !== "contiguous") return null;

  if (local) {
    emulator.setSize(local);
    emulator.write(new TextEncoder().encode(local.data));
  }

  emulator.write(fromBase64(replay.data));

  return replay.after;
};
