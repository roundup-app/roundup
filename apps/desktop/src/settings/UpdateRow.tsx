import { Show } from "solid-js";
import { BusyButton } from "../ui/BusyButton";
import { ReservedLine } from "../ink/ReservedLine";
import type { Program, Updates } from "../state/updates";
import { copy } from "./copy";

const shown = {
  roundup: {
    name: copy.roundup,
    button: copy.updateRoundup,
    keeps: copy.settingsAgents,
  },
  core: {
    name: copy.herdrCore,
    button: copy.updateCore,
    keeps: copy.updateKeepsTerminals,
  },
} as const;

/** U7208a: one program's name and version, whether a newer one is ready, and the button that updates it. Its failure shows below, in one line. */
export const UpdateRow = (props: { program: Program; updates: Updates }) => {
  const own = () => shown[props.program];

  const row = () => props.updates.facts()?.[props.program] ?? null;

  const caption = () => {
    const facts = row();

    return facts ? copy.updateName(own().name, facts.version) : own().name;
  };

  const state = () => {
    const ready = row()?.ready;

    if (ready) return copy.updateReady(ready, own().keeps);

    return row() ? copy.upToDate : copy.updateNotFound;
  };

  return (
    <div
      class="settings-field settings-update"
      role="group"
      aria-label={own().name}
    >
      <span class="settings-field-caption">{caption()}</span>
      <span class="settings-hint">{state()}</span>
      <Show when={row()?.ready}>
        <BusyButton
          class="settings-update-button"
          kind="quiet"
          busyLabel={copy.machineUpdating}
          busy={props.updates.running(props.program)}
          onClick={() => props.updates.update(props.program)}
        >
          {own().button}
        </BusyButton>
        <Show when={props.program === "roundup" && props.updates.progress()}>
          {(progress) => (
            <span class="settings-hint" role="status">
              {progress().stage === "installing"
                ? copy.updateInstalling
                : copy.updateDownloading(progress().downloaded, progress().total)}
            </span>
          )}
        </Show>
      </Show>
      <ReservedLine
        message={props.updates.failure(props.program)}
        dismiss={() => props.updates.dismiss(props.program)}
      />
    </div>
  );
};
