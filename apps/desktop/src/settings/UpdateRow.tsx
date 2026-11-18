import { Show } from "solid-js";
import { BusyButton } from "../ui/BusyButton";
import { StatusNote } from "../ink/MountedLine";
import type { Program, Updates } from "../state/updates";
import { copy } from "./copy";
import { kindOf } from "./machineFailure";

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

const roundupFailures = new Map<string, string>(Object.entries(copy.updateFailures));

/** U7208b: roundup's failure is the catalogue's sentence for the kind the App leads it with; herdr-core's is the line it printed (U7208c). Settings shows it as a toast (U7314e). */
export const updateFailure = (updates: Updates, program: Program) => {
  const message = updates.failure(program);

  if (message === null || program === "core") return message;

  return roundupFailures.get(kindOf(message)) ?? copy.updateFailed;
};

/** U7208a: one program's name and version, whether a newer one is ready, and the button that updates it. Its download progress shows below, in one line. */
export const UpdateRow = (props: { program: Program; updates: Updates }) => {
  const own = () => shown[props.program];

  const row = () => props.updates.facts()?.[props.program] ?? null;

  const caption = () => {
    const facts = row();

    return facts ? copy.updateName(own().name, facts.version) : own().name;
  };

  /** U7208b: how far the roundup download has got, shown on the row's line while it runs. */
  const progress = () => {
    const now = props.program === "roundup" ? props.updates.progress() : null;

    if (!now) return null;

    return now.stage === "installing" ? copy.updateInstalling : copy.updateDownloading(now.downloaded, now.total);
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
          busyLabel={copy.updating}
          busy={props.updates.running(props.program)}
          onClick={() => props.updates.update(props.program)}
        >
          {own().button}
        </BusyButton>
      </Show>
      <StatusNote text={progress()} />
    </div>
  );
};
