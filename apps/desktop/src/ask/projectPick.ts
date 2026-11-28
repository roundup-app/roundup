import { createEffect, createSignal, type Accessor } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";
import type { PlacedPart } from "@contracts/ask/PlacedPart";
import type { SendParams } from "@contracts/ask/SendParams";
import type { Project } from "../app/seam";

/** U6271b: how long typing must rest before one Placement call. */
export const PAUSE_MS = 600;

/**
 * U6271b: one `ask.place` call per pause in typing, at most one in flight; a send of the text that call placed reuses its parts.
 * Text that holds a token is placed by the Daemon at send (U8045c), so it is never placed ahead.
 */
export const createProjectPick = (from: {
  place(text: string): Promise<readonly PlacedPart[]>;
  projects: Accessor<readonly Project[]>;
  text: Accessor<string>;
  /** The text names its Workstream (A40) or a token (U8045c), so nothing is placed. */
  named: Accessor<boolean>;
}) => {
  const [placed, setPlaced] = createSignal<{ text: string; parts: readonly PlacedPart[] } | null>(null);
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
    if (value === from.text() && value !== placed()?.text && shown()) run(value);
  }, PAUSE_MS);

  createEffect(() => {
    const value = from.text();

    return { value, arm: value.trim() !== "" && shown() };
  }, ({ value, arm }) => {
    if (arm) pause(value);
  });

  const current = () => (placed()?.text === from.text() ? placed()!.parts : null);

  return {
    /** What the send adds to its request: the parts already placed for exactly this text. */
    request: (): Pick<SendParams, "parts"> => {
      const parts = current();

      return parts ? { parts: [...parts] } : {};
    },
    clear: (): void => { setPlaced(null); },
  };
};
