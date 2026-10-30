import { modalOpen, registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { copy } from "../copy";
import type { JSX } from "solid-js";
import "./rowButton.styles.css";

/** A clickable row of the Shelf or a Drawer: plain text, no button chrome; a long title wraps under its `#`, not under the glyph; `hang={false}` is the Shelf's (U359), whose Glyph is its own column. */
export const RowButton = (props: { onClick: (event: MouseEvent) => void; pressed?: boolean | undefined; selectionActive?: boolean | undefined; children: JSX.Element; ref?: (row: HTMLButtonElement) => void; reorderable?: boolean; keysSuspended?: boolean; hang?: boolean; label?: string; onKeyDown?: (event: KeyboardEvent) => void; onOpen?: () => void; onRename?: () => void; /** U3709: the run for Tab (`false`) or ⇧Tab (`true`), or null where it is not this row's. */ nest?: ((out: boolean) => (() => Promise<string | null>) | null) | undefined; onNest?: ((run: () => Promise<string | null>) => void) | undefined; onPointerDown?: (event: PointerEvent) => void }) => {
  let button: HTMLButtonElement | undefined;

  // One layer holds both bindings: only the first eligible layer of a press is consulted.
  if (props.onKeyDown || props.nest) registerKeys({ kind: "layer", element: () => button, active: () => document.activeElement === button && !modalOpen(), modal: false }, [{
    chords: ["Meta+Enter", "ArrowUp", "ArrowDown", "Shift+ArrowUp", "Shift+ArrowDown", "Alt+ArrowUp", "Alt+ArrowDown", "Backspace", "Escape"],
    when: (event) => !props.keysSuspended && props.onKeyDown !== undefined && event.target === button
      && (event.altKey ? props.reorderable === true : props.pressed !== undefined)
      && ((event.key !== "Escape" && event.key !== "Backspace") || props.selectionActive === true),
    run: (event) => props.onKeyDown?.(event),
  }, ...[false, true].map(out => ({
    action: CHORDS.find(row => row.inTriage && row.keys === (out ? "⇧Tab" : "Tab"))!,
    searchable: false as const, repeat: true as const,
    when: (event: KeyboardEvent) => event.target === button && props.nest?.(out) != null,
    capture: (focus: Element | null) => {
      const run = props.nest?.(out);

      return {
        available: () => focus === button && button?.isConnected === true && document.activeElement === button
          && !props.keysSuspended && !modalOpen() && run != null && props.nest?.(out) != null,
        invoke: () => { if (run) props.onNest?.(run); },
      };
    },
  }))]);

  return (
    <button type="button" class="todo-row-button"
      onDblClick={() => props.onOpen?.()}
      on:keydown={(event) => {
        if (event.target === event.currentTarget && !event.defaultPrevented && !props.keysSuspended) props.onKeyDown?.(event);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

        if (event.key === "Enter" && props.onOpen) { event.preventDefault();

 if (!event.repeat) props.onOpen(); }

        if (event.key === "F2" && props.onRename) { event.preventDefault();

 if (!event.repeat) props.onRename(); }
      }}
      onClick={(event) => props.onClick(event)} onPointerDown={(event) => props.onPointerDown?.(event)}
      aria-label={props.label} aria-description={props.reorderable ? copy.reorder : undefined} aria-pressed={props.pressed}
      style={props.hang === false ? undefined : { display: "block", "white-space": "pre-wrap", "padding-left": "var(--todo-row-indent)", "text-indent": "calc(-1 * var(--todo-row-indent))" }}
      ref={(element) => { button = element; props.ref?.(element); }}>{props.children}</button>
  );
};
