import { For } from "solid-js";
import { Switch } from "../ui/Switch";
import { copy, stateLabel } from "./copy";
import { alertChoices, alertStates, appSettings } from "./preferences";
import type { saveAppSettings } from "./preferences";

/** U5232: one row of Switches per state; each Switch saves its own choice. */
export const AlertSettings = (props: { save: (patch: Parameters<typeof saveAppSettings>[0]) => void }) => (
  <For each={alertStates}>{state => <div class="settings-alert-row" role="group" aria-label={stateLabel(state)}>
    <For each={alertChoices}>{choice => <Switch checked={appSettings().stateAlerts[state][choice]}
      onCheckedChange={checked => props.save({ stateAlerts: { ...appSettings().stateAlerts, [state]: { ...appSettings().stateAlerts[state], [choice]: checked } } })}>{`${stateLabel(state)} ${copy.choiceLabels[choice]}`}</Switch>}</For>
  </div>}</For>
);
