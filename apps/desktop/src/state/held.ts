import { createSignal } from "solid-js";
import * as v from "valibot";
import { storageSchema, storedValue } from "./storage";

const rowSchema = v.object({
  agent: v.string(), name: v.string(), kind: v.picklist(["working", "idle", "blocked", "needs-you", "error", "done"]),
  line: v.string(), at: v.number(),
});

const heldSchema = storageSchema("roundup:held", v.array(rowSchema));

/** U5501: immutable event snapshots, scoped to the original Project and removed only on an acknowledged open. */
export const createHeld = (path: string, failure: (cause: string) => void) => {
  const storage = storedValue(`roundup:held:${path}`, heldSchema);
  const [rows, setRows] = createSignal(storage.read() ?? []);

  const save = (next: v.InferOutput<typeof heldSchema>) => {
    setRows(next);
    void storage.write(next).then(cause => { if (cause) failure(cause); });
  };

  return {
    rows,
    retain: (row: v.InferOutput<typeof rowSchema>) => save([row, ...rows()]),
    acknowledge: (agent: string) => { if (rows().some(row => row.agent === agent)) save(rows().filter(row => row.agent !== agent)); },
  };
};
