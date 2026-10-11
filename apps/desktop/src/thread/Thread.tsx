import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { Kind } from "@contracts/Kind";
import type { Skills } from "@contracts/agent/Skills";
import type { Message } from "@contracts/message/Message";
import { Icon } from "../ink/Icon";
import { glyphOf, hasInk } from "../ink/glyph";
import { createDoorMode } from "../state/doorMode";
import type { DoorMode } from "../state/doorMode";
import { useConnectedProject } from "../state/connectedProject";
import { sizeText, sortFiles } from "./attachment";
import type { Attachment } from "./attachment";
import { createMessageFeed } from "./feed";
import { clock, foldedBody, hasMore, isBetweenAgents, isCard, showsStatus } from "./lines";
import { quotedLines, quoteOf } from "./quote";
import type { Quote } from "./quote";
import { matching, slashQuery } from "./skills";
import type { Skill } from "@contracts/agent/Skill";
import "./styles.css";

type Item = {
  id: number;
  status: Message["status"];
  card: boolean;
  kind: Message["kind"];
  body: string;
  from: string;
  fromId: string;
  answered: boolean;
  foldable: boolean;
  folded: string;
  open: boolean;
  word: string | null;
  taken: boolean;
};

type Run = { senderKey: string; alone: boolean; asks: boolean; from: string; receiver: string | null; time: string; items: Item[] };

const Sender = (props: { run: Run }) => (
  <p class="thread-sender" data-message-sender>
    <Show when={props.run.asks}>
      <span data-message-ask>? </span>
    </Show>
    {props.run.from}
    <Show when={props.run.receiver}>{(to) => <> → {to()}</>}</Show> {props.run.time}
  </p>
);

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
const ThreadBody = (props: { door: Accessor<string>; doorMode: DoorMode; selectionOf: (terminalId: string | null) => string }) => {
  const { app, rail, events, reducedMotion, takeover } = useConnectedProject();
  const feed = createMessageFeed(app, events);
  const [expanded, setExpanded] = createSignal(false);
  const [flipped, setFlipped] = createSignal<ReadonlySet<number>>(new Set());
  const [value, setValue] = createSignal("");
  const [quotes, setQuotes] = createSignal<readonly Quote[]>([]);
  const [attachments, setAttachments] = createSignal<readonly Attachment[]>([]);
  const [kept, setKept] = createSignal<readonly Attachment[]>([]);
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [answering, setAnswering] = createSignal<{ id: number; to: string; name: string } | null>(null);
  const [typing, setTyping] = createSignal(false);
  const [root, setRoot] = createSignal<HTMLElement>();
  // U198: the list of Skills is fetched at each open and held only while open.
  const [skills, setSkills] = createSignal<{ list: readonly Skill[] } | { error: string } | null>(null);
  const [highlighted, setHighlighted] = createSignal(0);
  const [skillsOpen, setSkillsOpen] = createSignal(false);
  let dismissed = false;
  let opened = 0;
  let feedElement: HTMLElement | undefined;
  let field: HTMLTextAreaElement | undefined;
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

  // U195: a Message from the user is `queued` until it is delivered, then `taken up` until its receiver next stops working.
  const [seenQueued, setSeenQueued] = createSignal<ReadonlySet<number>>(new Set());
  const [taken, setTaken] = createSignal<ReadonlyMap<number, boolean | "over">>(new Map());

  createEffect(() => {
    const mine = feed.messages().filter((message) => message.from.kind === "user");
    const kindOf = (id: string) => rail.nodes.find((node) => node.id === id)?.status?.kind;
    const busy = (id: string) => kindOf(id) === "working" || kindOf(id) === "needs-you";

    const queued = mine.filter((message) => message.status === "pending").map((message) => message.id);
    const arrived = mine.filter((message) => message.status === "delivered" && seenQueued().has(message.id));

    if (queued.some((id) => !seenQueued().has(id))) setSeenQueued((now) => new Set([...now, ...queued]));

    const next = new Map(taken());

    for (const message of arrived) {
      const armed = next.get(message.id);

      if (armed === undefined) next.set(message.id, busy(message.to));
      else if (armed === "over") continue;
      else if (busy(message.to)) next.set(message.id, true);
      else if (armed) next.set(message.id, "over");
    }

    if (next.size !== taken().size || [...next].some(([id, armed]) => taken().get(id) !== armed)) setTaken(next);
  });

  // U195: the Door and its Subagents that work, need the user, are blocked or failed; a Door that waits says `idle`.
  const now = createMemo(() => {
    const lines: { id: string; name: string; ask: string | null; label: string; kind: Kind }[] = [];

    for (const node of rail.nodes) {
      if (!workstreamIds().has(node.id) || node.status === null || (node.kind !== "workstream" && node.kind !== "agent")) continue;

      const isDoor = node.id === props.door();
      const { kind, label } = node.status;
      const live = kind === "working" || kind === "needs-you" || kind === "blocked" || kind === "error";

      if (!live && !(isDoor && props.doorMode.running())) continue;

      lines.push({
        id: node.id,
        name: node.name,
        ask: !live || node.work === null ? null : node.work.kind === "work" ? node.work.ask : node.work.question,
        label: live ? label : "idle",
        kind,
      });
    }

    return lines.toSorted((a, b) => Number(b.id === props.door()) - Number(a.id === props.door()));
  });

  // U192: a question is answered once the user has sent a Message that replies to it.
  const answered = createMemo(() => new Set(feed.messages().filter((message) => message.from.kind === "user" && listed(message)).map((message) => message.replyTo)));

  const wordOf = (message: Message): string | null => {
    if (message.from.kind === "user" && message.status === "pending") return "queued";

    return showsStatus(message.status) ? message.status : null;
  };

  // U189: consecutive Messages from one sender are a run; a Card and a question between Agents each stand alone.
  const runs = createMemo(() => {
    const result: Run[] = [];

    for (const message of feed.messages().filter(listed)) {
      const card = isCard(message);
      const asks = !card && message.kind === "question" && isBetweenAgents(message, nodeIds());
      const last = result.at(-1);
      const from = rail.nameOf(message.from);
      const receiver = message.to === "you" || message.to === props.door() ? null : nameOf(message.to);
      const foldable = !card && isBetweenAgents(message, nodeIds()) && hasMore(message.body);

      const item: Item = {
        id: message.id,
        status: message.status,
        card,
        kind: message.kind,
        body: message.body,
        from,
        fromId: message.from.id,
        answered: answered().has(message.id),
        foldable,
        folded: foldedBody(message.body),
        open: expanded() !== flipped().has(message.id),
        word: wordOf(message),
        taken: taken().get(message.id) === true || taken().get(message.id) === false,
      };

      if (last && !card && !asks && !last.alone && last.senderKey === `${message.from.kind}:${message.from.id}` && last.receiver === receiver) {
        last.items.push(item);
        continue;
      }

      result.push({
        senderKey: `${message.from.kind}:${message.from.id}`,
        alone: card || asks,
        asks,
        from,
        receiver,
        time: clock(message.at),
        items: [item],
      });
    }

    return result;
  });

  const flip = (id: number) =>
    setFlipped((now) => {
      const next = new Set(now);

      if (!next.delete(id)) next.add(id);

      return next;
    });

  // U187: a reloaded webview opens in Thread mode, so a Takeover it left behind is ended once per Door.
  createEffect(() => void takeover.release(props.door()));

  const takeOver = async () => {
    const failed = await takeover.begin(props.door());

    if (failed !== null) setFailure(failed);
    else {
      setFailure(null);
      document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();
    }
  };

  const endTakeover = async () => {
    const failed = await takeover.end(props.door());

    if (failed !== null) setFailure(failed);
    else field?.focus();
  };

  // U192: the mark is for one Workstream's question.
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

  const rows = createMemo(() => {
    const query = slashQuery(value());
    const shown = skills();

    return query === null || shown === null || !("list" in shown) ? [] : matching(shown.list, query);
  });

  const closeSkills = () => {
    opened++;
    setSkillsOpen(false);
    setSkills(null);
  };

  // U198: the list opens when the value turns into `/` plus a name, fetches once, and closes when it stops being one.
  const syncSkills = () => {
    if (slashQuery(value()) === null) {
      dismissed = false;

      if (skillsOpen()) closeSkills();

      return;
    }

    if (skillsOpen() || dismissed) return;

    const mine = ++opened;

    setSkillsOpen(true);
    setSkills(null);
    setHighlighted(0);
    app.rpc("agent.skills", { id: props.door() }).then(
      (reply) => {
        if (mine === opened) setSkills({ list: (reply as Skills).skills });
      },
      (error: unknown) => {
        if (mine === opened) setSkills({ error: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const pick = (skill: Skill) => {
    const text = `/${skill.name} `;

    setValue(text);

    if (field) {
      field.value = text;
      field.setSelectionRange(text.length, text.length);
    }

    syncSkills();
    fit();
  };

  const nothingToSend = () => value().trim() === "" && quotes().length === 0 && attachments().length === 0;

  const submit = async () => {
    const typed = value().trim();
    const body = [...quotes().map(quotedLines), typed].filter((part) => part !== "").join("\n");
    const sentAttachments = attachments();
    const sentQuotes = quotes();

    setTyping(false);

    // U189: the field empties as the Message leaves, so a draft typed while the call is in flight is its own Message, never wiped by the earlier call's end.
    setKept((now) => [...now, ...sentAttachments]);
    setAttachments([]);
    setQuotes([]);
    setValue("");
    syncSkills();
    fit();

    if (body !== "") {
      try {
        const reply = answering();

        await app.rpc("message.send", { to: reply?.to ?? props.door(), kind: "note", body, replyTo: reply?.id ?? null });
        setAnswering(null);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
        setKept((now) => now.filter((file) => !sentAttachments.includes(file)));
        setAttachments((now) => [...sentAttachments, ...now]);
        setQuotes((now) => [...sentQuotes, ...now]);

        if (value() === "") {
          setValue(typed);
          queueMicrotask(fit);
        }

        return;
      }
    }

    setFailure(null);
  };

  // U193: the field is as tall as its lines; the stylesheet's max-height caps it and it scrolls past.
  const fit = () => {
    if (!field) return;

    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };

  const onFieldKeyDown = (press: KeyboardEvent) => {
    if (skillsOpen() && !press.isComposing) {
      const shown = rows();
      const plain = !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey;
      const move = press.key === "ArrowDown" ? 1 : press.key === "ArrowUp" ? -1 : 0;

      if (press.key === "Escape") {
        press.preventDefault();
        dismissed = true;
        closeSkills();

        return;
      }

      if (move !== 0 && shown.length > 0 && plain) {
        press.preventDefault();
        setHighlighted((now) => (now + move + shown.length) % shown.length);

        return;
      }

      const chosen = shown[highlighted()];

      if (chosen && plain && (press.key === "Enter" || press.key === "Tab")) {
        press.preventDefault();
        pick(chosen);

        return;
      }
    }

    if (press.key === "Enter") {
      if (press.isComposing || press.keyCode === 229) return;

      if (press.shiftKey && !press.metaKey && !press.ctrlKey && !press.altKey) return;

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
      setFlipped(new Set<number>());
    }
  };

  return (
    <div class="thread" data-mode={props.doorMode.mode()} ref={setRoot} onKeyDown={onKeyDown}>
      <Show when={props.doorMode.mode() === "thread"}>
        <Show when={props.doorMode.running()}>
          <button type="button" class="word thread-take-over" onClick={() => void takeOver()}>
            take over
          </button>
        </Show>
      <Show when={now().length > 0}>
        <div class="thread-now">
          <For each={now()}>
            {(line) => (
              <p class={hasInk(glyphOf(line.kind)) ? "thread-now-line ink" : "thread-now-line"} data-tone={hasInk(glyphOf(line.kind)) ? glyphOf(line.kind).tone : undefined} data-now={line.id}>
                {line.name}
                <Show when={line.ask}>{(ask) => <span class="thread-now-ask" title={ask()}>{ask()}</span>}</Show>
                <span class="thread-now-label">{line.label}</span>
              </p>
            )}
          </For>
        </div>
      </Show>
      <div class="thread-feed" role="log" aria-label="thread" tabIndex={0} ref={(element) => (feedElement = element)}>
        <Index each={runs()}>
          {(run) => (
            <Show
              when={run().items[0]!.card ? run().items[0] : undefined}
              fallback={
                <div class="thread-run">
                  <Sender run={run()} />
                  <Index each={run().items}>
                    {(line) => (
                      <p class="thread-body" data-message={line().id} data-message-body data-status={line().status}>
                        <Show when={line().foldable} fallback={line().body}>
                          <button type="button" class="thread-fold" aria-expanded={line().open} onClick={() => flip(line().id)}>
                            {line().open ? line().body : line().folded}
                          </button>
                        </Show>
                        <Show when={line().word}>
                          {(word) => (
                            <>
                              {" "}
                              <span class="thread-status" data-message-status>
                                {word()}
                              </span>
                            </>
                          )}
                        </Show>
                        <Show when={line().taken}>
                          {" "}
                          <span class="thread-status" data-message-taken>
                            taken up
                          </span>
                        </Show>
                      </p>
                    )}
                  </Index>
                </div>
              }
            >
              {(card) => (
                <article class="thread-card" data-message={card().id} data-message-card={card().kind}>
                  <Sender run={run()} />
                  <p class="thread-card-body">
                    {card().body}
                    <Show when={card().word}>
                      {(word) => (
                        <>
                          {" "}
                          <span class="thread-status" data-message-status>
                            {word()}
                          </span>
                        </>
                      )}
                    </Show>
                  </p>
                  <Show
                    when={!card().answered}
                    fallback={
                      <p class="thread-card-meta" data-answered>
                        answered
                      </p>
                    }
                  >
                    <button type="button" class="word thread-card-answer" onClick={() => answer(card())}>
                      answer
                    </button>
                  </Show>
                </article>
              )}
            </Show>
          )}
        </Index>
        <For each={kept()}>
          {(attachment) => (
            <p class="thread-body">
              <AttachmentChip attachment={attachment} onPreview={setPreview} />
            </p>
          )}
        </For>
      </div>
      </Show>
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
      <Show
        when={props.doorMode.mode() !== "takeover"}
        fallback={
          <button type="button" class="word thread-end-takeover" onClick={() => void endTakeover()}>
            end takeover
          </button>
        }
      >
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
        <Show when={skillsOpen()}>
          <div class="thread-skills" data-skills>
            <Show when={skills()} fallback={<p class="light thread-skills-note">loading Skills…</p>}>
              {(shown) => (
                <Show
                  when={"list" in shown()}
                  fallback={
                    <p class="ink thread-skills-note" data-tone="red" role="alert">
                      <Icon name="x" />
                      {(shown() as { error: string }).error}
                    </p>
                  }
                >
                  <Show
                    when={rows().length > 0}
                    fallback={<p class="light thread-skills-note">{(shown() as { list: readonly Skill[] }).list.length === 0 ? "no Skills" : "no Skill matches"}</p>}
                  >
                    <For each={rows()}>
                      {(skill, index) => (
                        <button
                          type="button"
                          tabindex="-1"
                          class="thread-skill"
                          data-skill={skill.name}
                          data-highlighted={index() === highlighted() ? "" : undefined}
                          onMouseDown={(press) => press.preventDefault()}
                          onClick={() => pick(skill)}
                        >
                          <span class="thread-skill-name">{skill.name}</span>
                          <span class="light thread-skill-description">{skill.description}</span>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              )}
            </Show>
          </div>
        </Show>
        <textarea
          ref={(element) => (field = element)}
          rows={1}
          data-thread-input
          aria-label="message"
          value={value()}
          onInput={(input) => {
            setValue(input.currentTarget.value);
            setHighlighted(0);
            syncSkills();

            // U193: a line break is not printable, so on its own it starts no dim.
            if (input.inputType !== "insertLineBreak") setTyping(true);
            fit();
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
          aria-disabled={nothingToSend() ? true : undefined}
          onClick={() => {
            if (!nothingToSend()) void submit();
          }}
        >
          send
        </button>
      </div>
      </Show>
      <Show when={preview()}>
        {(shown) => (
          <img class="thread-preview" alt={shown().attachment.name} src={shown().attachment.url} style={{ left: `${shown().left}px`, top: `${shown().top}px` }} />
        )}
      </Show>
    </div>
  );
};

/** U145: the Thread exists only where there is a Workstream whose Door it talks to. */
export const Thread = (props: { selectionOf: (terminalId: string | null) => string }) => {
  const doorMode = createDoorMode(useConnectedProject());

  return <Show when={doorMode.door()}>{(id) => <ThreadBody door={id} doorMode={doorMode} selectionOf={props.selectionOf} />}</Show>;
};
