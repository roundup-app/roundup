import { onCleanup } from "solid-js";
import { Select } from "../ui/Select";
import type { createMachines } from "../state/machines";
import { copy } from "./copy";

/** MC34: the start's one optional field, shown only once another Machine exists; empty leaves the pick to the Door. */
export const StartMachine = (props: { machines: ReturnType<typeof createMachines> }) => {
  onCleanup(() => props.machines.nameStart(""));

  return (
    <Select label={copy.startMachine} value={props.machines.start()} onValueChange={props.machines.nameStart}
      choices={[{ value: "", label: copy.startMachineAuto }, ...props.machines.names().map(name => ({ value: name, label: name }))]} />
  );
};
