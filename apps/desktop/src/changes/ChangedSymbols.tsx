import { createMemo, For, Show } from "solid-js";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import { Disclosure } from "../ui/Disclosure";
import { copy } from "./copy";
import type { CallPathsState } from "./callPaths";
import { TraceLine } from "./FlowStates";
import type { ModuleGroup } from "./modules";
import type { DiffTarget } from "./NoteBatch";
import type { Moves } from "./moveStore";
import { entriesOf, kindWords } from "./symbols";

/** U7695a: an added or removed symbol says so; a changed one says nothing, as in a flow's tree. */
const statusWord = (status: ChangedSymbol["status"]) => status === "added" || status === "removed" ? copy.callStatus[status] : undefined;

/** U7695a, U7695b, U7695c, U7696f: what an item of Logic says about its functions and types (a moved or renamed one adds its word): the trace lines of the languages not yet finished, when the item holds a file no finished trace names; "Changed since traced" over a list a write dimmed; and the list, which a name in aims the scroll at. */
export const ChangedSymbols = (props: { item: ModuleGroup; calls: CallPathsState; moves: Moves; aim: (target: DiffTarget) => void }) => {
  const entries = createMemo(() => entriesOf(props.calls.done(), props.item.files));
  const named = createMemo(() => new Set(props.calls.done().flatMap(answer => answer.symbols.map(symbol => symbol.path))));
  const unfinished = createMemo(() => props.item.files.some(file => !named().has(file.path)) ? props.calls.lines().filter(line => line.state !== "noServer" && line.state !== "dim") : []);
  const dimmed = createMemo(() => props.calls.dim().some(answer => answer.symbols.some(symbol => props.item.files.some(file => file.path === symbol.path))));

  return <Show when={unfinished().length > 0 || dimmed() || entries().length > 0}>
    <section class="flow-states changed-symbols">
      <For each={unfinished()}>{line => <TraceLine line={line} calls={props.calls} />}</For>
      <Show when={dimmed()}><p>{copy.changedSinceTraced}</p></Show>
      <Show when={entries().length > 0}>
        <Disclosure label={copy.functionsAndTypes}>
          <ul class="changed-symbols-list" aria-label={copy.functionsAndTypes}>
            <For each={entries()}>{entry => <li>
              <button type="button" class="changed-symbol-name" data-button="quiet" onClick={() => props.aim({ path: entry.path, side: entry.side, line: entry.span.start, span: entry.span })}>{entry.name}</button>
              {" "}<span>{kindWords(entry.kind)}</span>
              <Show when={statusWord(entry.status)}>{word => <>{" "}<span>{word()}</span></>}</Show>
              <Show when={props.moves.label(entry)}>{kind => <>{" "}<span>{kind() === "moved" ? copy.movedWord : copy.renamedWord}</span></>}</Show>
            </li>}</For>
          </ul>
        </Disclosure>
      </Show>
    </section>
  </Show>;
};
