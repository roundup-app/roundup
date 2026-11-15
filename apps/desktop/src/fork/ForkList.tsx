import { createSignal, For, Show } from "solid-js";
import type { ForkColour } from "@contracts/data/ForkColour";
import type { App, ForkListed } from "../app/seam";
import { Field } from "../ui/Field";
import { RadioGroup } from "../ui/RadioGroup";
import { forkCopy } from "./copy";

type Editing = "rename" | "recolour" | null;

/** AI7152e: one Fork's row; `Rename` and `Recolour` open their editor under it, and a refusal reads there. */
const ForkRow = (props: { app: App; fork: ForkListed; colours: readonly ForkColour[]; done: () => void }) => {
  const [editing, setEditing] = createSignal<Editing>(null);
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const toggle = (next: Exclude<Editing, null>) => { setRefusal(null); setEditing(editing() === next ? null : next); };

  const run = async (action: Promise<void>) => {
    try {
      await action;
      setRefusal(null);
      setEditing(null);
      props.done();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setRefusal(error.message);
    }
  };

  return <li class="fork-row">
    <span class="fork-dot" data-colour={props.fork.colour} role="img" aria-label={props.fork.colour} />
    <span class="fork-name">{props.fork.name}</span>
    <Show when={props.fork.collides}>{holder => <span class="fork-collides">{forkCopy.collides(holder())}</span>}</Show>
    <span class="fork-actions">
      <button type="button" data-button="quiet" aria-expanded={editing() === "rename"} onClick={() => toggle("rename")}>{forkCopy.rename}</button>
      <button type="button" data-button="quiet" aria-expanded={editing() === "recolour"} onClick={() => toggle("recolour")}>{forkCopy.recolour}</button>
    </span>
    <Show when={editing() === "rename"}>
      <Field.Root class="fork-edit" invalid={refusal() !== null}>
        <Field.Label>{forkCopy.renameField(props.fork.name)}</Field.Label>
        <Field.Input type="text" value={props.fork.name} ref={element => queueMicrotask(() => { element.focus(); element.select(); })} on:keydown={event => {
          event.stopPropagation();

          if (event.key === "Enter") { event.preventDefault(); void run(props.app.forkRename(props.fork.path, event.currentTarget.value)); }

          if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
        }} />
        <Field.ErrorText>{refusal()}</Field.ErrorText>
      </Field.Root>
    </Show>
    <Show when={editing() === "recolour"}>
      <RadioGroup class="fork-swatches fork-edit" label={forkCopy.recolourField(props.fork.name)} choices={props.colours.map(value => ({ value, label: value }))} value={props.fork.colour} onValueChange={value => { if (value !== props.fork.colour) void run(props.app.forkRecolour(props.fork.path, value)); }} />
      <Show when={refusal()}><p class="fork-refusal" role="alert">{refusal()}</p></Show>
    </Show>
  </li>;
};

/** AI7152e: the Forks under `$ROUNDUP_HOME/forks`, each marked when it collides; `free` are the colours no App holds. */
export const ForkList = (props: { app: App; forks: readonly ForkListed[]; free: readonly ForkColour[]; done: () => void }) => (
  <ul class="fork-list" aria-label={forkCopy.list}>
    <For each={props.forks}>{fork => <ForkRow app={props.app} fork={fork} colours={[fork.colour, ...props.free]} done={props.done} />}</For>
  </ul>
);
