import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { Switch } from "./Switch";
import { runChecks } from "../testing/checks";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

const u3310Fixture = () => {
  const [checked, setChecked] = createSignal(false);
  const [disabled, setDisabled] = createSignal(false);
  const [requests, setRequests] = createSignal<boolean[]>([]);
  const [commit, setCommit] = createSignal(0);

  onMount(() => {
    Object.assign(window, { __checks: runChecks });
    // A frame after each browser input acknowledges Ark's handlers and Solid's render.
    const acknowledge = () => requestAnimationFrame(() => setCommit(value => value + 1));
    const keyboard = () => { document.documentElement.dataset.keyboardFocus = "true"; };

    const pointer = () => { document.documentElement.dataset.keyboardFocus = "false"; };

    document.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", pointer);

    for (const name of ["click", "keyup", "focusin"]) document.addEventListener(name, acknowledge);
    acknowledge();
    onCleanup(() => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("pointerdown", pointer);

      for (const name of ["click", "keyup", "focusin"]) document.removeEventListener(name, acknowledge);
    });
  });

  return <main data-fixture="switch" data-commit={commit()} style="padding: var(--space-4); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3)">
    <button type="button" data-button="quiet">Before</button>
    <Switch checked={checked()} disabled={disabled()} onCheckedChange={value => setRequests(values => [...values, value])}>Auto</Switch>
    <button type="button" data-button="quiet" onClick={() => setChecked(requests().at(-1) ?? checked())}>Acknowledge</button>
    <button type="button" data-button="quiet" onClick={() => setDisabled(value => !value)}>Toggle disabled</button>
    <output aria-label="Requested changes">{JSON.stringify(requests())}</output>
  </main>;
};

render(u3310Fixture, document.getElementById("root")!);
