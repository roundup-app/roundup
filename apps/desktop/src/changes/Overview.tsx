import { For, onSettled, Show } from "solid-js";
import type { Gap } from "@contracts/agent/Gap";
import type { Spot } from "@contracts/agent/Spot";
import { Counts, ItemName, moduleKey } from "./ChangedTree";
import { copy } from "./copy";
import type { Lens } from "./lens";
import type { Grouped } from "./modules";
import type { ReadbackState } from "./readback";
import type { ReadbackPad } from "./readbackPad";
import { FindingsBlock } from "./FindingsBlock";
import type { FindingsState } from "./findings";
import { ReadbackBlock } from "./ReadbackBlock";
import { SpotList } from "./SpotLine";

/** U7679c, U7688a: the pane of the Overview row: the readback (the quiet line and button before one), then the lens's modules in list order, each with its row's numbers, or the line that says the lens holds none. Shift-Tab from the first entry goes back to the row (U7679e). */
export const Overview = (props: { lens: Lens; grouped: Grouped; readback: ReadbackState; pad: ReadbackPad; agent: string; listed: (path: string) => boolean; go: (gap: Gap) => void; /** U7700b: the defect pass, and the open of a finding's file. */ findings: FindingsState; /** U7704e: the tool spots, of which those of files the listing lacks are listed after the modules. */ spots: readonly Spot[]; goFile: (path: string) => void; choose: (key: string) => void; back: () => void; ready: () => void }) => {
  let pane: HTMLElement | undefined;

  onSettled(() => { props.ready(); });

  const back = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !event.shiftKey || event.target !== pane?.querySelector("[data-entry]")) return;
    event.preventDefault();
    props.back();
  };

  return <section class="changes-overview" aria-label={copy.overview} onKeyDown={back} ref={element => { pane = element; }}>
    <ReadbackBlock readback={props.readback} pad={props.pad} agent={props.agent} listed={props.listed} go={props.go} />
    <FindingsBlock findings={props.findings} listed={props.listed} go={props.goFile} />
    <Show when={props.grouped.modules.length > 0} fallback={<p>{copy.noChangesIn(copy.lenses[props.lens])}</p>}>
      <ul>
        <For each={props.grouped.modules}>{module => <li>
          <button type="button" class="changes-row row-wash" data-entry={moduleKey(module.name)} onClick={() => props.choose(moduleKey(module.name))}>
            <ItemName item={module} />
            <span class="changes-row-files">{copy.filesCount(module.total)}</span>
            <Show when={module.counted}><Counts added={module.added} removed={module.removed} /></Show>
          </button>
        </li>}</For>
      </ul>
    </Show>
    <SpotList spots={props.spots.filter(spot => !props.listed(spot.path))} />
  </section>;
};
