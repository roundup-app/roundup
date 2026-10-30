import type { Deletion as RailDeletion } from "@contracts/agent/Deletion";
import { createSignal } from "solid-js";
import { copy } from "./copy";
import type { Deletion as PadDeletion } from "@contracts/pad/Deletion";
import type { RedoDeleteParams } from "@contracts/pad/RedoDeleteParams";
import type { Pad } from "@contracts/pad/Pad";
import { RpcError } from "../app/seam";
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
  const [stack, setStack] = createSignal<(({ kind: "todos"; receipt: Deletion } | { kind: "pads"; receipts: PadDeletion[] } | { kind: "rail"; receipt: RailDeletion; name: string }) & { regions: string[] })[]>([]);

  type Operation = ReturnType<typeof stack>[number];

  type PadRedo = { receipt: PadDeletion; operation: string; request: RedoDeleteParams | null };

  type Redo = ({ kind: "todos"; receipt: Deletion; operation: string } | { kind: "rail"; receipt: RailDeletion; name: string; operation: string } | { kind: "pads"; source: Extract<Operation, { kind: "pads" }>; members: PadRedo[] }) & { state: "ready" | "unknown"; regions: string[] };

  const [redoes, setRedoes] = createSignal<Redo[]>([]);
  const redoUnknown = () => redoes().some(action => action.state === "unknown");
  const clearRedoes = (region: string) => setRedoes(all => all.map(action => ({ ...action, regions: action.regions.filter(owner => owner !== region) })).filter(action => action.regions.length > 0));
  const [pending, setPending] = createSignal(false);
  const [failure, setFailure] = createSignal<{ kind: "delete" | "restore"; message: string } | null>(null);
  const [visible, setVisible] = createSignal(false);
  let connection: AppSeam | undefined;
  let forwarding: AppSeam | undefined;
  const [uncertain, setUncertain] = createSignal<number[]>();

  let deleted: number[] = [];
  let todoRegion = "";
  let padRegion = "";
  const [padPending, setPadPending] = createSignal<{ name: string; incarnation: string; operation: string }[]>([]);
  let padReceipts: PadDeletion[] = [];
  const [railPending, setRailPending] = createSignal<{ id: string; name: string; project: string; operation: string; region: string }>();

  const removeRail = async (id: string, name: string, region = "") => {
    if (pending() || redoUnknown() || !connection || uncertain() || padPending().length) return false;

    if (railPending() && railPending()!.id !== id) return false;
    const app = connection;
    setPending(true);
    setFailure(null);

    try {
      const chosen = railPending() ?? { id, name, project: (await app.rpc("daemon.ping", null)).projectKey, operation: crypto.randomUUID(), region };
      const retry = !!railPending();
      setRailPending(chosen);
      let receipt = retry ? await app.rpc("rail.deletion", { project: chosen.project, operation: chosen.operation }) : null;

      if (!receipt) {
        try { receipt = await app.rpc("rail.remove", { id: chosen.id, operation: chosen.operation }); }
        catch (error) {
          const observed = await app.rpc("rail.deletion", { project: chosen.project, operation: chosen.operation });

          if (observed) receipt = observed;
          else {
            if (outcomeOf(error) === "failed") setRailPending(undefined);
            throw error;
          }
        }
      }

      if (!receipt?.deletion) throw new Error(copy.todoRestoreUnknown);

      if (!receipt.deletion.restored) {
        setStack(all => [...all, { kind: "rail", receipt: receipt.deletion!, name: chosen.name, regions: [chosen.region] }]);
        clearRedoes(chosen.region);
      }

      setRailPending(undefined);
      setVisible(true);

      return true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure({ kind: "delete", message: error.message });
      setVisible(true);

      return false;
    } finally { setPending(false); }
  };

  const remove = async (ids: number[], region = ""): Promise<boolean> => {
    if (pending() || redoUnknown() || !forwarding || padPending().length || railPending()) return false;
    deleted = [];

    if (uncertain() && JSON.stringify(uncertain()) !== JSON.stringify(ids)) return false;

    if (!uncertain()) todoRegion = region;
    const chosen = uncertain() ?? [...ids];
    setUncertain(chosen);
    setPending(true);
    setFailure(null);

    try {
      const receipt = await deleteTodos(forwarding, chosen);
      setUncertain(undefined);
      deleted = receipt.deleted;

      if (receipt.state === "deleted" && receipt.deleted.length) {
        setStack(all => [...all, { kind: "todos", receipt, regions: [todoRegion] }]);
        clearRedoes(todoRegion);
        setVisible(true);
      }

      if (receipt.missing.length) {
        setFailure({ kind: "delete", message: copy.todoDeleteMissing });
        setVisible(true);
      }

      return receipt.deleted.length > 0;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const identity = JSON.stringify([...new Set(chosen)].toSorted((a, b) => a - b));

      if (!calls.get(forwarding)?.has(identity)) setUncertain(undefined);
      setFailure({ kind: "delete", message: error.message });
      setVisible(true);

      return false;
    } finally { setPending(false); }
  };

  const removePads = async (pads: readonly Pick<Pad, "name" | "incarnation">[], region = "") => {
    if (pending() || redoUnknown() || !connection || uncertain() || railPending()) return pads.map(pad => ({ id: pad.incarnation, message: failure()?.message ?? copy.deletePending }));

    if (padPending().length && JSON.stringify(padPending().map(pad => pad.incarnation)) !== JSON.stringify(pads.map(pad => pad.incarnation))) return pads.map(pad => ({ id: pad.incarnation, message: copy.deleteUnconfirmed }));
    const app = connection;
    const retry = padPending().length > 0;

    if (!retry) padRegion = region;
    const chosen = retry ? padPending() : pads.map(pad => ({ ...pad, operation: crypto.randomUUID() }));
    setPadPending(chosen);
    setPending(true);
    setFailure(null);
    const failed: { id: string; message: string }[] = [];
    const unknown: typeof chosen = [];

    for (const pad of chosen) {
      try {
        let receipt: PadDeletion | undefined;

        if (retry) {
          try { receipt = await app.rpc("pad.getDeletion", { operation: pad.operation }); }
          catch (error) { if (!(error instanceof RpcError) || error.code !== -32001) throw error; }
        }

        if (!receipt) {
          try { receipt = await app.rpc("pad.delete", { name: pad.name, expectedIncarnation: pad.incarnation, operation: pad.operation }); }
          catch (error) {
            try { receipt = await app.rpc("pad.getDeletion", { operation: pad.operation }); }
            catch (readError) {
              if (!(readError instanceof RpcError) || readError.code !== -32001 || outcomeOf(error) !== "failed") unknown.push(pad);
              throw error;
            }
          }
        }

        if (!receipt.restored) padReceipts.push(receipt);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        if (retry && !unknown.some(item => item.operation === pad.operation)) unknown.push(pad);
        failed.push({ id: pad.incarnation, message: error.message });
      }
    }

    setPadPending(unknown);

    if (!unknown.length && padReceipts.length) {
      setStack(all => [...all, { kind: "pads", receipts: padReceipts, regions: [padRegion] }]);
      clearRedoes(padRegion);
      padReceipts = [];
    }

    setFailure(failed.length ? { kind: "delete", message: failed.map(item => item.message).join("; ") } : null);
    setVisible(true);
    setPending(false);

    return failed;
  };

  const undo = async (region?: string) => {
    const operation = stack().findLast(action => region === undefined || action.regions.includes(region));

    if (!operation || pending() || redoUnknown() || !connection || uncertain() || padPending().length || railPending()) return;
    const app = connection;
    setPending(true);
    setFailure(null);
    setVisible(true);

    try {
      if (operation.kind === "rail") {
        const { project, operation: key } = operation.receipt;
        const params = { project, operation: key };
        let restored = await app.rpc("rail.deletion", params);

        if (!restored?.deletion?.restored) {
          try { restored = await app.rpc("rail.restore", params); }
          catch (error) {
            const retained = await app.rpc("rail.deletion", params);

            if (!retained?.deletion?.restored) throw error;
            restored = retained;
          }
        }

        if (!restored.deletion?.restored) throw new Error(copy.todoRestoreUnknown);
        setRedoes(all => [...all, { kind: "rail", receipt: restored.deletion!, name: operation.name, operation: crypto.randomUUID(), state: "ready", regions: operation.regions }]);
        setStack(all => all.filter(item => item !== operation));
        setVisible(stack().length > 0);

        return;
      }

      if (operation.kind === "pads") {
        const failed: PadDeletion[] = [];
        const causes: string[] = [];
        const members: PadRedo[] = [];

        for (const receipt of operation.receipts) {
          try {
            let restored = await app.rpc("pad.getDeletion", { operation: receipt.operation });

            if (!restored.restored) {
              try { restored = await app.rpc("pad.restore", { project: receipt.project, operation: receipt.operation }); }
              catch (error) {
                const retained = await app.rpc("pad.getDeletion", { operation: receipt.operation });

                if (!retained.restored) throw error;
                restored = retained;
              }
            }

            if (!restored.restored) throw new Error(copy.todoRestoreUnknown);
            members.push({ receipt: restored, operation: crypto.randomUUID(), request: null });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            failed.push(receipt);
            causes.push(`${receipt.pad.name}: ${error.message}`);
          }
        }

        if (members.length) setRedoes(all => {
          const previous = all.find(item => item.kind === "pads" && item.source === operation);

          return previous?.kind === "pads"
            ? all.map(item => item === previous ? { ...previous, members: [...previous.members, ...members] } : item)
            : [...all, { kind: "pads", source: operation, members, state: "ready", regions: operation.regions }];
        });
        operation.receipts = failed;
        setStack(all => failed.length ? [...all] : all.filter(item => item !== operation));
        setFailure(causes.length ? { kind: "restore", message: causes.join("; ") } : null);
        setVisible(failed.length > 0 || stack().length > 0);

        return;
      }

      const receipt = operation.receipt;
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
      setRedoes(all => [...all, { kind: "todos", receipt: restored, operation: crypto.randomUUID(), state: "ready", regions: operation.regions }]);
      setStack(all => all.filter(item => item !== operation));
      setVisible(stack().length > 0);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure({ kind: "restore", message: error.message });
    } finally { setPending(false); }
  };

  // The request keys live with the retained action: an unknown reply retries that exact attempt.
  const redo = async (region?: string) => {
    const action = redoes().findLast(item => region === undefined || item.regions.includes(region));

    if (!action || pending() || !connection || uncertain() || padPending().length || railPending()) return;
    const app = connection;
    setPending(true);
    setFailure(null);

    try {
      if (action.kind === "todos") {
        const restoration = action.receipt.restoration;

        if (!restoration) throw new Error(copy.todoRestoreUnknown);
        let receipt = await app.rpc("todo.deletion", { operation: action.operation });

        if (!receipt) {
          try { receipt = await app.rpc("todo.redo", { source: action.receipt.operation, restoration, operation: action.operation }); }
          catch (error) {
            receipt = await app.rpc("todo.deletion", { operation: action.operation });

            if (!receipt) throw error;
          }
        }

        if (receipt.state !== "deleted") throw new Error(copy.todoRestoreUnknown);
        setStack(all => [...all, { kind: "todos", receipt, regions: action.regions }]);
      } else if (action.kind === "rail") {
        const restoration = action.receipt.restoration;
        const params = { project: action.receipt.project, operation: action.operation };

        if (!restoration) throw new Error(copy.todoRestoreUnknown);
        let receipt = await app.rpc("rail.deletion", params);

        if (!receipt) {
          try { receipt = await app.rpc("rail.redo", { ...params, source: action.receipt.operation, restoration }); }
          catch (error) {
            receipt = await app.rpc("rail.deletion", params);

            if (!receipt) throw error;
          }
        }

        if (!receipt.deletion || receipt.deletion.restored) throw new Error(copy.todoRestoreUnknown);
        setStack(all => [...all, { kind: "rail", receipt: receipt.deletion!, name: action.name, regions: action.regions }]);
      } else {
        const failed: PadRedo[] = [];
        const causes: Error[] = [];
        const messages: string[] = [];
        const receipts: PadDeletion[] = [];

        for (const member of action.members) {
          try {
            let receipt: PadDeletion | undefined;

            try { receipt = await app.rpc("pad.getDeletion", { operation: member.operation }); }
            catch (error) { if (!(error instanceof RpcError) || error.code !== -32001) throw error; }

            if (!receipt) {
              if (!member.request) {
                const current = await app.rpc("pad.read", { name: member.receipt.pad.name });
                member.request = { project: member.receipt.project, restoredOperation: member.receipt.operation, operation: member.operation, expectedIncarnation: member.receipt.pad.incarnation, expectedRevision: current.revision, expectedHome: current.home };
              }

              try { receipt = await app.rpc("pad.redoDelete", member.request); }
              catch (error) {
                try { receipt = await app.rpc("pad.getDeletion", { operation: member.operation }); }
                catch (readError) {
                  if (readError instanceof RpcError && readError.code === -32001 && outcomeOf(error) === "failed") member.request = null;
                  throw readError instanceof RpcError && readError.code === -32001 ? error : readError;
                }
              }
            }

            if (receipt.restored) throw new Error(copy.todoRestoreUnknown);
            receipts.push(receipt);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            failed.push(member);
            causes.push(error);
            messages.push(`${member.receipt.pad.name}: ${error.message}`);
          }
        }

        if (receipts.length) {
          action.source.regions = action.regions;
          action.source.receipts.push(...receipts);
          setStack(all => all.includes(action.source) ? [...all] : [...all, action.source]);
        }

        action.members = failed;

        if (causes.length) {
          const unknown = causes.find(error => outcomeOf(error) === "unknown");
          setRedoes(all => all.map(item => item === action ? { ...action, state: unknown ? "unknown" : "ready" } : item));
          setFailure({ kind: "restore", message: messages.join("; ") });
          setVisible(true);

          return;
        }
      }

      setRedoes(all => all.filter(item => item !== action));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setRedoes(all => all.map(item => item === action ? { ...item, state: outcomeOf(error) === "failed" ? "ready" : "unknown" } : item));
      setFailure({ kind: "restore", message: error.message });
      setVisible(true);
    } finally { setPending(false); }
  };

  return {
    reconnect(app: AppSeam) {
      connection = app;
      forwarding ??= { ...app, rpc: (method, params) => connection!.rpc(method, params) };
    },
    remove, removePads, removeRail,
    removeTodos: async (ids: readonly number[], region = "") => {
      await remove([...ids], region);

      return ids.flatMap(id => deleted.includes(id) ? [] : [{ id, message: failure()?.message ?? copy.todoDeleteMissing }]);
    },
    undo, redo, pending, visible,
    // A surviving focus destination shares the receipt, never a second history entry.
    handoff: (from: string, to: string) => {
      const operation = stack().findLast(action => action.regions.includes(from));

      if (!operation || operation.regions.includes(to)) return;
      operation.regions.push(to);
      setStack(all => [...all]);
    },
    failure: () => failure()?.message ?? null,
    feedback: () => {
      const operation = stack().at(-1);

      if (operation?.kind === "rail") return copy.railDeletedFeedback(operation.name);

      return operation ? copy.todoDeletedFeedback(operation.kind === "todos" ? operation.receipt.deleted.length : operation.receipts.length, operation.kind === "todos" ? copy.todo : copy.pad) : null;
    },
    feedbackFailure: () => {
      const problem = failure();

      return problem && (problem.kind === "restore" || uncertain() || padPending().length || railPending()) ? problem.message : null;
    },
    available: (region?: string) => stack().some(action => region === undefined || action.regions.includes(region)) && !redoUnknown() && !uncertain() && !padPending().length && !railPending(),
    redoAvailable: (region?: string) => redoes().some(action => region === undefined || action.regions.includes(region)) && !pending() && !uncertain() && !padPending().length && !railPending(),
    retryDelete: () => redoUnknown() ? redo(redoes().findLast(action => action.state === "unknown")!.regions[0]) : railPending() ? removeRail(railPending()!.id, railPending()!.name) : padPending().length ? removePads(padPending()) : uncertain() ? remove(uncertain()!) : Promise.resolve(false),
    uncertain: () => redoUnknown() || !!uncertain() || padPending().length > 0 || !!railPending(),
    ids: () => uncertain() ?? [],
    dismiss: () => setVisible(false),
  };
}
