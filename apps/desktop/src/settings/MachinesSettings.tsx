import { createMemo, createSignal, For, Show } from "solid-js";
import type { Machine } from "@contracts/machine/Machine";
import { queueFocus } from "../keys/focus";
import { answerOf, type App } from "../app/seam";
import { ReservedLine } from "../ink/ReservedLine";
import { AddMachineDialog } from "./AddMachineDialog";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { machineFailure } from "./machineFailure";

type Page = { machines: Machine[]; version: string; failure: string | null };

/** MC70: the page that lists the Machines; adding is a dialog, and it is no sidebar, Rail level or panel. */
export const MachinesSettings = (props: { app: App; project: () => string | null }) => {
  const calls = () => {
    const path = props.project();

    return path === null ? null : props.app.forProject(path);
  };

  const read = async (project: ReturnType<App["forProject"]>): Promise<Page> => {
    try {
      const { machines, version } = await project.rpc("machine.list", null);

      return { machines, version, failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { machines: [], version: "", failure: machineFailure(error, "list") };
    }
  };

  // Rereads whenever the Project changes; an add, remove or update writes the list the Daemon answers with.
  const [listed, setListed] = createSignal<Page | undefined>(async () => {
    const project = calls();

    return project === null ? undefined : await read(project);
  }, { loadingValue: undefined });

  const hosts = createMemo<string[]>(async () => {
    const project = calls();

    return project === null ? [] : await project.rpc("machine.sshHosts", null).catch((): string[] => []);
  }, { loadingValue: [] });

  const [adding, setAdding] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;

  const [updating, setUpdating] = createSignal<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = createSignal<string | null>(null);
  const [rowFailure, setRowFailure] = createSignal<{ name: string; sentence: string } | null>(null);

  const closeAdd = () => { setAdding(false); queueFocus(() => trigger?.focus({ preventScroll: true })); };

  const machines = () => listed()?.machines ?? [];

  const setMachines = (next: Machine[]) => setListed(page => ({ machines: next, version: page?.version ?? "", failure: null }));

  /** The sentence for a failure to add, or null once the Machine is on the page. */
  const add = async (name: string): Promise<string | null> => {
    const project = calls();

    if (project === null) return null;

    try {
      setMachines(await project.rpc("machine.add", { name }));

      return null;
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return machineFailure(error, "add", name);
    }
  };

  const remove = async (name: string) => {
    const project = calls();

    if (project === null || updating().has(name) || !answerOf(await props.app.ask(copy.machineRemoveQuestion(name))).accepted) return;

    // U170: busy once the answer is yes, so the button does not read Removing… while the question is open.
    setRemoving(name);

    try {
      setMachines(await project.rpc("machine.remove", { name }));
      setRowFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setRowFailure({ name, sentence: machineFailure(error, "remove", name) });
    } finally {
      setRemoving(null);
    }
  };

  /** MC75: one CLI run at a time per row; a failure shows its sentence and offers Update again. */
  const update = async (name: string) => {
    const project = calls();

    if (project === null || updating().has(name)) return;

    setUpdating(set => new Set(set).add(name));
    setRowFailure(failure => failure?.name === name ? null : failure);

    try {
      setMachines(await project.rpc("machine.update", { name }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setRowFailure({ name, sentence: machineFailure(error, "update", name) });
    } finally {
      setUpdating(set => { const next = new Set(set); next.delete(name);

 return next; });
    }
  };

  const failure = () => listed()?.failure ?? null;
  const unadded = () => hosts().filter(host => !machines().some(machine => machine.name === host));

  return <div class="settings-machines-page">
    <p class="settings-hint settings-machines-note">{copy.machinesIntro}</p>
    <ul class="settings-machines settings-rows" aria-label={copy.settingsMachines}>
      <li class="settings-machine">
        <span class="settings-machine-name">{copy.thisComputer}</span>
        <span class="settings-machine-state" data-state={failure() === null && listed() !== undefined ? "online" : "offline"}>
          <span class="settings-machine-dot" aria-hidden="true" />
          {failure() === null && listed() !== undefined ? copy.machineConnected(listed()?.version ?? "") : copy.machineNotConnected}
        </span>
        <Show when={failure()}>{sentence => <ReservedLine message={sentence()} blocked />}</Show>
      </li>
      <For each={machines()}>{machine => <li class="settings-machine">
        <span class="settings-machine-name">{machine.name}</span>
        <span class="settings-machine-state" data-state={machine.reachable === false ? "offline" : "online"}>
          <span class="settings-machine-dot" aria-hidden="true" />
          {machine.reachable === false ? copy.machineOffline : copy.machineOnline}
        </span>
        <Show when={machine.outdated === true}>
          <BusyButton kind="quiet" class="settings-machine-update" busy={updating().has(machine.name)} busyLabel={copy.updating} aria-label={copy.machineUpdateLabel(machine.name)} onClick={() => update(machine.name)}>{copy.update}</BusyButton>
        </Show>
        <BusyButton kind="quiet" class="settings-machine-remove" busy={removing() === machine.name} disabled={updating().has(machine.name)} busyLabel={copy.removing} aria-label={copy.machineRemoveLabel(machine.name)} onClick={() => void remove(machine.name)}>{copy.machineRemove}</BusyButton>
        <Show when={rowFailure()?.name === machine.name ? rowFailure() : null}>{row => <ReservedLine message={row().sentence} dismiss={() => setRowFailure(null)} />}</Show>
      </li>}</For>
    </ul>
    <Show when={listed() !== undefined && failure() === null && machines().length === 0}><p class="settings-hint settings-machines-note">{copy.noOtherMachines}</p></Show>
    <Show when={props.project() !== null} fallback={<p class="settings-hint settings-machines-note">{copy.machinesNeedProject}</p>}>
      <button ref={element => { trigger = element; }} class="settings-machines-add" data-button="add" type="button" onClick={() => setAdding(true)}>{copy.addMachine}</button>
      <AddMachineDialog open={adding()} hosts={unadded()} add={add} close={closeAdd} finalFocus={() => trigger ?? null} />
    </Show>
  </div>;
};
