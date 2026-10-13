import { Icon } from "../ink/Icon";

/** U470: the shared Shelf scope is one icon button; its name says what the next press shows. */
export const ScopeControl = (props: { showAll: boolean; onChange: (showAll: boolean) => void }) => (
  <button
    data-button="icon"
    data-reads={props.showAll ? "text" : undefined}
    type="button"
    class="scope-control"
    aria-pressed={props.showAll}
    aria-label={props.showAll ? "Show only this Workstream" : "Show all Workstreams"}
    title={props.showAll ? "Show only this Workstream" : "Show all Workstreams"}
    onClick={() => props.onChange(!props.showAll)}
  >
    <Icon name="diamond" filled={props.showAll} />
  </button>
);
