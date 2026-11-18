import { createSignal, Show } from "solid-js";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";

/** U6249e: a failure line is Dismissible or Blocked (below). A Dismissible one lets the user recover: `dismiss` is required: the toast draws the Dismiss button from it (or, with `dismissIn: "menu"`, leaves the button to the row's context menu, whose item calls the same function). `recover` is the verb to try again, drawn as a button labelled Retry unless it names its own label; a promise its `run` returns keeps that button busy (U170). */
export type Dismissible = {
  dismiss: () => void;
  recover?: { run: () => void; label?: string | undefined } | undefined;
  dismissIn?: "menu" | undefined;
  blocked?: never;
};

/** A failure the surface cannot go on without (a startup gate, an error boundary's fallback): there is nothing to hide, so no Dismiss; the surface's own Close, when it has one, leaves it. */
export type Blocked = {
  blocked: true;
  recover?: { run: () => void; label?: string | undefined } | undefined;
  dismiss?: never;
  dismissIn?: never;
};

/** Every failure line states one of the two. */
export type Recovery = Dismissible | Blocked;

/** The Retry and Dismiss controls a failure line draws from its `Recovery`. */
export const RecoveryButtons = (props: { dismiss?: (() => void) | undefined; recover?: Recovery["recover"]; dismissIn?: Recovery["dismissIn"] }) => <>
  <Show when={props.recover}>{recover => <BusyButton kind="quiet" busyLabel={copy.retrying} onMouseDown={event => event.preventDefault()} onClick={() => recover().run()}>{recover().label ?? copy.retry}</BusyButton>}</Show>
  <Show when={props.dismiss && props.dismissIn !== "menu" ? props.dismiss : undefined}>{dismiss => <button type="button" data-button="quiet" data-dismiss-failure onMouseDown={event => event.preventDefault()} onClick={() => dismiss()()}>{copy.dismissFailure}</button>}</Show>
</>;

/** A failure that goes away with the state that caused it still has a dismissal: the user hides the current message, and a different message shows again. */
export const dismissable = (message: () => string | null | false | undefined) => {
  const [hidden, setHidden] = createSignal<string | null>(null);

  return { message: () => message() && message() !== hidden() ? message() : null, dismiss: () => setHidden(message() || null) };
};
