import { createSignal, For, onMount, Show } from "solid-js";
import type { ModelList } from "@contracts/project/ModelList";
import type { RoleModels } from "@contracts/project/RoleModels";
import type { AppSeam } from "../app/seam";
import { ErrorLine } from "../ink/ErrorLine";

export const AddAgentPicker = (props: {
  app: AppSeam;
  list: ModelList;
  pair: { model: string | null; effort: string | null };
  disabled: boolean;
  onChange: (pair: { model: string | null; effort: string | null }) => void;
  onAdd: () => void;
  onClose: () => void;
}) => {
  const [defaults, setDefaults] = createSignal<RoleModels | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const loadDefaults = async () => {
    setFailure(null);
    try {
      const settings = await props.app.rpc("project.get", null);
      setDefaults(settings.models.roles.find((role) => role.role === "subagent") ?? null);
      setLoaded(true);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    }
  };
  onMount(() => void loadDefaults());

  const label = (field: "model" | "effort") => {
    const id = defaults()?.[field];
    const list = field === "model" ? props.list.models : props.list.efforts;

    return `Default (${id == null ? "Claude Code" : list.find((choice) => choice.id === id)?.label ?? id})`;
  };

  return <div class="rail-agent-picker" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); }
  }}>
    <For each={["model", "effort"] as const}>{(field) => <label>
      {field === "model" ? "Model" : "Effort"}
      <select class="choice-select" aria-label={field === "model" ? "Model" : "Effort"} onChange={(event) => props.onChange({ ...props.pair, [field]: event.currentTarget.value || null })}>
        <option value="" selected={props.pair[field] === null}>{label(field)}</option>
        <For each={field === "model" ? props.list.models : props.list.efforts}>{(choice) => <option value={choice.id} selected={props.pair[field] === choice.id}>{choice.label}</option>}</For>
      </select>
    </label>}</For>
    <button type="button" data-button="quiet" aria-disabled={props.disabled || !loaded() || undefined} onClick={() => { if (!props.disabled && loaded()) props.onAdd(); }}>Add agent</button>
    <Show when={failure()}>{(message) => <><ErrorLine message={message()} /><button type="button" data-button="quiet" onClick={() => void loadDefaults()}>Retry</button></>}</Show>
  </div>;
};
