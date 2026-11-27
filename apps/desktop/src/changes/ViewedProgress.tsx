import { Show } from "solid-js";
import { Icon } from "../ink/Icon";
import { BusyButton } from "../ui/BusyButton";
import { copy } from "./copy";
import type { notesFor } from "./notes";

// U8010d: the viewed count; once every item is viewed and notes wait, it is the Send notes icon.
export const ViewedProgress = (props: { id: string; name: string; viewed: number; total: number; notes: ReturnType<typeof notesFor> }) => {
  const sendable = () => props.viewed === props.total && props.notes.list(props.id).length > 0 && props.notes.state(props.id).kind !== "unknown";
  const failed = () => props.notes.failure(props.id) !== null;

  return <Show when={props.total > 0}>
    <Show when={sendable()} fallback={<span class="changes-progress">{copy.viewedProgress(props.viewed, props.total)}</span>}>
      <BusyButton kind="icon" aria-label={failed() ? copy.retry : copy.sendNotesTo(props.name)} busy={props.notes.state(props.id).kind === "pending"} busyLabel={copy.sending} onClick={() => props.notes.send(props.id)}><Icon name={failed() ? "rotate-cw" : "send"} /></BusyButton>
    </Show>
  </Show>;
};
