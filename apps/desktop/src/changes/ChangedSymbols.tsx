import { createMemo, For, Show } from "solid-js";
import { copy } from "./copy";
import type { CallPathsState } from "./callPaths";
import { TraceLine } from "./FlowStates";
import type { ModuleGroup } from "./modules";

/** U7695b, U8032c: what the open item of Logic says above its function rows: the trace lines of the languages not yet finished, when the item holds a file no finished trace names, and "Changed since traced" over rows a write dimmed. */
export const SymbolStates = (props: { item: ModuleGroup; calls: CallPathsState }) => {
  const named = createMemo(() => new Set(props.calls.done().flatMap(answer => answer.symbols.map(symbol => symbol.path))));
  const unfinished = createMemo(() => props.item.files.some(file => !named().has(file.path)) ? props.calls.lines().filter(line => line.state !== "noServer" && line.state !== "dim") : []);
  const dimmed = createMemo(() => props.calls.dim().some(answer => answer.symbols.some(symbol => props.item.files.some(file => file.path === symbol.path))));

  return <Show when={unfinished().length > 0 || dimmed()}>
    <section class="flow-states changed-symbols">
      <For each={unfinished()}>{line => <TraceLine line={line} calls={props.calls} />}</For>
      <Show when={dimmed()}><p>{copy.changedSinceTraced}</p></Show>
    </section>
  </Show>;
};
