import { OwnerMark } from "../ink/OwnerMark";
import { createEffect, createSignal, lazy, on, onCleanup, Show, Suspense } from "solid-js";
import type { Accessor } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Message } from "@contracts/message/Message";
import type { Pad } from "@contracts/pad/Pad";
import { ItemDrawer } from "../drawer/ItemDrawer";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { createFailure } from "./failure";
import { USER } from "./owner";
import { PadAsk } from "./PadAsk";
import { cutName, markedLine, wholeWord } from "./nameLine";
import { keepScribe, scribeOf, stopWhenIdle } from "./scribe";

import type { PadEditorHandle } from "./PadRichEditor";
import "./styles.css";

const PadRichEditor = lazy(() => import("./PadRichEditor"));

const PadBody = (props: {
  initial: Pad;
  pads: Accessor<readonly Pad[]>;
  onLateFailure: (message: string) => void;
}) => {
  const connected = useConnectedProject();
  const name = props.initial.name;
  const [pad, setPad] = createSignal(props.initial);
  const [shown, setShown] = createSignal(props.initial.text);
  const [origin, setOrigin] = createSignal(props.initial.text);
  const [editing, setEditing] = createSignal(false);
  const [conflictActor, setConflictActor] = createSignal<Actor | null>(null);
  const actionFailure = createFailure();
  const askFailure = createFailure();
  const [started, setStarted] = createSignal<string | null>(null);
  const scribe = () => scribeOf(props.pads().find((entry) => entry.name === name) ?? props.initial) ?? started();
  const [asked, setAsked] = createSignal<readonly Message[]>([]);
  const [deleted, setDeleted] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const [removedByMe, setRemovedByMe] = createSignal(false);
  let deleteButton: HTMLButtonElement | undefined;
  let editor: PadEditorHandle | undefined;
  let reader: HTMLDivElement | undefined;
  let pendingActor: Actor | null = null;
  let closed = false;
  let sent: string | null = null;

  /** Moves the source and its dirty/clean baseline together so a resolved change cannot remain a conflict. */
  const settle = (next: Pad) => {
    setOrigin(next.text);
    setShown(next.text);
    editor?.setText(next.text);
    setConflictActor(null);
  };

  /** The baseline always moves to the last loaded or saved text, even mid-edit, so a later dirty-check stays correct; the field itself only follows while the user is not typing, or their keystrokes would vanish. */
  const adopt = (next: Pad) => {
    setPad(next);
    setOrigin(next.text);

    if (!editing()) settle(next);
  };

  const sameContent = (left: Pad, right: Pad) =>
    left.text === right.text &&
    left.owner.kind === right.owner.kind &&
    left.owner.id === right.owner.id;

  const currentDraft = () => editor?.getText() ?? shown();

  onCleanup(
    connected.events.subscribe((event) => {
      if (event.name === "pad.changed" && event.data.name === name) pendingActor = event.actor;
    }),
  );

  createEffect(
    on(
      props.pads,
      (listed) => {
        const current = listed.find((entry) => entry.name === name);

        setDeleted(current === undefined);

        const actor = pendingActor;
        pendingActor = null;

        if (!current) {
          setConflictActor(null);

          return;
        }

        if (sameContent(current, pad())) return;

        setPad(current);

        if (currentDraft() === origin()) {
          settle(current);

          // U190: the Scribe's write to a read-only document shows its end.
          if (current.owner.kind !== "user" && actor?.kind === "agent" && actor.id === scribe()) scrollToEnd();

          return;
        }

        if (actor && actor.kind !== "user") setConflictActor(actor);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const id = scribe();

    if (id) keepScribe(id);
  });

  onCleanup(() => {
    closed = true;

    const id = scribe();

    if (id) stopWhenIdle(connected, id);

    // Closing the Drawer leaves the document like a blur does; a draft already sent stays one write.
    if (pad().owner.kind === "user" && !conflictActor() && editor && editing()) {
      const draft = editor.getText();

      if (draft !== origin() && draft !== sent) void write(draft);
    }
  });

  const scrollToEnd = () =>
    queueMicrotask(() => {
      if (reader) reader.scrollTop = reader.scrollHeight;
    });

  /** A call that fails after the Drawer closed has no ✕ line to land on, so it goes to the Shelf's. */
  const act = (work: () => Promise<void>, failure = actionFailure) =>
    failure.run(async () => {
      try {
        await work();
      } catch (thrown) {
        if (!closed || !(thrown instanceof Error)) throw thrown;

        props.onLateFailure(thrown.message);
      }
    });

  const ownedByUser = () => pad().owner.kind === "user";

  const write = (text: string) =>
    act(async () => {
      if (text !== origin()) {
        sent = text;

        try {
          adopt(await connected.app.rpc("pad.write", { name, text }));
        } catch (thrown) {
          sent = null;
          throw thrown;
        }
      }
    });

  const ask = (text: string) =>
    act(async () => {
      const asked = await connected.app.rpc("pad.ask", { name, text });

      setStarted(asked.agent);
      setAsked((known) => [...known, asked.message]);
    }, askFailure);

  const exportToFile = () =>
    act(async () => {
      const path = await connected.app.chooseSavePath(`${name}.md`);

      if (path !== null) await connected.app.rpc("pad.export", { name, path });
    });

  const remove = () =>
    act(async () => {
      await connected.app.rpc("pad.delete", { name });
      setRemovedByMe(true);
      connected.drawer.close();
    });

  const leaveField = async (typed: string) => {
    if (!editing() && typed === origin()) return;

    if (conflictActor() || typed === sent) return;

    setEditing(false);
    await write(typed);
  };

  const onChange = () => {
    sent = null;
    setEditing(true);

    if (editor?.unchanged()) settle(pad());
  };

  const onText = (text: string) => {
    setShown(text);

    if (text === origin()) settle(pad());
  };

  const onEditorBlur = (next: EventTarget | null) => {
    if (next instanceof Node && next.parentElement?.closest(".pad-rich-editor")) return;

    if (!ownedByUser()) return;

    void leaveField(currentDraft());
  };

  /** U58: a Pad opened from under its Agent is taken here, by the owner mark, as U18's click does in the Shelf. */
  const takeIt = () =>
    act(async () => {
      adopt(await connected.app.rpc("pad.setOwner", { name, owner: USER }));
    });

  const keepMine = () =>
    act(async () => {
      adopt(await connected.app.rpc("pad.write", { name, text: currentDraft() }));
      // adopt alone won't clear this while a quick refocus keeps the field dirty.
      setConflictActor(null);
    });

  const useTheirs = () => settle(pad());

  return (
    <div class="pad-body">
      <p style={markedLine}>
        <Show
          when={ownedByUser()}
          fallback={
            <button data-button="icon" type="button" class="word" style={wholeWord} aria-label="make yours" onClick={() => void takeIt()}>
              <OwnerMark owner={pad().owner} decorative />
            </button>
          }
        >
          <span style={wholeWord}><OwnerMark owner={pad().owner} decorative /></span>
        </Show>{" "}
        <span title={name} style={cutName}>
          {name}
        </span>{" "}
        <span class="light" style={wholeWord}>
          owned by {connected.rail.nameOf(pad().owner)}
        </span>
      </p>
      <Show
        when={asking()}
        fallback={
          <p style={{ "text-align": "right" }}>
            <button data-button="quiet"
              type="button"
              class="word light"
              ref={(button) => (deleteButton = button)}
              onClick={() => {
                actionFailure.clear();
                setAsking(true);
              }}
            >
              delete
            </button>{" "}
            <button data-button="quiet" type="button" class="word light" onClick={() => void exportToFile()}>
              export .md
            </button>
          </p>
        }
      >
        <p class="light">
          {`delete ${name}?  `}
          <Show when={pad().owner.kind !== "user"}>{`${connected.rail.nameOf(pad().owner)} owns it; you may delete any Pad  `}</Show>
          <Show when={currentDraft() !== origin()}>{"unsaved changes are lost  "}</Show>
          <button data-button="quiet" type="button" class="word light" onClick={() => void remove()}>
            delete
          </button>{" "}
          <button data-button="quiet"
            type="button"
            class="word light"
            ref={(button) => queueMicrotask(() => button.focus())}
            onClick={() => {
              setAsking(false);
              queueMicrotask(() => deleteButton?.focus());
            }}
          >
            keep
          </button>
        </p>
      </Show>
      <Show when={actionFailure.message()}>
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={deleted() && !removedByMe()}>
        <ErrorLine message={`pad ${name} was deleted`} />
      </Show>
      <Suspense>
        <PadRichEditor
          text={props.initial.text}
          readonly={!ownedByUser()}
          onChange={onChange}
          onText={onText}
          onBlur={onEditorBlur}
          onScroller={(element) => (reader = element)}
          onReady={(ready) => {
            editor = ready;

            // The editor loads lazily; text adopted before it was ready must still reach it.
            if (!editing()) ready.setText(origin());
          }}
        />
      </Suspense>
      <Show when={conflictActor()}>
        {(actor) => (
          <p style={markedLine}>
            <span class="light" style={wholeWord}>
              changed by {connected.rail.nameOf(actor())}
            </span>
            <button data-button="quiet"
              type="button"
              class="word"
              style={wholeWord}
              onClick={() => void keepMine()}
            >
              keep mine
            </button>
            <button data-button="quiet"
              type="button"
              class="word"
              style={wholeWord}
              onClick={useTheirs}
            >
              use theirs
            </button>
          </p>
        )}
      </Show>
      <PadAsk scribe={scribe} sent={asked} ask={ask} failure={askFailure.message} />
    </div>
  );
};

/** Body of a Pad's Drawer: the Pad is read once, as the user's Touch, after the history that last-touch line shows. */
export const PadDrawer = (props: {
  name: string;
  pads: Accessor<readonly Pad[]>;
  onLateFailure: (message: string) => void;
}) => {
  const connected = useConnectedProject();

  return (
    <ItemDrawer
      item={`pad:${props.name}`}
      read={() => connected.app.rpc("pad.read", { name: props.name })}
      sentence
      touchedBy={(event) => event.name === "pad.changed" && event.data.name === props.name}
    >
      {(pad) => (
        <PadBody
          initial={pad}
          pads={props.pads}
          onLateFailure={props.onLateFailure}
        />
      )}
    </ItemDrawer>
  );
};
