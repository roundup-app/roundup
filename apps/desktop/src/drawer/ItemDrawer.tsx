import { createResource, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Event } from "@contracts/Event";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { lastTouchLine, padTouchSentence } from "./touchLine";

/**
 * Body of a Drawer for `todo:<id>` or `pad:<name>`. It fetches `provenance.history` first and only then calls
 * `read`: the read is itself a Touch by the user, and fetching after it would show "you read" at the moment of opening.
 */
type Props<Value> = {
  item: string;
  read: () => Promise<Value>;
  /** U190: a Pad's line is a sentence in `--font-ui`; a Todo's stays the mono `last` line. */
  sentence?: boolean;
  /** U190: an Event that makes a new Touch, so the line is read again. */
  touchedBy?: (event: Event) => boolean;
  children: (value: Value) => JSX.Element;
};

export const ItemDrawer = <Value,>(props: Props<Value>) => (
  <Show when={props.item} keyed>{(_item) => <ItemDrawerBody {...props} />}</Show>
);

const ItemDrawerBody = <Value,>(props: Props<Value>) => {
  const connected = useConnectedProject();

  const [newer, setNewer] = createSignal<string | null>(null);
  let latest = 0;

  const lineOf = (history: Parameters<typeof lastTouchLine>[0]) =>
    (props.sentence ? padTouchSentence : lastTouchLine)(history, connected.rail.nameOf);

  const [loaded] = createResource(async () => {
    const history = await connected.app.rpc("provenance.history", { item: props.item });

    return { line: lineOf(history), value: await props.read() };
  });

  onCleanup(
    connected.events.subscribe((event) => {
      if (!props.touchedBy?.(event)) return;

      // Two Events can start two reads that resolve in either order; only the read started last may set the line.
      const mine = ++latest;

      // A Daemon that went away leaves the line as it was.
      void connected.app
        .rpc("provenance.history", { item: props.item })
        .then((history) => {
          if (mine === latest) setNewer(lineOf(history));
        })
        .catch(() => undefined);
    }),
  );

  return (
    <ErrorBoundary fallback={(error: Error) => {
      const [dismissed, setDismissed] = createSignal(false);

      return <ReservedLine message={!dismissed() && error.message}>
        <button data-button="quiet" type="button" onClick={() => setDismissed(true)}>Dismiss failure</button>
      </ReservedLine>;
    }}>
      <Show when={loaded()}>
        {(item) => (
          <>
            {props.children(item().value)}
            <Show when={newer() ?? item().line}>
              {(line) => (
                <p class="light" style={props.sentence ? { "font-family": "var(--font-ui)" } : { "white-space": "pre" }}>
                  {line()}
                </p>
              )}
            </Show>
          </>
        )}
      </Show>
    </ErrorBoundary>
  );
};
