import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ProjectModels } from "@contracts/project/ProjectModels";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { createChoices } from "./choices";
import { ModelPair } from "./ModelPair";
import "./styles.css";

const FOCUSABLE = "select, input, button";

/** The `Models` sheet of the open Project (U377): one row per role the Daemon returns, and the Models a Door may start a child on. `Esc` closes it and focus returns to where it opened from. */
export const ModelsSheet = (props: { onClose: () => void }) => {
  const { app, daemonExit } = useConnectedProject();
  const choices = createChoices(app);
  const [stored, setStored] = createSignal<ProjectModels | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const returnTo = document.activeElement;
  let panel: HTMLElement | undefined;

  const leave = () => {
    props.onClose();

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  };

  // Window capture runs before every other listener: while the sheet is open no key reaches a Terminal or a chord.
  const onKey = (press: KeyboardEvent) => {
    if (press.key === "Escape") {
      press.stopPropagation();
      press.preventDefault();
      leave();
    } else if (press.key === "Tab") {
      const fields = [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const at = fields.findIndex((field) => field === document.activeElement);

      press.stopPropagation();
      press.preventDefault();
      fields[(at + (press.shiftKey ? fields.length - 1 : 1)) % fields.length]?.focus();
    }
  };

  onMount(() => {
    void choices.load();
    void (async () => {
      try {
        setStored((await app.rpc("project.get", null)).models);
        queueMicrotask(() => panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
      }
    })();
  });
  window.addEventListener("keydown", onKey, true);
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

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

  const setRole = (role: string, field: "model" | "effort", value: string | null, undo: () => void) => {
    const current = stored();

    if (current) void save({ ...current, roles: current.roles.map((each) => (each.role === role ? { ...each, [field]: value } : each)) }, undo);
  };

  const setAllowed = (id: string, on: boolean, undo: () => void) => {
    const current = stored();

    if (current) void save({ ...current, allowed: on ? [...current.allowed.filter((each) => each !== id), id] : current.allowed.filter((each) => each !== id) }, undo);
  };

  return (
    <section class="models-sheet" role="dialog" aria-modal="true" aria-label="Models" ref={(element) => (panel = element)}>
      <h2>Models</h2>
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
                  <legend>Doors may use</legend>
                  <p>A Door can start a child only on a checked Model.</p>
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
                <p class="models-note">A running Agent is not changed.</p>
              </>
            )}
          </Show>
        )}
      </Show>
    </section>
  );
};
