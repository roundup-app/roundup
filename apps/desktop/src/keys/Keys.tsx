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

/** `⌘1`, `⌘2` and `F2`, the Rail keys U31 leaves to U41, and `←`, `→` on a leaf Agent's Pads (GLOSSARY.md, Rail); the tree's own `←`, `→` come from Ark (U520). No UI of its own. */
export const Keys = () => {
  const onRename = (row: HTMLElement): void => {
    row.querySelector(".name")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  const outsideTabRename = (press: KeyboardEvent) => !(press.target instanceof Element && press.target.matches(".tab-rename"));

  registerKeys({ kind: "app" }, [
    { chords: chordsFor("⌘1"), when: outsideTabRename, run: focusTabbableRow },
    { chords: chordsFor("⌘2"), when: outsideTabRename, run: focusPane },
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
