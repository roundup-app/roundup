import { confirmed } from "../app/receipt";
import type { Deletion as RailDeletion } from "@contracts/agent/Deletion";
import PQueue from "p-queue";
import { createSignal } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
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

  let first = true;
  let empty = false;

  // A retry reads first; an unreadable receipt after the apply is never the answer, the apply's own error is.
  const read = () => {
    const initial = first;
    first = false;

    // The first read of a fresh operation has nothing to ask, so the apply starts in the same tick.
    if (initial && !previous) return null;

    return app.rpc("todo.deletion", { operation }).then(value => {
      empty = value === null;

      return value;
    }, error => {
      empty = false;

      if (initial) throw error;

      return null;
    });
  };

  const result = confirmed(read, () => app.rpc("todo.delete", { operation, ids: chosen }), () => true).catch(error => {
    if (empty && outcomeOf(error) === "failed") holder.delete(identity);
    throw error;
  });

  holder.set(identity, { operation, state: "pending", result });

  return result.then(value => {
    holder.delete(identity);

    return value;
  }, error => {
    if (holder.has(identity)) holder.set(identity, { operation, state: "unknown" });
    throw error;
  });
}

type PadAsk = { name: string; incarnation: string; operation: string };

type PadRedo = { receipt: PadDeletion; operation: string; request: RedoDeleteParams | null };

type Stacked = ({ kind: "todos"; receipt: Deletion } | { kind: "pads"; receipts: PadDeletion[] } | { kind: "rail"; receipt: RailDeletion; name: string }) & { id: string; regions: string[] };

type Redo = ({ kind: "todos"; receipt: Deletion; operation: string } | { kind: "rail"; receipt: RailDeletion; name: string; operation: string } | { kind: "pads"; source: Extract<Stacked, { kind: "pads" }>; members: PadRedo[] }) & { regions: string[] };

/** U5170c: what a run of the history was asked to do; an unconfirmed one is retried only by the same ask. */
type Asked =
  | { kind: "todos"; ids: number[]; region: string }
  | { kind: "pads"; pads: PadAsk[]; region: string; receipts: PadDeletion[] }
  | { kind: "rail"; ids: string[]; name: string; project: string | null; operation: string; region: string }
  | { kind: "undo"; id: string }
  | { kind: "redo"; action: Redo };

type Work = { kind: "idle" } | { kind: "running"; asked: Asked } | { kind: "unconfirmed"; asked: Asked };

const idle: Work = { kind: "idle" };

const keyOf = (asked: Asked) => {
  switch (asked.kind) {
    case "todos": return JSON.stringify([asked.kind, asked.ids]);
    case "pads": return JSON.stringify([asked.kind, asked.pads.map(pad => pad.incarnation)]);
    case "rail": return JSON.stringify([asked.kind, asked.ids]);
    case "undo": return JSON.stringify([asked.kind, asked.id]);
    case "redo": return JSON.stringify([asked.kind, asked.action.kind === "pads" ? asked.action.source.id : asked.action.operation]);
  }
};

/** An undo is never retried as the same work: only the keyed changes and a redo are. */
const sameWork = (a: Asked, b: Asked) => a.kind !== "undo" && keyOf(a) === keyOf(b);

/** A pad read the Daemon answers `-32001` has no receipt yet. */
const readPad = (app: AppSeam, operation: string) => app.rpc("pad.getDeletion", { operation }).catch((error): null => {
  if (!(error instanceof RpcError) || error.code !== -32001) throw error;

  return null;
});

/** Project-owned receipts, never client snapshots. The current connection may change; the operation does not. */
export function createTodoUndo() {
  const [history, setHistory] = createStore<{ stack: Stacked[] }>({ stack: [] });
  const stack = () => history.stack;
  const push = (item: Stacked) => setHistory(produce(draft => { draft.stack.push(item); }));
  const drop = (id: string) => setHistory(produce(draft => { draft.stack.splice(draft.stack.findIndex(item => item.id === id), 1); }));

  /** U5991a: the Rail's drawing of an undo or redo, bound by the Project's Rail state; a call lifts it once the Rail holds the Daemon's result. */
  let railDrawing: ((direction: "undo" | "redo") => (kept: boolean) => Promise<void>) | null = null;

  const [redoes, setRedoes] = createSignal<Redo[]>([]);
  const [work, setWork] = createSignal<Work>(idle);
  const [failure, setFailure] = createSignal<{ kind: "delete" | "restore" | "blocked"; message: string } | null>(null);
  let connection: AppSeam | undefined;
  let forwarding: AppSeam | undefined;

  /** U5170b: an idle history starts anything; an unconfirmed one only starts the work it is waiting on. */
  const mayStart = (asked: Asked) => {
    const now = work();

    return now.kind === "idle" || now.kind === "unconfirmed" && sameWork(now.asked, asked);
  };

  /** A call waiting its turn counts: the history is busy from the call to the answer, with no gap between two calls. */
  const [queued, setQueued] = createSignal(0);
  const pending = () => work().kind === "running" || queued() > 0;
  /** The keyed work the Daemon may hold: unconfirmed, or a keyed delete in flight. */

  const unsettled = () => {
    const now = work();

    return now.kind === "unconfirmed" || now.kind === "running" && now.asked.kind !== "undo" && now.asked.kind !== "redo";
  };

  const asking = () => {
    const now = work();

    return now.kind === "idle" ? undefined : now.asked;
  };

  /** The unconfirmed ask of one kind, to retry. */
  const retained = <K extends Asked["kind"]>(kind: K) => {
    const now = work();

    // SAFETY: `asked.kind === kind` narrows the union to the member for K.
    return now.kind === "unconfirmed" && now.asked.kind === kind ? now.asked as Extract<Asked, { kind: K }> : null;
  };

  const actionName = (action: Stacked | Redo) => {
    if (action.kind === "rail") return `${copy.remove} ${action.name}`;

    const count = action.kind === "todos" ? action.receipt.deleted.length : "receipts" in action ? action.receipts.length : action.members.length;

    return copy.deleteAction(count, action.kind === "todos" ? copy.todo : copy.pad);
  };

  const clearRedoes = (region: string) => setRedoes(all => all.map(action => ({ ...action, regions: action.regions.filter(owner => owner !== region) })).filter(action => action.regions.length > 0));

  const unconfirmedName = () => {
    const now = work();

    if (now.kind !== "unconfirmed") return "";
    const asked = now.asked;

    switch (asked.kind) {
      case "redo": return actionName(asked.action);
      case "rail": return `${copy.remove} ${asked.name}`;
      case "pads": return asked.pads.map(pad => pad.name).join(", ");
      case "todos": return copy.deleting(asked.ids.map(id => `#${id}`).join(", "));
      case "undo": return "";
    }
  };

  /** U5170a: what blocks a delete, undo or redo, and what to do; set on the failure line so no gate returns silently. */
  const block = () => {
    const name = unconfirmedName();
    const message = work().kind === "running" ? copy.deleteBusy : name ? copy.deleteBlockedBy(name) : !connection || !forwarding ? copy.deleteNotConnected : copy.deleteBusy;
    setFailure({ kind: "blocked", message });

    return message;
  };

  /** U5991b: Rail removals, undos and redos run one after another in the order fired; none is refused for coming second. */
  const queue = new PQueue({ concurrency: 1 });
  // An idle queue starts the call in the same tick; a busy one starts it when the earlier calls have answered.

  const serial = <A extends unknown[], T>(run: (...args: A) => Promise<T>) => (...args: A): Promise<T> => {
    setQueued(queued() + 1);

    // The count drops in the tick the call settles, so a key on its failure line is not refused. SAFETY: no timeout is set, so `add` resolves with the task's result, never `void`.
    return queue.add(async () => {
      try { return await run(...args); } finally { setQueued(queued() - 1); }
    }) as Promise<T>;
  };

  const removeRailNow = async (ids: readonly string[], name: string, region = "") => {
    const selected = [...new Set(ids)].sort();
    const wanted: Asked = { kind: "rail", ids: selected, name, project: null, operation: crypto.randomUUID(), region };

    if (!connection || !mayStart(wanted)) {
      block();

      return false;
    }

    const retry = retained("rail");
    const app = connection;
    // SAFETY: `retained("rail")` returns only a rail Asked, and `wanted` is built as one.
    let asked = retry ?? wanted as Extract<Asked, { kind: "rail" }>;
    let after: Work = retry ? { kind: "unconfirmed", asked } : idle;
    setWork({ kind: "running", asked });
    setFailure(null);

    try {
      const project = asked.project ?? (await app.rpc("daemon.ping", null)).projectKey;
      asked = { ...asked, project };
      after = { kind: "unconfirmed", asked };
      const params = { project, operation: asked.operation };
      let refused = false;
      let sent = retry !== null;
      const chosen = asked;

      const receipt = await confirmed(
        () => sent ? app.rpc("rail.deletion", params) : null,
        () => (sent = true, chosen.ids.length === 1
          ? app.rpc("rail.remove", { id: chosen.ids[0]!, operation: chosen.operation })
          : app.rpc("rail.removeSelection", { ids: chosen.ids, operation: chosen.operation })
        ).catch(error => { refused = outcomeOf(error) === "failed"; throw error; }),
        () => true,
      ).catch(error => {
        if (refused) after = idle;
        throw error;
      });

      if (!receipt?.deletion) throw new Error(copy.todoRestoreUnknown);

      if (!receipt.deletion.restored) {
        push({ id: crypto.randomUUID(), kind: "rail", receipt: receipt.deletion, name: asked.name, regions: [asked.region] });
        clearRedoes(asked.region);
      }

      after = idle;

      return true;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure({ kind: "delete", message: error.message });

      return false;
    } finally { setWork(after); }
  };

  const removeRailSelection = serial(removeRailNow);

  /** The ids the Daemon deleted. */
  const removeReceipt = async (ids: number[], region: string): Promise<number[]> => {
    const wanted: Asked = { kind: "todos", ids: [...ids], region };

    if (!forwarding || !mayStart(wanted)) {
      block();

      return [];
    }

    // SAFETY: `retained("todos")` returns only a todos Asked, and `wanted` is built as one.
    const asked = retained("todos") ?? wanted as Extract<Asked, { kind: "todos" }>;
    const app = forwarding;
    let after: Work = { kind: "unconfirmed", asked };
    setWork({ kind: "running", asked });
    setFailure(null);

    try {
      const receipt = await deleteTodos(app, asked.ids);
      after = idle;

      if (receipt.state === "deleted" && receipt.deleted.length) {
        push({ id: crypto.randomUUID(), kind: "todos", receipt, regions: [asked.region] });
        clearRedoes(asked.region);
      }

      if (receipt.missing.length) {
        setFailure({ kind: "delete", message: copy.todoDeleteMissing });
      }

      return receipt.deleted;
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!calls.get(app)?.has(JSON.stringify([...new Set(asked.ids)].toSorted((a, b) => a - b)))) after = idle;
      setFailure({ kind: "delete", message: error.message });

      return [];
    } finally { setWork(after); }
  };

  const remove = async (ids: number[], region = ""): Promise<boolean> => (await removeReceipt(ids, region)).length > 0;

  const removePads = async (pads: readonly Pick<Pad, "name" | "incarnation">[], region = "") => {
    const wanted: Asked = { kind: "pads", pads: pads.map(pad => ({ name: pad.name, incarnation: pad.incarnation, operation: crypto.randomUUID() })), region, receipts: [] };

    if (!connection || !mayStart(wanted)) {
      const message = block();

      return pads.map(pad => ({ id: pad.incarnation, message }));
    }

    const kept = retained("pads");
    // SAFETY: `retained("pads")` returns only a pads Asked, and `wanted` is built as one.
    const asked = kept ?? wanted as Extract<Asked, { kind: "pads" }>;
    const app = connection;
    let after: Work = { kind: "unconfirmed", asked };
    setWork({ kind: "running", asked });
    setFailure(null);
    const failed: { id: string; message: string }[] = [];
    const unknown: PadAsk[] = [];
    const receipts = [...asked.receipts];

    try {
      for (const pad of asked.pads) {
        let applyError: unknown;
        let sent = kept !== null;

        try {
          const receipt = await confirmed(
            () => sent ? readPad(app, pad.operation) : null,
            () => (sent = true, app.rpc("pad.delete", { name: pad.name, expectedIncarnation: pad.incarnation, operation: pad.operation })).catch(error => { applyError = error; throw error; }),
            () => true,
          );

          if (!receipt.restored) receipts.push(receipt);
        } catch (error) {
          // A known refusal with no receipt is no pending delete, except on a retry, which stays unconfirmed.
          const refused = error === applyError && outcomeOf(error) === "failed";

          if (!refused || kept) unknown.push(pad);

          if (!(error instanceof Error)) throw error;
          failed.push({ id: pad.incarnation, message: error.message });
        }
      }

      after = unknown.length ? { kind: "unconfirmed", asked: { ...asked, pads: unknown, receipts } } : idle;

      if (!unknown.length && receipts.length) {
        push({ id: crypto.randomUUID(), kind: "pads", receipts, regions: [asked.region] });
        clearRedoes(asked.region);
      }

      setFailure(failed.length ? { kind: "delete", message: failed.map(item => item.message).join("; ") } : null);
    } finally { setWork(after); }

    return failed;
  };

  const undoNow = async (region?: string) => {
    const operation = stack().findLast(action => region === undefined || action.regions.includes(region));

    if (!operation) return;
    const wanted: Asked = { kind: "undo", id: operation.id };

    if (!connection || !mayStart(wanted)) {
      block();

      return;
    }

    const app = connection;
    setWork({ kind: "running", asked: wanted });
    setFailure(null);

    try {
      if (operation.kind === "rail") {
        const lift = railDrawing?.("undo");
        let kept = false;

        try {
          const { project, operation: key } = operation.receipt;
          const params = { project, operation: key };
          const restored = await confirmed(() => app.rpc("rail.deletion", params), () => app.rpc("rail.restore", params), result => !!result.deletion?.restored);

          if (!restored.deletion?.restored) throw new Error(copy.todoRestoreUnknown);
          setRedoes(all => [...all, { kind: "rail", receipt: restored.deletion!, name: operation.name, operation: crypto.randomUUID(), regions: [...operation.regions] }]);
          drop(operation.id);
          kept = true;
        } finally { await lift?.(kept); }

        return;
      }

      if (operation.kind === "pads") {
        const failed: PadDeletion[] = [];
        const causes: string[] = [];
        const members: PadRedo[] = [];

        for (const receipt of operation.receipts) {
          try {
            const restored = await confirmed(() => readPad(app, receipt.operation), () => app.rpc("pad.restore", { project: receipt.project, operation: receipt.operation }), result => result.restored);

            if (!restored.restored) throw new Error(copy.todoRestoreUnknown);
            members.push({ receipt: restored, operation: crypto.randomUUID(), request: null });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            failed.push(unwrap(receipt));
            causes.push(`${receipt.pad.name}: ${error.message}`);
          }
        }

        // SAFETY: the stacked action was found by kind "pads" above.
        const source = unwrap(operation) as Extract<Stacked, { kind: "pads" }>;

        if (members.length) setRedoes(all => {
          const previous = all.find(item => item.kind === "pads" && item.source.id === source.id);

          return previous?.kind === "pads"
            ? all.map(item => item === previous ? { ...previous, members: [...previous.members, ...members] } : item)
            : [...all, { kind: "pads", source, members, regions: [...operation.regions] }];
        });

        if (failed.length) setHistory(produce(draft => {
          const at = draft.stack.find(item => item.id === source.id);

          if (at?.kind === "pads") at.receipts = failed;
        }));
        else drop(source.id);
        setFailure(causes.length ? { kind: "restore", message: causes.join("; ") } : null);

        return;
      }

      const receipt = operation.receipt;
      // Read first: an earlier lost restore acknowledgement may already have consumed it.
      const restored = await confirmed(() => app.rpc("todo.deletion", { operation: receipt.operation }), () => app.rpc("todo.restore", { operation: receipt.operation }), result => result.state === "restored");

      if (restored.state !== "restored") throw new Error(copy.todoRestoreUnknown);
      setRedoes(all => [...all, { kind: "todos", receipt: restored, operation: crypto.randomUUID(), regions: [...operation.regions] }]);
      drop(operation.id);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure({ kind: "restore", message: error.message });
    } finally { setWork(idle); }
  };

  // The request keys live with the retained action: an unknown reply retries that exact attempt.
  const redoNow = async (region?: string) => {
    const action = redoes().findLast(item => region === undefined || item.regions.includes(region));

    if (!action) return;
    const wanted: Asked = { kind: "redo", action };

    if (!connection || !mayStart(wanted)) {
      block();

      return;
    }

    const app = connection;
    let after: Work = idle;
    setWork({ kind: "running", asked: wanted });
    setFailure(null);

    try {
      if (action.kind === "todos") {
        const restoration = action.receipt.restoration;

        if (!restoration) throw new Error(copy.todoRestoreUnknown);
        const receipt = await confirmed(() => app.rpc("todo.deletion", { operation: action.operation }), () => app.rpc("todo.redo", { source: action.receipt.operation, restoration, operation: action.operation }), () => true);

        if (receipt.state !== "deleted") throw new Error(copy.todoRestoreUnknown);
        push({ id: crypto.randomUUID(), kind: "todos", receipt, regions: [...action.regions] });
      } else if (action.kind === "rail") {
        const lift = railDrawing?.("redo");
        let kept = false;

        try {
          const restoration = action.receipt.restoration;
          const params = { project: action.receipt.project, operation: action.operation };

          if (!restoration) throw new Error(copy.todoRestoreUnknown);
          const receipt = await confirmed(() => app.rpc("rail.deletion", params), () => app.rpc("rail.redo", { ...params, source: action.receipt.operation, restoration }), () => true);

          if (!receipt.deletion || receipt.deletion.restored) throw new Error(copy.todoRestoreUnknown);
          push({ id: crypto.randomUUID(), kind: "rail", receipt: receipt.deletion, name: action.name, regions: [...action.regions] });
          kept = true;
        } finally { await lift?.(kept); }
      } else {
        const failed: PadRedo[] = [];
        const causes: { error: Error; message: string }[] = [];
        const receipts: PadDeletion[] = [];

        for (const member of action.members) {
          let applyError: unknown;

          const requested = async () => {
            if (!member.request) {
              const current = await app.rpc("pad.read", { name: member.receipt.pad.name });
              member.request = { project: member.receipt.project, restoredOperation: member.receipt.operation, operation: member.operation, expectedIncarnation: member.receipt.pad.incarnation, expectedRevision: current.revision, expectedHome: current.home };
            }

            return member.request;
          };

          try {
            const receipt = await confirmed(
              () => readPad(app, member.operation),
              async () => app.rpc("pad.redoDelete", await requested()).catch(error => { applyError = error; throw error; }),
              () => true,
            );

            if (receipt.restored) throw new Error(copy.todoRestoreUnknown);
            receipts.push(receipt);
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            // A known refusal the Daemon holds no receipt for may be asked again from a fresh request.

            if (error === applyError && outcomeOf(error) === "failed") member.request = null;
            failed.push(member);
            causes.push({ error, message: `${member.receipt.pad.name}: ${error.message}` });
          }
        }

        if (receipts.length) setHistory(produce(draft => {
          const at = draft.stack.find(item => item.id === action.source.id);

          if (at?.kind === "pads") {
            at.regions = [...action.regions];
            at.receipts.push(...receipts);
          } else draft.stack.push({ ...action.source, regions: [...action.regions], receipts: [...receipts] });
        }));

        action.members = failed;

        if (causes.length) {
          if (causes.some(cause => outcomeOf(cause.error) === "unknown")) after = { kind: "unconfirmed", asked: wanted };
          setFailure({ kind: "restore", message: causes.map(cause => cause.message).join("; ") });

          return;
        }
      }

      setRedoes(all => all.filter(item => item !== action));
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (outcomeOf(error) !== "failed") after = { kind: "unconfirmed", asked: wanted };
      setFailure({ kind: "restore", message: error.message });
    } finally { setWork(after); }
  };

  const undo = serial(undoNow);
  const redo = serial(redoNow);

  const available = (region?: string) => stack().some(action => region === undefined || action.regions.includes(region)) && !unsettled();
  const redoAvailable = (region?: string) => redoes().some(action => region === undefined || action.regions.includes(region)) && !pending() && (!unsettled() || retained("redo") !== null);

  return {
    reconnect(app: AppSeam) {
      connection = app;
      forwarding ??= { ...app, rpc: (method, params) => connection!.rpc(method, params) };
    },
    remove, removePads, removeRailSelection,
    removeRail: (id: string, name: string, region = "") => removeRailSelection([id], name, region),
    removeTodos: async (ids: readonly number[], region = "") => {
      const deleted = await removeReceipt([...ids], region);

      return ids.flatMap(id => deleted.includes(id) ? [] : [{ id, message: failure()?.message ?? copy.todoDeleteMissing }]);
    },
    undo, redo, pending,
    // A surviving focus destination shares the receipt, never a second history entry.
    handoff: (from: string, to: string) => {
      const operation = stack().findLast(action => action.regions.includes(from));

      if (!operation || operation.regions.includes(to)) return;
      setHistory(produce(draft => { draft.stack.find(item => item.id === operation.id)?.regions.push(to); }));
    },
    failure: () => failure()?.message ?? null,
    blocked: () => failure()?.kind === "blocked",
    // U5170b: Dismiss drops an unconfirmed state from the blocking set and says the Daemon may still hold it.
    dismiss: () => {
      const now = work();

      if (now.kind !== "unconfirmed") {
        setFailure(null);

        return;
      }

      const name = unconfirmedName();

      if (now.asked.kind === "todos") calls.get(forwarding!)?.delete(JSON.stringify([...new Set(now.asked.ids)].toSorted((a, b) => a - b)));
      setWork(idle);
      setFailure({ kind: "blocked", message: copy.deleteStaysUnconfirmed(name) });
    },
    feedbackFailure: () => {
      const problem = failure();

      return problem && (problem.kind !== "delete" || unsettled()) ? problem.message : null;
    },
    undoLabel: (region?: string) => {
      const action = !pending() && available(region) ? stack().findLast(item => region === undefined || item.regions.includes(region)) : undefined;

      return action ? copy.undoAction(actionName(action)) : copy.todoUndo;
    },
    redoLabel: (region?: string) => {
      const action = redoAvailable(region) ? redoes().findLast(item => region === undefined || item.regions.includes(region)) : undefined;

      return action ? copy.redoAction(actionName(action)) : copy.redo;
    },
    available, redoAvailable,
    bindRail: (drawing: NonNullable<typeof railDrawing>) => { railDrawing = drawing; },
    retryDelete: () => {
      const now = work();

      if (now.kind !== "unconfirmed") return Promise.resolve(false);
      const asked = now.asked;

      switch (asked.kind) {
        case "redo": return redo(asked.action.regions[0]);
        case "rail": return removeRailSelection(asked.ids, asked.name);
        case "pads": return removePads(asked.pads);
        case "todos": return remove(asked.ids);
        case "undo": return Promise.resolve(false);
      }
    },
    uncertain: unsettled,
    ids: () => {
      const asked = asking();

      return asked?.kind === "todos" ? asked.ids : [];
    },
  };
}
