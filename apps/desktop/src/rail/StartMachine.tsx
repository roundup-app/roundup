import { Select } from "../ui/Select";
import { copy } from "./copy";

/** MC34: the start's one optional field, shown only once another Machine exists; empty leaves the pick to the Door. */
export const StartMachine = (props: { names: string[]; value: string; onChange: (name: string) => void }) => (
  <Select label={copy.startMachine} value={props.value} onValueChange={props.onChange}
    choices={[{ value: "", label: copy.startMachineAuto }, ...props.names.map(name => ({ value: name, label: name }))]} />
);
