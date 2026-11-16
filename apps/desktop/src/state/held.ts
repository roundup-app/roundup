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
  // `rows()` lags a write until the next flush, so two Events in one turn would each start from the same list; `latest` is read-your-writes.
  let latest = storage.read() ?? [];
  const [rows, setRows] = createSignal(latest);

  const save = (next: v.InferOutput<typeof heldSchema>) => {
    latest = next;
    setRows(next);
    void storage.write(next).then(cause => { if (cause) failure(cause); });
  };

  return {
    rows,
    retain: (row: v.InferOutput<typeof rowSchema>) => save([row, ...latest]),
    acknowledge: (agent: string) => { if (latest.some(row => row.agent === agent)) save(latest.filter(row => row.agent !== agent)); },
  };
};
