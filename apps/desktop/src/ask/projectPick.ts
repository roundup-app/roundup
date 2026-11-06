import { createEffect, createSignal, type Accessor } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";
import type { PlacedPart } from "@contracts/ask/PlacedPart";
import type { SendParams } from "@contracts/ask/SendParams";
import type { Project } from "../app/seam";

/** U6271b: how long typing must rest before one Placement call. */
export const PAUSE_MS = 600;

export type ProjectChip = { text: string; project: string };

/**
 * U6271b: the Project chip of each Ask part. One `ask.place` call per pause in typing, at most one in flight;
 * a send of the text that call placed reuses its parts, and an owner's pick sends with that Project fixed instead.
 */
export const createProjectPick = (from: {
  place(text: string): Promise<readonly PlacedPart[]>;
  projects: Accessor<readonly Project[]>;
  /** The active Project's name, which every chip reads until a pick returns. */
  active: string;
  text: Accessor<string>;
  /** The text names its Workstream (A40), so nothing is placed. */
  named: Accessor<boolean>;
}) => {
  const [placed, setPlaced] = createSignal<{ text: string; parts: readonly PlacedPart[] } | null>(null);
  const [pick, setPick] = createSignal<Readonly<Record<number, string>>>({});
  const picked = () => Object.keys(pick()).length > 0;
  /** The text and part count a pick was made against; picks keyed to several parts do not outlive an edit of that text. */
  let pickedOn: { text: string; count: number } | null = null;
  const shown = () => from.projects().length >= 2 && !from.named();
  let inflight = false;
  let later: string | null = null;

  const run = (value: string): void => {
    if (inflight) {
      later = value;

      return;
    }

    inflight = true;
    from.place(value).then(parts => setPlaced({ text: value, parts }), () => undefined).finally(() => {
      inflight = false;
      const next = later;
      later = null;

      if (next !== null && next === from.text() && next !== placed()?.text) run(next);
    });
  };

  const pause = debounce((value: string) => {
    if (value === from.text() && value !== placed()?.text && !picked() && shown()) run(value);
  }, PAUSE_MS);

  createEffect(() => {
    const value = from.text();

    if (value.trim() === "") return setPick({});

    if (picked() && pickedOn && pickedOn.count > 1 && value !== pickedOn.text) setPick({});

    if (shown() && !picked()) pause(value);
  });

  const current = () => (placed()?.text === from.text() ? placed()!.parts : null);

  return {
    chips: (): readonly ProjectChip[] => {
      if (!shown()) return [];

      if (from.text().trim() === "") return [{ text: "", project: pick()[0] ?? from.active }];

      const parts = current() ?? [{ text: from.text(), placement: { kind: "unclear" as const, question: "", candidates: [] } }];

      return parts.map((part, index) => ({ text: part.text, project: pick()[index] ?? (part.placement.kind === "unclear" ? undefined : part.placement.project) ?? from.active }));
    },
    /** One part's pick: only that part's chip changes and sends. */
    pick: (index: number, project: string): void => {
      pickedOn = { text: from.text(), count: (placed()?.text === from.text() ? placed()!.parts.length : 1) };
      setPick(picks => ({ ...picks, [index]: project }));
    },
    /** What the send adds to its request: the owner's Project, else the parts already placed for exactly this text. */
    request: (): Pick<SendParams, "project" | "parts"> => {
      const picks = pick();
      const parts = current();

      if (!picked()) return parts ? { parts: [...parts] } : {};

      if (!parts || parts.length === 1) return { project: picks[0] ?? Object.values(picks)[0]! };

      return { parts: parts.map((part, index): PlacedPart => picks[index] === undefined ? part : { text: part.text, placement: { kind: "new", title: part.text, project: picks[index] } }) };
    },
    clear: (): void => { pickedOn = null; setPick({}); setPlaced(null); },
  };
};
