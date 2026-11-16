import { createResource, createSignal, For, Show } from "solid-js";
import type { Machine } from "@contracts/machine/Machine";
import { answerOf, type App } from "../app/seam";
import { Field } from "../ui/Field";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";

/** MC70: the page that lists the Machines, adds one and removes one; it is no sidebar, Rail level or dialog. */
export const MachinesSettings = (props: { app: App; project: () => string | null }) => {
  const calls = () => {
    const path = props.project();

    return path === null ? null : props.app.forProject(path);
  };

  const [listed, { mutate }] = createResource(calls, async project => await project.rpc("machine.list", null).catch((): Machine[] => []));
  const [host, setHost] = createSignal("");
  const [addFailure, setAddFailure] = createSignal<string | null>(null);
  const [rowFailure, setRowFailure] = createSignal<{ name: string; hint: string } | null>(null);

  const add = async () => {
    const name = host().trim();
    const project = calls();

    if (name === "" || project === null) return;

    try {
      mutate(await project.rpc("machine.add", { name }));
      setHost("");
      setAddFailure(null);
    } catch (error) {
      setAddFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (name: string) => {
    const project = calls();

    if (project === null || !answerOf(await props.app.ask(copy.machineRemoveQuestion(name))).accepted) return;

    try {
      mutate(await project.rpc("machine.remove", { name }));
      setRowFailure(null);
    } catch (error) {
      setRowFailure({ name, hint: error instanceof Error ? error.message : String(error) });
    }
  };

  return <>
    <ul class="settings-machines settings-rows" aria-label={copy.settingsMachines}>
      <li class="settings-machine"><span class="settings-machine-name">{copy.thisMac}</span></li>
      <For each={listed() ?? []}>{machine => <li class="settings-machine">
        <span class="settings-machine-name">{machine.name}</span>
        <span class="settings-machine-state" data-state={machine.reachable === false ? "offline" : "online"}>{machine.reachable === false ? copy.machineOffline : copy.machineOnline}</span>
        <button class="settings-machine-remove" data-button="quiet" type="button" aria-label={copy.machineRemoveLabel(machine.name)} onClick={() => void remove(machine.name)}>{copy.machineRemove}</button>
        <Show when={rowFailure()?.name === machine.name ? rowFailure() : null}>{failure => <ReservedLine message={failure().hint} dismiss={() => setRowFailure(null)} />}</Show>
      </li>}</For>
    </ul>
    <Show when={props.project() !== null} fallback={<p class="settings-hint settings-machines-note">{copy.machinesNeedProject}</p>}>
      <Field.Root class="settings-field" invalid={addFailure() !== null}>
        <Field.Label>{copy.machineAdd}</Field.Label>
        <Field.Input value={host()} spellcheck={false} autocorrect="off" autocapitalize="off" aria-label={copy.machineAdd}
          onInput={event => setHost(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void add(); } }} />
        <Field.HelperText>{copy.machineAddHint}</Field.HelperText>
        <ReservedLine message={addFailure()} dismiss={() => setAddFailure(null)} />
      </Field.Root>
    </Show>
  </>;
};
