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
