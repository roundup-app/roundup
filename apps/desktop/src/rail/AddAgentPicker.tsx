import { copy } from "../copy";
import { createSignal, For, onMount, Show } from "solid-js";
import type { ModelList } from "@contracts/project/ModelList";
import type { RoleModels } from "@contracts/project/RoleModels";
import type { AppSeam } from "../app/seam";
import { Select } from "../ui/Select";
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

  const NONE = "";

  const inherited = (field: "model" | "effort") => {
    const id = defaults()?.[field];
    const list = field === "model" ? props.list.models : props.list.efforts;

    return id == null ? null : copy.defaultModel(list.find((choice) => choice.id === id)?.label ?? id);
  };

  const choices = (field: "model" | "effort") => [
    { value: NONE, label: inherited(field) ?? copy.defaultChoice },
    ...(field === "model" ? props.list.models : props.list.efforts).map((choice) => ({ value: choice.id, label: choice.label })),
  ];

  const unresolved = () => loaded() ? (["model", "effort"] as const).filter((field) => inherited(field) === null) : [];

  const explanation = () => {
    const fields = unresolved();

    if (fields.length === 0) return null;
    const phrase = copy.unsetDefault(copy.claudeCode);

    if (fields.length === 2) return copy.fieldDefault(copy.modelAndEffort, phrase);

    return copy.fieldDefault(fields[0] === "model" ? copy.model : copy.effort, phrase);
  };

  return <div class="rail-agent-picker" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onClose(); }
  }}>
    <div class="rail-agent-fields">
      <For each={["model", "effort"] as const}>{(field) => <Select
        label={field === "model" ? copy.model : copy.effort}
        choices={choices(field)}
        value={props.pair[field] ?? NONE}
        onValueChange={(value) => props.onChange({ ...props.pair, [field]: value || null })}
      />}</For>
      <Show when={explanation()}>{(text) => <p class="rail-agent-note">{text()}</p>}</Show>
    </div>
    <div class="rail-agent-actions">
      <button type="button" data-button="primary" data-button-surface aria-disabled={props.disabled || !loaded() || undefined} onClick={() => { if (!props.disabled && loaded()) props.onAdd(); }}>{copy.addAgent}</button>
    </div>
    <Show when={failure()}>{(message) => <><ErrorLine message={message()} /><button type="button" data-button="quiet" onClick={() => void loadDefaults()}>{copy.retry}</button></>}</Show>
  </div>;
};
