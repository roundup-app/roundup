import * as v from "valibot";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { ancestorsOf } from "../rail/layout";
import { storedValue } from "../state/storage";

/** A bubble's rectangle in the centre pane's pixels, and whether it is folded to its chip (U164). */
export type Place = { x: number; y: number; w: number; h: number; min: boolean };

/** One space step (`--space-4`) is what an arrow key moves or resizes a bubble by. */
export const STEP = 16;

/** A bubble keeps extent for 24 columns by 6 rows of the default text, its header included. */
export const MIN_WIDTH = 24 * 8 + 2 * STEP;

export const MIN_HEIGHT = 6 * 17 + 2 * STEP;

export type Extent = { width: number; height: number };

const between = (low: number, high: number, value: number): number => Math.max(low, Math.min(high, value));

/** `place` kept inside `extent`, never smaller than the minimum nor larger than the extent. */
export const clamped = (place: Place, extent: Extent): Place => {
  const w = between(Math.min(MIN_WIDTH, extent.width), extent.width, place.w);
  const h = between(Math.min(MIN_HEIGHT, extent.height), extent.height, place.h);

  return { ...place, w, h, x: between(0, extent.width - w, place.x), y: between(0, extent.height - h, place.y) };
};

/** Where the `index`-th bubble opens: cascaded from the top left, three quarters of the pane wide. */
export const defaultPlace = (index: number, extent: Extent): Place =>
  clamped({ x: STEP * (1 + (index % 6)), y: STEP * (1 + (index % 6)), w: extent.width * 0.75, h: extent.height * 0.5, min: false }, extent);

const placesSchema = v.record(v.string(), v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number(), min: v.boolean() }));

/** The places live for the Daemon's life: they survive a webview reload (U103) in this window's session storage. */
export const placesStorage = (path: string) => {
  const key = `roundup:bubble-places:${path}`;

  return {
    read: (): Record<string, Place> => {
      try {
        const parsed = v.safeParse(placesSchema, JSON.parse(window.sessionStorage.getItem(key) ?? "null"));

        return parsed.success ? parsed.output : {};
      } catch {
        return {};
      }
    },
    write: (places: Record<string, Place>): void => {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(places));
      } catch {
        // The places are a convenience; a full storage loses only them.
      }
    },
    clear: (): void => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // As above.
      }
    },
  };
};

export const DEFAULT_TRANSPARENCY = 8;

export const MAX_TRANSPARENCY = 60;

export const TRANSPARENCY_STEP = 5;

const transparencySchema = v.pipe(v.number(), v.minValue(0), v.maxValue(MAX_TRANSPARENCY));

export const transparencyStorage = (path: string) => storedValue(`roundup:bubble-transparency:${path}`, transparencySchema);

/** The Terminals the selection shows (engineering call 3): its own, and those of every Workstream above it. */
export const shownFor = (terminals: readonly TerminalInfo[], nodes: readonly RailNode[], selected: string | null): TerminalInfo[] => {
  if (selected === null) return [];

  const owners = new Set([selected, ...ancestorsOf(nodes, selected).filter((id) => nodes.find((node) => node.id === id)?.kind === "workstream")]);

  return terminals.filter((terminal) => terminal.owner !== null && owners.has(terminal.owner)).toSorted((a, b) => Number(a.id) - Number(b.id));
};

/** U164: a bubble's name is its program's title, else `terminal`. */
export const nameOf = (terminal: TerminalInfo): string => terminal.title?.trim() || "terminal";
