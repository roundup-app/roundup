import { createEffect, Show, untrack } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";
import { copy } from "./copy";
import { ownedCount } from "./owned";
import "./styles.css";

/** U7186c: an Agent's Rail icon with the count of files it owns; none at 0, none while loading or failed. */
export const ChangesIcon = (props: { id: string }) => {
  const { owned, rail, showView } = useConnectedProject();

  // A row is keyed on its Agent, so the id never changes under it.
  const id = untrack(() => props.id);

  owned.watch(id);
  const read = () => owned.read(id);
  const count = () => ownedCount(read());
  const title = () => `${copy.reviewChanges}: `;

  // P11: the failed read keeps its cause and Retry in the Rail's own message surface.
  createEffect(read, (next) => {
    if (next?.failure) rail.commandFailure.show(`${title()}${next.failure}`, null, "rail", () => { void owned.refresh(id); });
    else if (next && rail.commandFailure.message()?.startsWith(title())) rail.commandFailure.clear();
  });

  return <Show when={count() > 0}>
    <IconButton class="changes-icon" aria-label={copy.changedFiles(count())} onKeyDown={(press) => press.stopPropagation()} onClick={(click) => { click.stopPropagation(); rail.select(id); showView("changes"); }}>
      <Icon name="branch" /><span class="changes-count">{count()}</span>
    </IconButton>
  </Show>;
};
