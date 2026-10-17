import { copy } from "../copy";
import { createSignal, For, onMount, Show } from "solid-js";
import type { ProjectModels } from "@contracts/project/ProjectModels";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { createChoices } from "./choices";
import { ModelPair } from "./ModelPair";
import "./styles.css";
import { Dialog } from "../ui/Dialog";
import { registerKeys } from "../keys/registry";

/** The `Models` sheet of the open Project (U377): one row per role the Daemon returns, and the Models a Door may start a child on. `Esc` closes it and focus returns to where it opened from. */
export const ModelsSheet = (props: { onClose: () => void }) => {
  const { app, daemonExit } = useConnectedProject();
  const choices = createChoices(app);
  const [stored, setStored] = createSignal<ProjectModels | null>(null);
  const [mcp, setMcp] = createSignal(true);
  const [failure, setFailure] = createSignal<string | null>(null);
  const returnTo = document.activeElement;
  const [open, setOpen] = createSignal(true);
  let panel: HTMLElement | undefined;

  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, []);

  onMount(() => {
    void choices.load();
    void (async () => {
      try {
        const project = await app.rpc("project.get", null);

        setMcp(project.mcp.on);
        setStored(project.models);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
      }
    })();
  });

  /** Each change calls `project.setModels` once with the whole state; a failure shows the line and the control returns to the stored value. */
  const save = async (next: ProjectModels, undo: () => void) => {
    if (daemonExit() !== null) return undo();

    try {
      await app.rpc("project.setModels", next);
      setStored(next);
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      undo();
      setFailure(error.message);
    }
  };

  /** M2219: `project.setMcp` once per change; only Agents started afterward are affected. */
  const saveMcp = async (on: boolean, undo: () => void) => {
    if (daemonExit() !== null) return undo();

    try {
      await app.rpc("project.setMcp", { on });
      setMcp(on);
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      undo();
      setFailure(error.message);
    }
  };

  const setRole = (role: string, field: "model" | "effort", value: string | null, undo: () => void) => {
    const current = stored();

    if (current) void save({ ...current, roles: current.roles.map((each) => (each.role === role ? { ...each, [field]: value } : each)) }, undo);
  };

  const setAllowed = (id: string, on: boolean, undo: () => void) => {
    const current = stored();

    if (current) void save({ ...current, allowed: on ? [...current.allowed.filter((each) => each !== id), id] : current.allowed.filter((each) => each !== id) }, undo);
  };

  return (
    <Dialog.Root open={open()} onOpenChange={({ open }) => setOpen(open)}
      onExitComplete={() => props.onClose()}
      finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}>
    <Dialog.Positioner>
    <Dialog.Content class="models-sheet" aria-label={copy.models} ref={(element) => (panel = element)}>
      <Dialog.Title>{copy.models}</Dialog.Title>
      <Show when={failure() ?? choices.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={stored()}>
        {(current) => (
          <Show when={choices.list()}>
            {(list) => (
              <>
                <div class="models-roles">
                  <For each={current().roles}>
                    {(entry) => (
                      <div class="models-row">
                        <span class="models-role">{entry.role}</span>
                        <ModelPair
                          subject={entry.role}
                          models={list().models}
                          efforts={list().efforts}
                          model={entry.model}
                          effort={entry.effort}
                          onModel={(value, select) => setRole(entry.role, "model", value, () => (select.value = entry.model ?? ""))}
                          onEffort={(value, select) => setRole(entry.role, "effort", value, () => (select.value = entry.effort ?? ""))}
                        />
                      </div>
                    )}
                  </For>
                </div>
                <fieldset class="models-allowed">
                  <legend>{copy.doorsMayUse}</legend>
                  <p>{copy.aDoorCanStartAChildOnlyOn}</p>
                  <For each={list().models}>
                    {(model) => (
                      <label class="models-check">
                        <input
                          type="checkbox"
                          checked={current().allowed.includes(model.id)}
                          onChange={(change) => {
                            const box = change.currentTarget;

                            setAllowed(model.id, box.checked, () => (box.checked = !box.checked));
                          }}
                        />
                        <span>{model.label}</span>
                      </label>
                    )}
                  </For>
                </fieldset>
                <label class="models-check">
                  <input
                    type="checkbox"
                    checked={mcp()}
                    onChange={(change) => {
                      const box = change.currentTarget;

                      void saveMcp(box.checked, () => (box.checked = !box.checked));
                    }}
                  />
                  <span>{copy.roundupToolsOverMcp}</span>
                </label>
                <p class="models-note">{copy.aRunningAgentIsNotChanged}</p>
              </>
            )}
          </Show>
        )}
      </Show>
    </Dialog.Content>
    </Dialog.Positioner>
    </Dialog.Root>
  );
};
