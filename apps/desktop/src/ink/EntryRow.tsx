import type { JSX } from "solid-js";
import { onCleanup } from "solid-js";
import { ShelfRow } from "./ShelfRow";

/**
 * U16, U19: the row at the end of a Shelf list where a new item is typed, drawn as the rows around it with a borderless field.
 * Enter with text submits and leaves the field empty and focused for the next one; Enter or blur with no text, and Escape, close it.
 */
export const EntryRow = (props: {
  glyph: JSX.Element;
  label: string;
  placeholder: string;
  class: string;
  onSubmit: (text: string) => void;
  onClose: (reason: "enter" | "escape" | "blur") => void;
}) => (
  <ShelfRow glyph={props.glyph} class={`entry-row ${props.class}`}>
    <input
      class="entry-field"
      aria-label={props.label}
      placeholder={props.placeholder}
      ref={(field) => {
        // The list grows above this row when an item lands, so keep the row in view as the list's height changes.
        const list = new ResizeObserver(() => field.scrollIntoView({ block: "nearest" }));

        queueMicrotask(() => {
          field.focus();
          field.scrollIntoView({ block: "nearest" });
          const section = field.closest("section");

          if (section) list.observe(section);
        });
        onCleanup(() => list.disconnect());
      }}
      onKeyDown={(key) => {
        const field = key.currentTarget;

        if (key.key === "Escape") props.onClose("escape");
        else if (key.key !== "Enter") return;
        else if (field.value.trim() === "") props.onClose("enter");
        else {
          props.onSubmit(field.value.trim());
          field.value = "";
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.value.trim() === "") props.onClose("blur");
      }}
    />
  </ShelfRow>
);
