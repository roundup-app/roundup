import { createMemo, createSignal, Errored, Loading, onCleanup, refresh, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Event } from "@contracts/Event";
import { copy } from "./copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
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
  const [failure, setFailure] = createSignal<string | null>(null);

  const lineOf = (history: Parameters<typeof lastTouchLine>[0]) =>
    (props.sentence ? padTouchSentence : lastTouchLine)(history, connected.rail.nameOf);

  const first = untrack(() => props.item);

  const loaded = createMemo(() => untrack(async () => {
    const history = await connected.app.rpc("provenance.history", { item: first });

    return { line: untrack(() => lineOf(history)), value: await untrack(props.read) };
  }));

  const refreshHistory = async () => {
    const mine = ++latest;
    const item = props.item;

    try {
      const history = await connected.app.rpc("provenance.history", { item });

      if (mine === latest) { setNewer(lineOf(history)); setFailure(null); }
    } catch (error) {
      if (mine === latest) setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  onCleanup(connected.events.subscribe((event) => {
    if (props.touchedBy?.(event)) void refreshHistory();
  }));
  onCleanup(() => { latest += 1; });

  const historyLine = dismissable(failure);

  return (
    <Errored fallback={(error, reset) => {
      const failed = error();

      return <ReservedLine message={failed instanceof Error ? failed.message : String(failed)} blocked recover={{ run: () => { refresh(loaded); reset(); }, label: copy.tryAgain }} />;
    }}>
      <Loading><Show when={loaded()}>
        {(item) => (
          <>
            {props.children(item().value)}
            <ReservedLine message={historyLine.message()} dismiss={historyLine.dismiss} recover={{ run: () => void refreshHistory(), label: copy.tryAgain }} />
            <Show when={newer() ?? item().line}>
              {(line) => (
                <p class="light" style={props.sentence ? { "font-family": "var(--font-ui)" } : { "white-space": "pre" }}>
                  {line()}
                </p>
              )}
            </Show>
          </>
        )}
      </Show></Loading>
    </Errored>
  );
};
