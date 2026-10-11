import type { JSX } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import type { GroupId } from "../rail/groups";
import { Icon } from "./Icon";

/** U172: the one head of a collapsible group: a 16 px mark, the label, a hairline rule and `<shown>/<total>`; `children` trail it (the add button). */
export const GroupHead = (props: { group: GroupId; label: string; shown: number; total: number; children?: JSX.Element }) => {
  const { rail } = useConnectedProject();
  const closed = () => rail.collapsed().has(props.group);

  return (
    <div class="group-head" data-group={props.group}>
      <button data-button="quiet" type="button" class="group-toggle" aria-expanded={!closed()} onClick={() => rail.toggleCollapsed(props.group)}>
        <Icon name={closed() ? "right" : "down"} />
        <span class="group-label">{props.label}</span>
      </button>
      <span class="group-rule" aria-hidden="true" />
      <span class="group-count" title={`${props.shown} shown of ${props.total}`}>
        {props.shown}/{props.total}
      </span>
      {props.children}
    </div>
  );
};
