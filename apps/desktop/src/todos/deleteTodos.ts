import { createSignal } from "solid-js";
import { copy } from "../copy";
import type { Deletion } from "@contracts/todo/Deletion";
import { outcomeOf, type AppSeam } from "../app/seam";

type DeletionCall = { operation: string; state: "pending"; result: Promise<Deletion> } | { operation: string; state: "unknown" };

const calls = new WeakMap<AppSeam, Map<string, DeletionCall>>();

/** Keeps an uncertain operation's identity with its original Project connection and chosen ids. */
export function deleteTodos(app: AppSeam, ids: number[]): Promise<Deletion> {
  const chosen = [...new Set(ids)].toSorted((a, b) => a - b);
  const identity = JSON.stringify(chosen);
  let project = calls.get(app);

  if (!project) { project = new Map(); calls.set(app, project); }

  const previous = project.get(identity);

  if (previous?.state === "pending") return previous.result;
  const operation = previous?.operation ?? crypto.randomUUID();
  const holder = project;

  const result = (async () => {
    try {
      if (previous) {
        const retained = await app.rpc("todo.deletion", { operation });

        if (retained) return retained;
      }

      return await app.rpc("todo.delete", { operation, ids: chosen });
    } catch (error) {
      // Even a post-commit server error cannot override an authoritative receipt.
      const observed = await app.rpc("todo.deletion", { operation }).then(
        value => ({ known: true as const, value }),
        () => ({ known: false as const }),
      );

      if (observed.known && observed.value) return observed.value;

      if (observed.known && outcomeOf(error) === "failed") holder.delete(identity);
      throw error;
    }
  })();

  holder.set(identity, { operation, state: "pending", result });

  return result.then(value => {
    holder.delete(identity);

    return value;
  }, error => {
    if (holder.has(identity)) holder.set(identity, { operation, state: "unknown" });
    throw error;
  });
}

/** Project-owned receipts, never client snapshots. The current connection may change; the operation does not. */
export function createTodoUndo() {
  const [stack, setStack] = createSignal<Deletion[]>([]);
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [visible, setVisible] = createSignal(false);
  let connection: AppSeam | undefined;
  let forwarding: AppSeam | undefined;
  const [uncertain, setUncertain] = createSignal<number[]>();

  const remove = async (ids: number[]): Promise<boolean> => {
    if (pending() || !forwarding) return false;

    if (uncertain() && JSON.stringify(uncertain()) !== JSON.stringify(ids)) return false;
    const chosen = uncertain() ?? [...ids];
    setUncertain(chosen);
    setPending(true);
    setFailure(null);

    try {
      const receipt = await deleteTodos(forwarding, chosen);
      setUncertain(undefined);

      if (receipt.state === "deleted" && receipt.deleted.length) {
        setStack(all => [...all, receipt]);
        setVisible(true);
      }

      if (receipt.missing.length) {
        setFailure(copy.todoDeleteMissing);
        setVisible(true);
      }

      return receipt.deleted.length > 0;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const identity = JSON.stringify([...new Set(chosen)].toSorted((a, b) => a - b));

      if (!calls.get(forwarding)?.has(identity)) setUncertain(undefined);
      setFailure(error.message);
      setVisible(true);

      return false;
    } finally { setPending(false); }
  };

  const undo = async () => {
    const receipt = stack().at(-1);

    if (!receipt || pending() || !connection || uncertain()) return;
    const app = connection;
    setPending(true);
    setFailure(null);
    setVisible(true);

    try {
      // Read first: an earlier lost restore acknowledgement may already have consumed it.
      let restored = await app.rpc("todo.deletion", { operation: receipt.operation });

      if (restored?.state !== "restored") {
        try { restored = await app.rpc("todo.restore", { operation: receipt.operation }); }
        catch (error) {
          const retained = await app.rpc("todo.deletion", { operation: receipt.operation });

          if (retained?.state !== "restored") throw error;
          restored = retained;
        }
      }

      if (restored.state !== "restored") throw new Error(copy.todoRestoreUnknown);
      setStack(all => all.filter(item => item.operation !== receipt.operation));
      setVisible(stack().length > 0);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally { setPending(false); }
  };

  return {
    reconnect(app: AppSeam) {
      connection = app;
      forwarding ??= { ...app, rpc: (method, params) => connection!.rpc(method, params) };
    },
    remove, undo, pending, failure, visible,
    available: () => stack().length > 0 && !uncertain(),
    retryDelete: () => uncertain() ? remove(uncertain()!) : Promise.resolve(false),
    uncertain: () => !!uncertain(),
    ids: () => uncertain() ?? [],
    dismiss: () => setVisible(false),
  };
}
