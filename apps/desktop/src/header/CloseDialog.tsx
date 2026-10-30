import type { App } from "../app/seam";
import { copy } from "./copy";
import { NativeAlert } from "../ui/NativeAlert";
import type { StripTab } from "./tab";

/** `<k> Agents run: <name>, <name>, <name>.` with at most three names, then `and <j> more` (U184). */
const runningText = (names: readonly string[]): string => {
  const shown = names.slice(0, 3).join(copy.comma);
  const more = names.length > 3 ? copy.andMore(names.length - 3) : "";

  return copy.runningAgents(names.length, names.length === 1 ? copy.agentRuns : copy.agentsRun, shown, more);
};

/** One system question before a Project with running Agents closes. */
export const CloseDialog = (props: { app: Pick<App, "ask">; tab: StripTab | undefined; opener: HTMLElement | undefined; onCancel: () => void; onStop: () => void | Promise<void> }) => (
  <NativeAlert app={props.app} open={!!props.tab}
    question={{ title: props.tab ? copy.closeQuestion(props.tab.name) : "", message: props.tab ? `${runningText(props.tab.running)}\n${copy.closingStopsThem}` : "", okLabel: copy.stopAndClose, cancelLabel: copy.cancel }}
    onConfirm={props.onStop} onCancel={props.onCancel} finalFocus={() => props.opener?.isConnected && props.opener !== document.body ? props.opener : document.querySelector<HTMLElement>('.strip [role="tab"][aria-selected="true"]') ?? document.querySelector<HTMLElement>(".strip-add")} />
);
