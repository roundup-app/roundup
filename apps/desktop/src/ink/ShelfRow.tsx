import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

/** U359: the one row of the Shelf's lists, a Todo's and a Pad's alike: a 16 px Glyph, then a text column (title, then at most one quiet meta line) whose every line starts at the title's left edge. */
export const ShelfRow = (props: { glyph: JSX.Element; children: JSX.Element } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">) => {
  const [own, rest] = splitProps(props, ["glyph", "children", "class"]);

  return (
    <div {...rest} class={own.class ? `shelf-row ${own.class}` : "shelf-row"}>
      <span class="shelf-glyph">{own.glyph}</span>
      <div class="shelf-text">{own.children}</div>
    </div>
  );
};
