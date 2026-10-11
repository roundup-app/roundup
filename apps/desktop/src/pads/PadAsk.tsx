import { createEffect, on, createMemo, createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { Message } from "@contracts/message/Message";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { Markdown } from "../plain/Markdown";
import { createMessageFeed } from "../thread/feed";

/** U190: the one input that asks the Pad's Scribe, and the exchange under it: the user's asks and the Scribe's replies, oldest first. */
/** Listed once a Scribe is known, so a Drawer that never asked lists no Messages. */
const Exchange = (props: { scribe: string; sent: Accessor<readonly Message[]> }) => {
  const connected = useConnectedProject();
  const feed = createMessageFeed(connected.app, connected.events);
  let list: HTMLOListElement | undefined;

  const exchange = createMemo(() => {
    const byId = new Map([...feed.messages(), ...props.sent()].map((message) => [message.id, message]));

    return [...byId.values()]
      .filter((message) =>
        message.from.kind === "user" ? message.to === props.scribe : message.from.kind === "agent" && message.from.id === props.scribe && message.to === "you",
      )
      .toSorted((a, b) => a.id - b.id);
  });

  createEffect(on(() => exchange().length, () => {
    queueMicrotask(() => {
      if (list) list.scrollTop = list.scrollHeight;
    });
  }));

  return (
    <ol class="pad-exchange" aria-label="exchange" ref={(element) => (list = element)}>
      <For each={exchange()}>
        {(message) => (
          <li>
            <span class="light">{message.from.kind === "user" ? "you" : connected.rail.nameOf(message.from)}</span>{" "}
            {message.from.kind === "user" ? message.body : <Markdown body={message.body} />}
          </li>
        )}
      </For>
    </ol>
  );
};

export const PadAsk = (props: {
  /** The Scribe's Rail id once `pad.ask` has named it. */
  scribe: Accessor<string | null>;
  /** The Message `pad.ask` returned, so the exchange shows it before its event arrives. */
  sent: Accessor<readonly Message[]>;
  /** Resolves when the call did; rejects with the Daemon's message. */
  ask: (text: string) => Promise<void>;
  failure: Accessor<string | null>;
}) => {
  const [busy, setBusy] = createSignal(false);
  let field: HTMLInputElement | undefined;

  const send = async () => {
    if (!field || busy() || field.value === "") return;

    const typed = field;
    const text = typed.value;

    setBusy(true);

    try {
      await props.ask(text);

      if (props.failure() === null) typed.value = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="pad-ask">
      <label for="pad-ask-input" class="light">
        Ask or edit this pad
      </label>
      <p>
        <input
          id="pad-ask-input"
          ref={(element) => (field = element)}
          onKeyDown={(key) => {
            if (key.key === "Enter") void send();
          }}
        />{" "}
        <button data-button="quiet" type="button" class="word" onClick={() => void send()}>
          send
        </button>
      </p>
      <Show when={props.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.scribe()}>{(scribe) => <Exchange scribe={scribe()} sent={props.sent} />}</Show>
    </div>
  );
};
