import { For } from "solid-js";
import type { Span } from "@contracts/search/Span";

/** U7707d: `text` with exactly the characters inside `ranges` (UTF-16 offsets, the Daemon's) in `mark` elements; the App never matches words itself. */
export const Marked = (props: { text: string; ranges: readonly Span[] }) => {
  const pieces = () => {
    const out: { text: string; marked: boolean }[] = [];
    let at = 0;

    for (const { start, end } of props.ranges.toSorted((a, b) => a.start - b.start)) {
      const from = Math.max(start, at);

      if (end <= from) continue;

      if (from > at) out.push({ text: props.text.slice(at, from), marked: false });
      out.push({ text: props.text.slice(from, end), marked: true });
      at = end;
    }

    if (at < props.text.length) out.push({ text: props.text.slice(at), marked: false });

    return out;
  };

  return <For each={pieces()}>{piece => piece.marked ? <mark>{piece.text}</mark> : piece.text}</For>;
};
