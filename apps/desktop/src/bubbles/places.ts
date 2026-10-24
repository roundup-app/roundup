// fallow-ignore-file duplicate-export -- Bubble geometry differs from keys/places focus regions; both are imported directly.
import * as v from "valibot";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { ancestorsOf } from "../rail/layout";

/** A bubble's rectangle in the centre pane's pixels, whether it is minimised (U469), and the name the user gave it (U511). */
export type Place = { x: number; y: number; w: number; h: number; min: boolean; name?: string | undefined; restore?: Rect | undefined };

/** A rectangle in the centre pane's pixels: the size a filled bubble returns to (U2237). */
export type Rect = { x: number; y: number; w: number; h: number };

/** One space step (`--space-4`) is what an arrow key moves or resizes a bubble by. */
export const STEP = 16;

/** A bubble's padding (`--space-3`), its header row and gap (`--space-5`, `--space-2`) and the emulator's scrollbar, in px. */
const PADDING = 12;

const HEADER = 24 + 8;

const SCROLLBAR = 14;

/** A bubble keeps extent for 24 columns by 6 rows of the default text, its chrome included. */
export const MIN_WIDTH = 24 * 8 + 2 * PADDING + SCROLLBAR;

export const MIN_HEIGHT = 6 * 17 + 2 * PADDING + HEADER;

export type Extent = { width: number; height: number };

export const FALLBACK_EXTENT: Extent = { width: 800, height: 600 };

const between = (low: number, high: number, value: number): number => Math.max(low, Math.min(high, value));

/** `place` kept inside `extent`, never smaller than the minimum nor larger than the extent. */
export const clamped = (place: Place, extent: Extent): Place => {
  const w = between(Math.min(MIN_WIDTH, extent.width), extent.width, place.w);
  const h = between(Math.min(MIN_HEIGHT, extent.height), extent.height, place.h);

  return { ...place, w, h, x: between(0, extent.width - w, place.x), y: between(0, extent.height - h, place.y) };
};

/** U2236: the eight places on a bubble's edge where a drag resizes it, as the sign of the edge it moves on each axis. */
export const ZONES = [
  { name: "n", sx: 0, sy: -1, cursor: "ns-resize" },
  { name: "s", sx: 0, sy: 1, cursor: "ns-resize" },
  { name: "w", sx: -1, sy: 0, cursor: "ew-resize" },
  { name: "e", sx: 1, sy: 0, cursor: "ew-resize" },
  { name: "nw", sx: -1, sy: -1, cursor: "nwse-resize" },
  { name: "se", sx: 1, sy: 1, cursor: "nwse-resize" },
  { name: "ne", sx: 1, sy: -1, cursor: "nesw-resize" },
  { name: "sw", sx: -1, sy: 1, cursor: "nesw-resize" },
] as const;

export type Zone = (typeof ZONES)[number];

/** U2236 call 1: dragging an edge by `d` moves it by `d` and the opposite edge by `-d`, so the centre stays; `clamped` keeps the result in the pane. */
export const resizedAbout = (from: Place, zone: Pick<Zone, "sx" | "sy">, dx: number, dy: number, extent: Extent): Place => {
  const w = from.w + 2 * zone.sx * dx;
  const h = from.h + 2 * zone.sy * dy;

  return clamped({ ...from, w, h, x: from.x + from.w / 2 - Math.max(w, 0) / 2, y: from.y + from.h / 2 - Math.max(h, 0) / 2 }, extent);
};

/** U2237, U2892b: the pane less the gap on each side, shrinking to the pane when it is smaller. */
const fillOf = (extent: Extent): Rect => {
  const gap = Math.min(STEP, extent.width / 2, extent.height / 2);

  return { x: gap, y: gap, w: extent.width - 2 * gap, h: extent.height - 2 * gap };
};

const filled = (place: Place, extent: Extent): boolean => {
  const fill = fillOf(extent);

  return place.x === fill.x && place.y === fill.y && place.w === fill.w && place.h === fill.h;
};

/** U2237: a filled bubble returns to its `restore` rectangle, else it fills the pane and keeps its rectangle as `restore`. */
export const toggledFill = (place: Place, extent: Extent): Place => {
  if (!filled(place, extent)) return { ...place, ...fillOf(extent), restore: { x: place.x, y: place.y, w: place.w, h: place.h } };

  if (place.restore === undefined) return place;

  const { restore, ...rest } = place;

  return clamped({ ...rest, ...restore }, extent);
};

const INSET = 96;

/** U2742b: outside breathing room is three `--space-6` steps per side, shrinking at the existing minimum. */
export const defaultPlace = (extent: Extent): Place => {
  const w = Math.min(extent.width, Math.max(MIN_WIDTH, extent.width - 2 * INSET));
  const h = Math.min(extent.height, Math.max(MIN_HEIGHT, extent.height - 2 * INSET));

  return { x: (extent.width - w) / 2, y: (extent.height - h) / 2, w, h, min: false };
};

const placesSchema = v.record(v.string(), v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number(), min: v.boolean(), name: v.optional(v.string()), restore: v.optional(v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() })) }));

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
    write: (places: Record<string, Place>): string | null => {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(places));

        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
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

/** The Terminals the selection shows (engineering call 3): its own, and those of every Workstream above it. */
export const shownFor = (terminals: readonly TerminalInfo[], nodes: readonly RailNode[], selected: string | null): TerminalInfo[] => {
  if (selected === null) return [];

  const panes = new Set(nodes.flatMap((node) => node.terminal_id === null ? [] : [node.terminal_id]));
  const owners = new Set([selected, ...ancestorsOf(nodes, selected).filter((id) => nodes.find((node) => node.id === id)?.kind === "workstream")]);

  return terminals.filter((terminal) => terminal.owner !== null && owners.has(terminal.owner) && !panes.has(terminal.id)).toSorted((a, b) => Number(a.id) - Number(b.id));
};

/** U164: a bubble's name is its program's title, else the program's own name. */
export const nameOf = (terminal: TerminalInfo): string => terminal.title?.trim() || terminal.program;

/** The window event a Switcher entry for Terminal `detail` sends: show its bubble, restoring it, and focus its emulator (U529). */
export const REVEAL_BUBBLE = "roundup:reveal-bubble";

/** U511: the name the user gave a Terminal wins over its default; clearing it brings the default back. */
export const shownName = (terminal: TerminalInfo, place: Place | undefined): string => place?.name || nameOf(terminal);

/** U2236 call 2: `--space-2` strips centred on the edges, `--space-4` squares over the corners. */
const EDGE = 8;

const CORNER = 16;

export const zoneBox = (place: Place, zone: Zone) => {
  const thick = zone.sx !== 0 && zone.sy !== 0 ? CORNER : EDGE;

  const along = (low: number, size: number, sign: number, span: number): [number, number] =>
    sign < 0 ? [low - span / 2, span] : sign > 0 ? [low + size - span / 2, span] : [low + CORNER / 2, size - CORNER];

  const [left, width] = along(place.x, place.w, zone.sx, thick);
  const [top, height] = along(place.y, place.h, zone.sy, thick);

  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
};

