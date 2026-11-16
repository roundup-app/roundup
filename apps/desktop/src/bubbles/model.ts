import { createMemo, createSignal } from "solid-js";
import { captureFocus } from "../keys/focus";
import type { placesStorage, Place, Rect } from "./places";

/** Where a Terminal opening mounts its screen: the bubble's host and whether the bubble has settled. */
export type Arrival = { host: HTMLElement; settled: () => boolean };

/** One Terminal opens at a time: its key, the selection it began under, the controller that cancels it, and where its bubble arrives. */
type Opening =
  | { kind: "idle" }
  | { kind: "opening"; key: string; selection: string | null; controller: AbortController; arrive: (arrival: Arrival) => void };

const IDLE: Opening = { kind: "idle" };

const sameRect = (a: Rect | undefined, b: Rect | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Two places match when every placed field does. */
const samePlace = (a: Place, b: Place): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.min === b.min && a.name === b.name && sameRect(a.restore, b.restore);

export const samePlaces = (a: Record<string, Place>, b: Record<string, Place>): boolean => {
  const entries = Object.entries(a);

  return entries.length === Object.keys(b).length && entries.every(([id, place]) => {
    const other = b[id];

    return other !== undefined && samePlace(place, other);
  });
};

/** The bubbles' state: their places and where they persist, the one Terminal opening, the keys it reserves and the bubble that wants focus. */
export const createBubblesModel = (store: ReturnType<typeof placesStorage>, writable: () => boolean) => {
  // Reads lag writes until the next flush. `latest` is what the last write set, so a handler that writes and reads in one turn (a Pull's frame, then the focus that ends it) builds on it.
  let latest = store.read();
  const [shownPlaces, showPlaces] = createSignal<Record<string, Place>>(latest);

  const places = (): Record<string, Place> => {
    shownPlaces();

    return latest;
  };

  const setPlaces = (next: Record<string, Place>): void => {
    latest = next;
    showPlaces(next);
  };

  /** Writes `next` to session storage unless the Daemon has exited; the failure text, else null. */
  const persist = (next: Record<string, Place>): string | null => writable() ? store.write(next) : null;

  /** The one writer of places: the view and storage take `next` together. */
  const commitPlaces = (next: Record<string, Place>): void => {
    setPlaces(next);
    persist(next);
  };

  /** U511a: a rename that fails to save leaves the shown places as they were; the failure text, else null. */
  const commitRename = (next: Record<string, Place>): string | null => {
    const failure = store.write(next);

    if (failure === null) setPlaces(next);

    return failure;
  };

  /** Takes the places another view of this window's session stored. */
  const reload = (): void => {
    setPlaces(store.read());
  };

  // An opening is begun, reserved and finished in one turn, each step reading the last. These two hold what the steps wrote; `opening` and `reserved` show it once the change settles.
  let began: Opening = IDLE;
  let kept: Record<string, string | null> = {};
  const [opening, setOpening] = createSignal<Opening>(IDLE);
  const [reserved, setReserved] = createSignal<Record<string, string | null>>({});
  const [wanted, setWanted] = createSignal<{ id: string; focus: ReturnType<typeof captureFocus> } | null>(null);

  const begin = (next: Opening): void => {
    began = next;
    setOpening(next);
  };

  const hold = (next: Record<string, string | null>): void => {
    kept = next;
    setReserved(next);
  };

  /** Begins an opening; null when one runs already. */
  const open = (selection: string | null, arrive: (arrival: Arrival) => void): { key: string; controller: AbortController } | null => {
    if (began.kind === "opening") return null;

    const key = crypto.randomUUID();
    const controller = new AbortController();

    begin({ kind: "opening", key, selection, controller, arrive });
    hold({ ...kept, [key]: null });

    return { key, controller };
  };

  /** Ends the opening `key`, releasing its reservation if no Terminal took it. */
  const finish = (key: string): void => {
    if (began.kind === "opening" && began.key === key) begin(IDLE);

    if (kept[key] === null) {
      const { [key]: _released, ...rest } = kept;

      hold(rest);
    }
  };

  /** Hands the bubble's host to the opening `key` waits on. */
  const arrive = (key: string, arrival: Arrival): void => {
    if (began.kind === "opening" && began.key === key) began.arrive(arrival);
  };

  const reserve = (key: string, id: string): void => {
    hold({ ...kept, [key]: id });
  };

  /** The reservations at one read: the keys still preparing, and the key that reserved each listed Terminal, so a keyed `<For>` never remounts a bubble when its Terminal is listed. */
  const reservations = createMemo(() => {
    const entries = Object.entries(reserved());
    const keyOf = new Map<string, string>();

    for (const [key, id] of entries) if (id !== null && !keyOf.has(id)) keyOf.set(id, key);

    return { preparing: entries.filter(([, id]) => id === null).map(([key]) => key), keyOf };
  });

  return { places, commitPlaces, commitRename, reload, opening, open, arrive, finish, reserved, reserve, wanted, setWanted, reservations };
};
