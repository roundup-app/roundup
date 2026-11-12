import { rowTypeahead } from "../ui/RowCollection";
import { captureFocus, queueFocus } from "../keys/focus";
import { createRoot, onCleanup } from "solid-js";
import { CHORDS, TEXT_FIELDS } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import type { ActivationSource, KeyScope } from "../keys/registry";
import type { ShelfFrame } from "./frame";
import { createBenchRotation } from "./rotation";
import type { ConnectedProject } from "../state/connectedProject";

export const shelfKeyScope: KeyScope = { kind: "region", element: () => document.querySelector<HTMLElement>(".shelf") ?? undefined };

const canShelfKey = (event: KeyboardEvent) => !rowTypeahead(event) && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
  && event.target instanceof Element && !event.target.closest("input, textarea, select, [contenteditable], .drawer, [role=dialog], [role=alertdialog]")
  && !document.querySelector('.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu]');

/** U3723: both lists bind the same keys without changing their selection or pointer paths. */
export const shelfRowKeys = <Id,>(props: {
  focused: () => Id | undefined;
  remove: (id: Id) => void;
  exportPad?: (id: Id) => void;
}) => {
  registerKeys(shelfKeyScope, ["D", "E"].map(keys => {
    const capture = (focus: Element | null) => {
      const id = props.focused();

      const available = () => focus?.isConnected === true && !focus.closest("input,textarea,select,[contenteditable]")
        && id !== undefined && props.focused() === id && (keys !== "E" || props.exportPad !== undefined);

      return { available, invoke: () => { if (id !== undefined) { if (keys === "D") props.remove(id);
        else props.exportPad?.(id); } } };
    };

    return {
      action: CHORDS[keys === "D" ? "todo.delete" : "todo.export"], searchable: false as const,
      when: (event: KeyboardEvent) => canShelfKey(event) && capture(event.target instanceof Element ? event.target : null).available(),
      capture,
    };
  }));
};

/** U370: leader `S` toggles, `esc` from inside; focus goes to the open tab on opening and back to where it was on closing. */
export const shelfKeys = (props: { frame: ShelfFrame; shelf: () => HTMLElement | null; connection?: () => ConnectedProject | Error | undefined }) => {
  let returnTo: HTMLElement | null = null;
  const tablist = () => document.querySelector<HTMLElement>(".shelf-tabs") ?? undefined;
  const selectedTab = () => tablist()?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const firstControl = () => props.shelf()?.querySelector<HTMLElement>('.shelf-controls button:not([disabled]), .shelf [role=tabpanel] [tabindex="0"], .shelf [role=tabpanel] input:not([disabled])');

  const toggle = (source: ActivationSource = "pointer") => {
    const opening = !props.frame.open();
    const kept = document.activeElement;

    if (opening) {
      captureFocus(true);
      returnTo = kept instanceof HTMLElement && kept !== document.body ? kept : null;
    }

    props.frame.toggle(source);

    if (!opening && kept instanceof HTMLElement && (props.shelf()?.contains(kept) || kept.closest(".shelf-tabs"))) {
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
      else kept.blur();

      returnTo = null;
    }

    if (opening) queueFocus(() => selectedTab()?.focus({ preventScroll: true }));
  };

  const modalOpen = () => document.querySelector('.drawer[data-open="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [data-dnd-dragging]') !== null;

  const isCloseAvailable = (target: Element, path: EventTarget[] = []) => {
    // U6224: Escape closes a peek from anywhere, the Terminal included, unless a Drawer, dialog or menu owns the key.
    if (props.frame.peeking()) return !modalOpen();

    if (!props.frame.open()) return false;

    const shelf = props.shelf();

    if (shelf?.getAttribute("data-triage") === "on") return false;

    // A naming field can remove itself while handling Escape; its original path
    // still belongs to the Shelf, so that same key must not close the fallback.
    const inside = (shelf !== null && (shelf.contains(target) || path.includes(shelf))) || target.closest(".shelf-tabs") !== null;
    const overlay = props.shelf()?.closest(".window")?.getAttribute("data-shelf-mode") === "overlay";

    if (!inside && (!overlay || !target.closest(".centre"))) return false;

    if ((inside && target.closest("input, textarea, [contenteditable]")) || modalOpen()) return false;

    return true;
  };

  const canEscape = (press: KeyboardEvent) => !press.defaultPrevented && press.key === "Escape" && press.target instanceof Element && isCloseAvailable(press.target, press.composedPath());

  const moveFocus = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Tab" || !props.frame.open() || !(event.target instanceof HTMLElement)) return;

    const next = event.shiftKey
      ? event.target === firstControl() ? selectedTab() : null
      : tablist()?.contains(event.target) ? firstControl() : null;

    if (!next) return;

    event.preventDefault();
    next.focus({ preventScroll: true });
  };

  const stop = createRoot((dispose) => {
    registerKeys(shelfKeyScope, [{
      chords: ["Shift+Tab"],
      when: event => props.frame.open() && event.target === firstControl() && selectedTab() !== undefined,
      run: () => selectedTab()?.focus({ preventScroll: true }),
    }, { action: CHORDS["shelf.maximise"], searchable: false,
      when: canShelfKey, capture: focus => ({ available: () => focus?.isConnected === true && !focus.closest("input,textarea,select,[contenteditable]") && props.frame.open() && props.shelf()?.contains(focus) === true && props.shelf()?.closest(".window")?.getAttribute("data-shelf-mode") !== "overlay", invoke: () => props.frame.toggleMaximise("key") }) }]);
    registerKeys({ kind: "app" }, [{ action: CHORDS["shelf.close"], searchable: false, when: canEscape,
      capture: focus => ({ available: () => focus?.isConnected === true && isCloseAvailable(focus), invoke: () => { if (props.frame.peeking()) props.frame.unpeek(); else toggle("key"); } }) }]);

    return dispose;
  });

  onCleanup(stop);

  return {
    toggle,
    moveFocus,
    stop,
    ...createBenchRotation({ ...props, toggle }),
  };
};

/** The Todos list captures creation scope for its key and menu item. */
export const todoCreationKeys = (props: {
  section: () => HTMLElement | undefined;
  active: () => boolean;
  editing: () => boolean;
  home: () => string | null;
  owner: () => string | null;
  open: (home: string | null, owner: string | null) => void;
}) => {
  registerKeys(shelfKeyScope, [{ action: CHORDS["todo.add"], match: "key", searchable: false,
    when: event => !event.repeat && !event.isComposing && !rowTypeahead(event),
    capture: focus => {
      const home = props.home();
      const owner = props.owner();

      return {
        available: () => props.active() && !props.editing() && focus?.isConnected === true && props.section()?.contains(focus) === true
          && !focus.closest(`${TEXT_FIELDS},select,[contenteditable], [hidden], [inert]`)
          && props.home() === home && props.owner() === owner,
        invoke: () => props.open(home, owner),
      };
    },
  }]);
};
