import { registerKeys } from "./registry";
import { chordsFor, RAIL_KEYS } from "./chords";
import { placeOf } from "./places";
import { ROW } from "../rail/rows";

const rowOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLElement && target.matches(ROW) ? target : null;

const focusTabbableRow = (): void => document.querySelector<HTMLElement>(`[role="tree"] :is(${ROW})[tabindex="0"]`)?.focus();

const focusPane = (): void =>
  document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();

/** The `◇<n>` control of a leaf Agent's row when `←` or `→` is its Pads' to take: `→` opens them, `←` folds them before the tree takes it (U41, U58). A row with children keeps `→` for the tree. */
const padsControlFor = (row: HTMLElement, key: string): HTMLElement | null => {
  const control = row.querySelector<HTMLElement>("[data-pads-control]");

  if (!control) return null;

  const shown = control.getAttribute("aria-expanded") === "true";

  if (key === "ArrowLeft") return shown ? control : null;

  return !shown && row.closest("[role=treeitem]")?.getAttribute("aria-expanded") === null ? control : null;
};

/** `⌘↑`/`⌘↓` act from anywhere but a text field or a taken Terminal; a watched Agent's read-only screen is not one (U2230). */
const stepsFrom = (press: KeyboardEvent): boolean => {
  const target = press.target;

  if (!(target instanceof Element)) return true;

  if (target.closest(".pane[data-takeover]")) return false;

  return !target.closest('input, textarea, [contenteditable="true"]') || target.closest(".pane .xterm-helper-textarea") !== null;
};

/** `⌘1`, `⌘2` and `F2`, the Rail keys U31 leaves to U41, and `←`, `→` on a leaf Agent's Pads (GLOSSARY.md, Rail); the tree's own `←`, `→` come from Ark (U520). No UI of its own. */
export const Keys = () => {
  const onRename = (row: HTMLElement): void => {
    row.querySelector(".name")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  /** The Agent `by` rows from the selected one, in the order the Rail shows them (a folded or done Agent has no row); none past either end. */
  const stepAgent = (by: 1 | -1, fromRail: boolean): void => {
    const kinds = new Map(rail.nodes.map((node) => [node.id, node.kind]));

    const agents = [...document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"][data-id]')]
      .flatMap((row) => row.dataset.id !== undefined && kinds.get(row.dataset.id) === "agent" ? [row.dataset.id] : []);

    const at = agents.indexOf(rail.selected() ?? "");
    const next = at === -1 ? (by === 1 ? agents[0] : agents.at(-1)) : agents[at + by];

    if (next === undefined) return;

    rail.select(next);

    // Focus follows the selection: to the Agent's Rail row, or to its pane once the pane has rendered.
    if (fromRail) {
      rowElement(next)?.focus();

      return;
    }

    const paneFocus = (tries: number): void => {
      focusPane();

      if (!document.activeElement?.closest(".pane-screen") && tries > 0) requestAnimationFrame(() => paneFocus(tries - 1));
    };

    requestAnimationFrame(() => paneFocus(30));
  };

  const outsideTabRename = (press: KeyboardEvent) => !(press.target instanceof Element && press.target.matches(".tab-rename"));

  registerKeys({ kind: "app" }, [
    { chords: chordsFor("⌘1"), when: outsideTabRename, run: focusTabbableRow },
    { chords: chordsFor("⌘2"), when: outsideTabRename, run: focusPane },
    { chords: chordsFor("⌘↑"), when: (press) => outsideTabRename(press) && stepsFrom(press), run: (press) => { if (!press.repeat) stepAgent(-1, press.target instanceof Element && press.target.closest('[role="tree"]') !== null); } },
    { chords: chordsFor("⌘↓"), when: (press) => outsideTabRename(press) && stepsFrom(press), run: (press) => { if (!press.repeat) stepAgent(1, press.target instanceof Element && press.target.closest('[role="tree"]') !== null); } },
  ]);
  registerKeys({ kind: "region", element: () => document.querySelector<HTMLElement>('[role="tree"]') ?? undefined }, [
    { chords: RAIL_KEYS,
      when: (press) => {
        const row = rowOf(press.target);

        return placeOf(press.target instanceof Element ? press.target : null) === "rail" && row !== null && (press.key === "F2" || padsControlFor(row, press.key) !== null);
      },
      run: (press) => {
        const row = rowOf(press.target);

        if (!row) return;

        if (press.key === "F2") onRename(row);
        else padsControlFor(row, press.key)?.click();
      },
    },
  ]);

  return null;
};
