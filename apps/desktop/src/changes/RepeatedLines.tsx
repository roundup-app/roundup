import { createEffect, createSignal, Show } from "solid-js";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { ScanHit } from "@contracts/agent/ScanHit";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { reply } from "./notes";

type Excerpt = { kind: "text"; text: string } | { kind: "none" } | { kind: "failed"; cause: string };

/** U7685b: lines `start` to `end` (1-based, inclusive) of `text`. */
const linesOf = (text: string, start: number, end: number) => text.split("\n").slice(start - 1, end).join("\n");

const body = (each: Excerpt) => each.kind === "text" ? <pre class="repeat-excerpt">{each.text}</pre> : each.kind === "none" ? <p>{copy.noTextToShow}</p> : <p>{each.cause}</p>;

/** U7685a, U7685b: the mark under a repeat's last line: it names the other place, and a click shows that place's lines, read once, with the path that opens it in the editor. */
export const RepeatedLines = (props: { id: string; hit: ScanHit; to: CompareTarget; open: (path: string, at: { side: "new"; line: number }) => void }) => {
  const { app } = useConnectedProject();
  const [shown, setShown] = createSignal(false);
  const [excerpt, setExcerpt] = createSignal<Excerpt>();
  const other = () => props.hit.other;
  const place = () => copy.repeatPlace(other().path, other().start, other().end);

  const read = async (id: string, to: CompareTarget, at: ScanHit["other"]) => {
    const result = await reply(() => app.rpc("agent.compareFile", { id, path: at.path, to }));

    if (result.kind !== "ok") return setExcerpt({ kind: "failed", cause: result.text });

    const side = result.value.new.kind === "text" ? result.value.new : result.value.old;

    return setExcerpt(side.kind === "text" ? { kind: "text", text: linesOf(side.text, at.start, at.end) } : { kind: "none" });
  };

  // A failed read asks again at the next opening.
  createEffect(shown, on => {
    if (on && (excerpt()?.kind === undefined || excerpt()?.kind === "failed")) void read(props.id, props.to, other());
  });

  return <div class="repeat-mark" data-surface="diff">
    <button type="button" data-button="quiet" aria-expanded={shown() ? "true" : "false"} onClick={() => setShown(!shown())}>{copy.repeatsAt(place())}</button>
    <Show when={shown()}>
      <div class="repeat-place" role="group" aria-label={place()}>
        <button type="button" data-button="quiet" aria-label={copy.openRepeat(place())} onClick={() => props.open(other().path, { side: "new", line: other().start })}>{place()}</button>
        <div role="status"><Show when={excerpt()} keyed>{each => body(each)}</Show></div>
      </div>
    </Show>
  </div>;
};
