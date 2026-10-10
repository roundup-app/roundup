import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { Message } from "@contracts/message/Message";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { sizeText, sortFiles } from "./attachment";
import type { Attachment } from "./attachment";
import { createMessageFeed } from "./feed";
import { foldedLine, fullLine, isBetweenAgents, isCard } from "./lines";
import { quotedLines, quoteOf } from "./quote";
import type { Quote } from "./quote";
import "./styles.css";

type Preview = { attachment: Attachment; left: number; top: number };

const isPrintable = (press: KeyboardEvent): boolean => press.key.length === 1 && !press.ctrlKey && !press.metaKey;

const AttachmentChip = (props: { attachment: Attachment; onPreview: (preview: Preview | null) => void; onRemove?: () => void }) => (
  <span
    class="thread-attachment"
    data-attachment={props.attachment.id}
    onMouseEnter={(hover) => {
      const box = hover.currentTarget.getBoundingClientRect();

      props.onPreview({ attachment: props.attachment, left: box.left, top: box.top });
    }}
    onMouseLeave={() => props.onPreview(null)}
  >
    {props.attachment.name} <span class="light">{sizeText(props.attachment.size)}</span>
    <Show when={props.onRemove}>
      {(remove) => (
        <button type="button" class="word" aria-label={`remove ${props.attachment.name}`} onClick={remove()}>
          <Icon name="x" />
        </button>
      )}
    </Show>
  </span>
);

/**
 * The conversation with the selected Workstream's Door: the feed of Messages (U106), and the input (U105, U109, U110).
 * `selectionOf` reads the selected Terminal's selection through the emulator the Pane owns.
 */
const ThreadBody = (props: { door: Accessor<string>; selectionOf: (terminalId: string | null) => string }) => {
  const { app, rail, events, reducedMotion } = useConnectedProject();
  const feed = createMessageFeed(app, events);
  const [expanded, setExpanded] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [quotes, setQuotes] = createSignal<readonly Quote[]>([]);
  const [attachments, setAttachments] = createSignal<readonly Attachment[]>([]);
  const [kept, setKept] = createSignal<readonly Attachment[]>([]);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [answering, setAnswering] = createSignal<{ id: number; to: string; name: string } | null>(null);
  const [typing, setTyping] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [root, setRoot] = createSignal<HTMLElement>();
  let feedElement: HTMLElement | undefined;
  let field: HTMLInputElement | undefined;
  let nextAttachment = 1;
  let fromFeed: { text: string; source: string } | null = null;
  let usedFromTerminal = "";

  const nodeIds = createMemo(() => new Set(rail.nodes.map((node) => node.id)));
  const nameOf = (id: string) => rail.nodes.find((node) => node.id === id)?.name ?? id;

  // U160: the Workstream's own row and every row below it.
  const workstreamIds = createMemo(() => {
    const ids = new Set([props.door()]);

    for (let grown = true; grown; ) {
      grown = false;

      for (const node of rail.nodes) {
        if (node.parent !== null && ids.has(node.parent) && !ids.has(node.id)) {
          ids.add(node.id);
          grown = true;
        }
      }
    }

    return ids;
  });

  const listed = (message: Message): boolean => {
    const inWorkstream = (id: string) => workstreamIds().has(id);
    const fromUser = message.from.kind === "user";

    return (inWorkstream(message.from.id) || inWorkstream(message.to)) && (fromUser || inWorkstream(message.from.id)) && (message.to === "you" || inWorkstream(message.to));
  };

  // U179: a question is answered once the user has sent a Message that replies to it.
  const answered = createMemo(() => new Set(feed.messages().filter((message) => message.from.kind === "user" && listed(message)).map((message) => message.replyTo)));

  const lines = createMemo(() =>
    feed.messages().filter(listed).map((message) => {
      const from = rail.nameOf(message.from);
      const to = nameOf(message.to);
      const card = isCard(message);
      const folded = !card && isBetweenAgents(message, nodeIds()) && !expanded();

      return {
        id: message.id,
        status: message.status,
        folded,
        card,
        from,
        fromId: message.from.id,
        kind: message.kind,
        body: message.body,
        answered: answered().has(message.id),
        text: folded ? foldedLine(from, to, message) : fullLine(from, to, message),
      };
    }),
  );

  // U179: the mark is for one Workstream's question.
  createEffect(() => {
    props.door();
    setAnswering(null);
  });

  const answer = (line: { id: number; fromId: string; from: string }) => {
    setAnswering({ id: line.id, to: line.fromId, name: line.from });
    field?.focus();
  };

  // U105: the periphery lives outside this region, so the dim is a mark on the window that the stylesheet reads.
  createEffect(() => {
    const window = root()?.closest<HTMLElement>(".window");

    if (!window) return;

    window.dataset.typing = String(typing());
    window.dataset.reducedMotion = String(reducedMotion());
  });

  onCleanup(() => {
    const window = root()?.closest<HTMLElement>(".window");

    if (window) {
      delete window.dataset.typing;
      delete window.dataset.reducedMotion;
    }
  });

  const within = (node: Node | null, ancestor: Element | undefined | null): boolean => ancestor != null && node !== null && ancestor.contains(node);

  // U110: focus moving to the input empties the document's selection, so the feed's selection is kept as it is made.
  const onSelectionChange = () => {
    const selection = document.getSelection();
    const text = selection?.toString() ?? "";
    const anchor = selection?.anchorNode ?? null;

    if (within(anchor, field)) {
      if (text !== "") fromFeed = null;
    } else if (within(anchor, feedElement)) {
      const message = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest<HTMLElement>("[data-message]");

      fromFeed = text === "" ? null : { text, source: message ? `message ${message.dataset.message}` : "thread" };
    } else if (text !== "") {
      fromFeed = null;
    }
  };

  const onEscape = (press: KeyboardEvent) => {
    if (press.key === "Escape") setPreview(null);
  };

  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keydown", onEscape);
  onCleanup(() => {
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("keydown", onEscape);
  });

  /** U110: the selection waiting in the feed or in the selected Terminal's output; each is used up by the Quote it makes. */
  const takeSelection = (): Quote | null => {
    if (fromFeed !== null) {
      const quote = quoteOf(fromFeed.text, fromFeed.source);

      fromFeed = null;

      return quote;
    }

    const node = rail.nodes.find((candidate) => candidate.id === rail.selected());
    const text = props.selectionOf(node?.terminal_id ?? null);

    if (text === "") {
      usedFromTerminal = "";

      return null;
    }

    if (text === usedFromTerminal) return null;

    usedFromTerminal = text;

    return quoteOf(text, node?.name ?? "");
  };

  const addFiles = (files: Iterable<File>) => {
    const { ok, refused } = sortFiles(files);

    if (refused.length > 0) setFailure(`${refused[0]} is not an image`);

    setAttachments((now) => [...now, ...ok.map((file) => ({ id: nextAttachment++, name: file.name, size: file.size, url: URL.createObjectURL(file) }))]);
  };

  const nothingToSend = () => value().trim() === "" && quotes().length === 0 && attachments().length === 0;

  const submit = async () => {
    if (sending()) return;

    const typed = value().trim();
    const body = [...quotes().map(quotedLines), typed].filter((part) => part !== "").join("\n");

    setTyping(false);

    if (body !== "") {
      setSending(true);

      try {
        const reply = answering();

        await app.rpc("message.send", { to: reply?.to ?? props.door(), kind: "note", body, replyTo: reply?.id ?? null });
        setAnswering(null);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);

        return;
      } finally {
        setSending(false);
      }
    }

    setFailure(null);
    setKept((now) => [...now, ...attachments()]);
    setAttachments([]);
    setQuotes([]);
    setValue("");
  };

  const onFieldKeyDown = (press: KeyboardEvent) => {
    if (press.key === "Enter") {
      press.preventDefault();
      void submit();

      return;
    }

    if (!isPrintable(press)) return;

    const quote = takeSelection();

    if (quote !== null) setQuotes((now) => [...now, quote]);
  };

  const onKeyDown: JSX.EventHandler<HTMLElement, KeyboardEvent> = (press) => {
    if (press.ctrlKey && !press.metaKey && !press.altKey && !press.shiftKey && press.code === "KeyO") {
      press.preventDefault();
      setExpanded((now) => !now);
    }
  };

  return (
    <div class="thread" ref={setRoot} onKeyDown={onKeyDown}>
      <div class="thread-feed" role="log" aria-label="thread" tabIndex={0} ref={(element) => (feedElement = element)}>
        <Index each={lines()}>
          {(line) => (
            <Show
              when={line().card}
              fallback={
                <p class="thread-line" data-message={line().id} data-status={line().status} data-folded={line().folded}>
                  {line().text}
                </p>
              }
            >
              <article class="thread-card" data-message={line().id} data-message-card={line().kind}>
                <p class="thread-card-meta">
                  {line().from} → you {line().kind} · <span data-card-status>{line().status}</span>
                </p>
                <p class="thread-card-body">{line().body}</p>
                <Show when={line().kind === "question"}>
                  <Show
                    when={!line().answered}
                    fallback={
                      <p class="thread-card-meta" data-answered>
                        answered
                      </p>
                    }
                  >
                    <button type="button" class="word thread-card-answer" onClick={() => answer(line())}>
                      answer
                    </button>
                  </Show>
                </Show>
              </article>
            </Show>
          )}
        </Index>
        <For each={kept()}>
          {(attachment) => (
            <p class="thread-line">
              <AttachmentChip attachment={attachment} onPreview={setPreview} />
            </p>
          )}
        </For>
      </div>
      <div class="thread-failure">
        <Show when={failure() ?? feed.failure()}>
          {(message) => (
            <p class="ink thread-failure-text" data-tone="red" role="alert" title={message()}>
              <Icon name="x" />
              {message()}
            </p>
          )}
        </Show>
      </div>
      <div
        class="thread-composer"
        onDragOver={(drag) => drag.preventDefault()}
        onDrop={(drop) => {
          drop.preventDefault();
          addFiles(drop.dataTransfer?.files ?? []);
        }}
      >
        <Show when={answering()}>
          {(reply) => (
            <span class="thread-answering" data-answering>
              answering {reply().name}
              <button type="button" class="word" aria-label="dismiss answer" onClick={() => setAnswering(null)}>
                <Icon name="x" />
              </button>
            </span>
          )}
        </Show>
        <For each={quotes()}>
          {(quote, index) => (
            <span class="thread-quote" data-quote title={quote.text}>
              <span class="light">{quote.source}</span> {quote.text}
              <button type="button" class="word" aria-label={`remove quote from ${quote.source}`} onClick={() => setQuotes((now) => now.filter((_, at) => at !== index()))}>
                <Icon name="x" />
              </button>
            </span>
          )}
        </For>
        <For each={attachments()}>
          {(attachment) => (
            <AttachmentChip
              attachment={attachment}
              onPreview={setPreview}
              onRemove={() => setAttachments((now) => now.filter((each) => each.id !== attachment.id))}
            />
          )}
        </For>
        <input
          ref={(element) => (field = element)}
          data-thread-input
          aria-label="message"
          value={value()}
          onInput={(input) => {
            setValue(input.currentTarget.value);
            setTyping(true);
          }}
          onKeyDown={onFieldKeyDown}
          onBlur={() => setTyping(false)}
          onPaste={(paste) => {
            const files = paste.clipboardData?.files;

            if (!files || files.length === 0) return;

            paste.preventDefault();
            addFiles(files);
          }}
        />
        <button
          type="button"
          class="word thread-send"
          aria-disabled={nothingToSend() || sending() ? true : undefined}
          onClick={() => {
            if (!nothingToSend() && !sending()) void submit();
          }}
        >
          send
        </button>
      </div>
      <Show when={preview()}>
        {(shown) => (
          <img class="thread-preview" alt={shown().attachment.name} src={shown().attachment.url} style={{ left: `${shown().left}px`, top: `${shown().top}px` }} />
        )}
      </Show>
    </div>
  );
};

/** The selected Workstream, or the nearest one above the selected row; `null` when the selection resolves to no Workstream. */
const useDoorId = (): Accessor<string | null> => {
  const { rail } = useConnectedProject();

  return createMemo(() => {
    let id = rail.selected();

    while (id !== null) {
      const found = rail.nodes.find((node) => node.id === id);

      if (found === undefined) return null;

      if (found.kind === "workstream") return found.id;

      id = found.parent;
    }

    return null;
  });
};

/** U145: the Thread exists only where there is a Workstream whose Door it talks to. */
export const Thread = (props: { selectionOf: (terminalId: string | null) => string }) => {
  const door = useDoorId();

  return <Show when={door()}>{(id) => <ThreadBody door={id} selectionOf={props.selectionOf} />}</Show>;
};
