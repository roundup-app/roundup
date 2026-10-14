import ListFilter from "lucide-solid/icons/list-filter";

/** U470: the shared Shelf scope is one icon button; its name says what the next press shows. */
export const ScopeControl = (props: { showAll: boolean; onChange: (showAll: boolean) => void }) => (
  <button
    data-button="icon"
    type="button"
    class="scope-control"
    aria-pressed={props.showAll}
    aria-label={props.showAll ? "Show only this Workstream" : "Show all Workstreams"}
    title={props.showAll ? "Show only this Workstream" : "Show all Workstreams"}
    onClick={() => props.onChange(!props.showAll)}
  >
    <ListFilter class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} />
  </button>
);
