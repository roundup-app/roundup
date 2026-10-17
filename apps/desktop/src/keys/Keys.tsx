import { registerKeys } from "./registry";
import { chordsFor, RAIL_KEYS } from "./chords";
import { useConnectedProject } from "../state/connectedProject";
import { placeOf } from "./places";
import { railStep } from "./railStep";

const isRow = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.dataset.id !== undefined;

/** `aria-expanded` is set only on a Workstream's row (U8's `▾`/`▸`); anything else has no fold to read. */
const expandedOf = (row: HTMLElement): boolean | null => {
  const value = row.getAttribute("aria-expanded");

  return value === null ? null : value === "true";
};

/** The row right after `row` in Rail order, one level deeper: `→`'s first child (U41). A child folded into U8's
 * `✓ n done` line is never it, because the Rail renders no row for it until the fold opens. */
const firstVisibleChildOf = (row: HTMLElement): string | undefined => {
  let next = row.nextElementSibling;

  while (next instanceof HTMLElement && next.dataset.pads !== undefined) next = next.nextElementSibling;

  if (!(next instanceof HTMLElement) || next.dataset.id === undefined) return undefined;

  const level = Number(row.getAttribute("aria-level"));
  const nextLevel = Number(next.getAttribute("aria-level"));

  return nextLevel > level ? next.dataset.id : undefined;
};

const rowElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="tree"] [data-id="${id}"]`);

const focusTabbableRow = (): void => document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')?.focus();

const focusPane = (): void =>
  document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();

/** `⌘↑`/`⌘↓` act from anywhere but a text field or a taken Terminal; a watched Agent's read-only screen is not one (U2230). */
const stepsFrom = (press: KeyboardEvent): boolean => {
  const target = press.target;

  if (!(target instanceof Element)) return true;

  if (target.closest(".pane[data-takeover]")) return false;

  return !target.closest('input, textarea, [contenteditable="true"]') || target.closest(".pane .xterm-helper-textarea") !== null;
};

/** `⌘1`, `⌘2`, `←`, `→` and `F2`, the Rail keys U31 leaves to U41 (GLOSSARY.md, Rail). No UI of its own. */
export const Keys = () => {
  const { rail } = useConnectedProject();

  const onArrow = (row: HTMLElement, direction: "left" | "right"): void => {
    const id = row.dataset.id;

    if (id === undefined) return;

    const control = row.querySelector<HTMLElement>("[data-pads-control]");
    const padsShown = control?.getAttribute("aria-expanded") === "true";

    /** U58: `→` on a leaf Agent opens its Pads, and `←` folds them before it selects the parent. */
    if (control && (direction === "left" ? padsShown : expandedOf(row) === null && !padsShown && firstVisibleChildOf(row) === undefined)) {
      control.click();

      return;
    }

    const step = railStep(rail.nodes, id, direction, expandedOf(row), firstVisibleChildOf(row));

    if (step.kind === "collapse" || step.kind === "expand") {
      row.querySelector<HTMLElement>('button[aria-label="Collapse"]')?.click();
    } else if (step.kind === "select") {
      rowElement(step.id)?.focus();
      rail.select(step.id);
    }
  };

  const onRename = (row: HTMLElement): void => {
    row.querySelector(".name")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  /** The Agent `by` rows from the selected one, in the order the Rail shows them (a folded or done Agent has no row); none past either end. */
  const stepAgent = (by: 1 | -1): void => {
    const kinds = new Map(rail.nodes.map((node) => [node.id, node.kind]));

    const agents = [...document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"][data-id]')]
      .flatMap((row) => row.dataset.id !== undefined && kinds.get(row.dataset.id) === "agent" ? [row.dataset.id] : []);

    const at = agents.indexOf(rail.selected() ?? "");
    const next = at === -1 ? (by === 1 ? agents[0] : agents.at(-1)) : agents[at + by];

    if (next !== undefined) rail.select(next);
  };

  const outsideTabRename = (press: KeyboardEvent) => !(press.target instanceof Element && press.target.matches(".tab-rename"));

  registerKeys({ kind: "app" }, [
    { chords: chordsFor("⌘1"), when: outsideTabRename, run: focusTabbableRow },
    { chords: chordsFor("⌘2"), when: outsideTabRename, run: focusPane },
    { chords: chordsFor("⌘↑"), when: (press) => outsideTabRename(press) && stepsFrom(press), run: (press) => { if (!press.repeat) stepAgent(-1); } },
    { chords: chordsFor("⌘↓"), when: (press) => outsideTabRename(press) && stepsFrom(press), run: (press) => { if (!press.repeat) stepAgent(1); } },
  ]);
  registerKeys({ kind: "region", element: () => document.querySelector<HTMLElement>('[role="tree"]') ?? undefined }, [
    { chords: RAIL_KEYS,
      when: (press) => placeOf(press.target instanceof Element ? press.target : null) === "rail" && isRow(press.target),
      run: (press) => {
        if (!isRow(press.target)) return;

        if (press.key === "F2") onRename(press.target);
        else onArrow(press.target, press.key === "ArrowLeft" ? "left" : "right");
      },
    },
  ]);

  return null;
};
