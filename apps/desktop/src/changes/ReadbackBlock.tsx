import { For, Match, Show, Switch } from "solid-js";
import type { Account } from "@contracts/agent/Account";
import type { Gap } from "@contracts/agent/Gap";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { failureCause, gapsFailure, gapsOf, type ReadbackState } from "./readback";
import { ReadbackDiagram } from "./ReadbackDiagram";

type Linking = { agent: string; listed: (path: string) => boolean; go: (gap: Gap) => void };

/** U7688a, U7688b: the readback's one kind of action is an icon: its name and tooltip carry the words. */
const ReadbackAction = (props: { name: string; icon: "read" | "rotate-cw"; run: () => void }) => <IconButton aria-label={props.name} onClick={props.run}><Icon name={props.icon} /></IconButton>;

/** U7688e: each gap with the link to its line, or without one when its file is gone from the listing. */
const GapList = (props: { gaps: readonly Gap[] } & Linking) => <ul class="readback-gaps" aria-label={copy.gaps}>
  <For each={props.gaps}>{gap => <li>
    <Show when={props.listed(gap.path)} fallback={<span class="readback-gap">{copy.gapSaid(props.agent, gap.said)} {copy.gapDiff(gap.quote)}</span>}>
      <button type="button" data-button="quiet" class="readback-gap" aria-label={copy.openGap(copy.repeatPlace(gap.path, gap.line, gap.line))} onClick={() => props.go(gap)}>{copy.gapSaid(props.agent, gap.said)} {copy.gapDiff(gap.quote)}</button>
    </Show>
  </li>}</For>
</ul>;

const AccountText = (props: { account: Account } & Linking) => <>
  <p class="readback-credit">{copy.readbackCredit}</p>
  <p class="readback-overview">{props.account.overview}</p>
  <ReadbackDiagram text={props.account.diagram} />
  <Show when={gapsFailure(props.account)}>{cause => <p class="flow-cause">{copy.gapsNotCompared(props.agent)} {cause()}</p>}</Show>
  <Show when={gapsOf(props.account).length > 0}><GapList gaps={gapsOf(props.account)} agent={props.agent} listed={props.listed} go={props.go} /></Show>
</>;

/** U7688a, U7688b, U7688c, U7688e: the readback at the top of the Overview: the quiet line and button before one, then the states, the account and its gaps. */
export const ReadbackBlock = (props: { readback: ReadbackState } & Linking) => {
  const state = () => props.readback.state();
  const start = () => props.readback.start();

  return <section class="readback" aria-label={copy.readback}>
    <Show when={props.readback.available()} fallback={<p>{copy.readbackNeedsTree}</p>}>
      <Switch>
        <Match when={state().state === "notRead"}>
          <p>{copy.readbackQuiet}</p>
          <ReadbackAction name={copy.readBack} icon="read" run={start} />
        </Match>
        <Match when={state().state === "reading"}><p role="status">{copy.readingBack}</p></Match>
        <Match when={failureCause(state())}>{cause => <p>{copy.readbackFailed} <ReadbackAction name={copy.retry} icon="rotate-cw" run={start} /> <span class="flow-cause">{cause()}</span></p>}</Match>
        <Match when={props.readback.account()}>{account => <div class="readback-account" data-stale={state().state === "stale" ? "true" : "false"}>
          <Show when={state().state === "stale"}><p>{copy.changedSinceReadback} <ReadbackAction name={copy.readBackAgain} icon="rotate-cw" run={start} /></p></Show>
          <div class="readback-text"><AccountText account={account()} agent={props.agent} listed={props.listed} go={props.go} /></div>
        </div>}</Match>
      </Switch>
    </Show>
  </section>;
};

/** U7688d: a module's own account from the readback, or the line that says it has none; shown only while the readback is read. */
export const ModuleAccount = (props: { readback: ReadbackState; names: readonly string[] }) => <Show when={props.readback.state().state === "read" ? props.readback.account() : undefined}>{account => {
  const note = () => account().modules.find(each => props.names.includes(each.module));

  return <p class="module-account">{note()?.account ?? copy.noModuleAccount}</p>;
}}</Show>;
