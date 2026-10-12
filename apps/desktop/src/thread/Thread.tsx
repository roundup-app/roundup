import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { Kind } from "@contracts/Kind";
import type { Message } from "@contracts/message/Message";
import { Icon } from "../ink/Icon";
import { KindGlyph } from "../ink/KindGlyph";
import { Markdown } from "../plain/Markdown";
import { DigestCards, digestOf } from "../digest/DigestCard";
import { AskAnswers, askedOf, moved } from "../decisions/AskCard";
import { createDoorMode } from "../state/doorMode";
import type { DoorMode } from "../state/doorMode";
import { useConnectedProject } from "../state/connectedProject";
import { isLongPaste, pastedFiles, placeholderOf, sizeText, namesOfPaths, sortFiles } from "./attachment";
import type { Attachment } from "./attachment";
import { createMessageFeed } from "./feed";
import { imageName, imagePaths } from "./attachment";
import { clock, foldedBody, hasMore, isBetweenAgents, isCard, statusText } from "./lines";
import { DoneList } from "./DoneList";
import type { Done } from "./DoneList";
import { quotedLines, quoteOf } from "./quote";
import type { Quote } from "./quote";
import { ThreadHeader } from "./ThreadHeader";
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
  mine: boolean;
  foldable: boolean;
  folded: string;
  open: boolean;
  word: string | null;
  taken: boolean;
};

type Run = { user: boolean; senderKey: string; alone: boolean; asks: boolean; from: string; receiver: string | null; time: string; items: Item[] };

const Sender = (props: { run: Run }) => (
  <p class="thread-sender" data-message-sender>
    <Show when={props.run.asks}>
      <span data-message-ask>? </span>
    </Show>
    {props.run.from}
    <Show when={props.run.receiver}>{(to) => <> → {to()}</>}</Show> {props.run.time}
  </p>
);

/** U352: an image that cannot be read shows its file name alone. */
const MessageImage = (props: { path: string; url: string }) => {
  const [failed, setFailed] = createSignal(false);
  const name = () => imageName(props.path);

  return (
    <Show when={!failed()} fallback={<p class="thread-image-name" data-message-image-name>{name()}</p>}>
      <span class="thread-image" data-message-image>
        <img src={props.url} alt={name()} onError={() => setFailed(true)} />
      </span>
    </Show>
  );
};

/** U196, U352: a body shows two lines; `read more` is drawn only where the body has more, and `show less` folds it again. */
const ClampedBody = (props: { id: number; status: Message["status"]; word: string | null; taken: boolean; body: string; user: boolean }) => {
  const { app } = useConnectedProject();
  const [open, setOpen] = createSignal(false);
  const [cut, setCut] = createSignal(false);
  let body: HTMLElement | undefined;
  let limit = 0;

  const measure = () => {
    if (!body) return;

    if (!open()) limit = body.clientHeight;

    setCut(body.scrollHeight > limit + 1);
  };

  createEffect(() => {
    void props.body;
    queueMicrotask(measure);
  });

  const watch = (element: HTMLElement) => {
    body = element;

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);

    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  return (
    <>
      <Show
        when={digestOf(props.body)}
        fallback={
          <Show
            when={props.user}
            fallback={<Markdown class="thread-body thread-clamped" open={open()} body={props.body} id={props.id} status={props.status} ref={watch} />}
          >
            <p class="thread-body thread-clamped" data-open={open()} data-message={props.id} data-message-body data-status={props.status} ref={watch}>
              {props.body}
            </p>
          </Show>
        }
      >
        {(digest) => <DigestCards digest={digest()} />}
      </Show>
      <For each={imagePaths(props.body)}>{(path) => <MessageImage path={path} url={app.imageUrl(path)} />}</For>
      <Show when={cut() || props.word || props.taken}>
        <p class="thread-more">
          <Show when={cut()}>
            <button data-button="quiet" type="button" class="word thread-read-more" aria-expanded={open()} onClick={() => setOpen((now) => !now)}>
              {open() ? "show less" : "read more"}
            </button>
          </Show>
          <Show when={props.word}>
            {(word) => (
              <>
                {cut() ? " " : ""}
                <span class="thread-status" data-message-status>
                  {word()}
                </span>
              </>
            )}
          </Show>
          <Show when={props.taken}>
            {cut() || props.word ? " " : ""}
            <span class="thread-status" data-message-taken>
              taken up
            </span>
          </Show>
        </p>
      </Show>
    </>
  );
};

type Preview = { attachment: Attachment; left: number; top: number };

const holds = (box: DOMRect, x: number, y: number): boolean => x >= box.left && x < box.right && y >= box.top && y < box.bottom;

const isPrintable = (press: KeyboardEvent): boolean => press.key.length === 1 && !press.ctrlKey && !press.metaKey;

const AttachmentChip = (props: { attachment: Attachment; onPreview: (preview: Preview | null) => void; onRemove?: () => void }) => (
  <span
    class="thread-attachment"
    data-attachment={props.attachment.id}
    onMouseEnter={(hover) => {
      if (props.attachment.url === null) return;

      const box = hover.currentTarget.getBoundingClientRect();

      props.onPreview({ attachment: props.attachment, left: box.left, top: box.top });
    }}
    onMouseLeave={() => props.onPreview(null)}
  >
    {props.attachment.name}
    <Show when={props.attachment.size !== null}>
      {" "}
      <span class="light">{sizeText(props.attachment.size ?? 0)}</span>
    </Show>
    <Show when={props.onRemove}>
      {(remove) => (
        <button data-button="icon" type="button" class="word" aria-label={`remove ${props.attachment.name}`} onClick={remove()}>
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
  const { app, rail, events, reducedMotion, takeover, decisions, daemonExit } = useConnectedProject();
  const feed = createMessageFeed(app, events);
  const [logShown, setLogShown] = createSignal(false);
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
  const [skills, setSkills] = createSignal<{ list: readonly Skill[]; error: null } | { list: null; error: string } | null>(null);
  const [highlighted, setHighlighted] = createSignal(0);
  const [skillsOpen, setSkillsOpen] = createSignal(false);
  let dismissed = false;
  let opened = 0;
  let feedElement: HTMLElement | undefined;
  let field: HTMLTextAreaElement | undefined;
  let nextAttachment = 1;
  let fromFeed: { text: string; source: string } | null = null;
  let usedFromTerminal = "";
  let composer: HTMLElement | undefined;
  // U199: each placeholder in the field stands for the text pasted there.
  let pastes: { token: string; text: string }[] = [];
  let pasteCount = 0;

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

    // B21: the Daemon pushes a Digest to the Door; it is not from the Workstream, yet the user reads it.
    if (message.from.id === "rupd" && digestOf(message.body) !== null) return inWorkstream(message.to);

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

  const live = (kind: Kind | undefined): boolean => kind === "working" || kind === "needs-you" || kind === "blocked" || kind === "error";

  // U424: the Door and its Subagents that work, need the user, are blocked or failed; one row each, the Door first.
  const rowKeys = createMemo(
    () =>
      rail.nodes
        .filter((node) => workstreamIds().has(node.id) && (node.kind === "workstream" || node.kind === "agent") && live(node.status?.kind))
        .toSorted((a, b) => Number(b.id === props.door()) - Number(a.id === props.door()))
        .map((node) => node.id),
    [],
    { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) },
  );

  // U424: the Workstream's other Agents, from the Rail and from the Door's Digests (B21), once by name, with the newest Digest's last line and Pads.
  const done = createMemo((): Done[] => {
    const digests = new Map<string, { last: string; pads: readonly string[] }>();

    for (const message of feed.messages()) {
      if (message.from.id !== "rupd" || !listed(message)) continue;

      for (const entry of digestOf(message.body)?.entries ?? []) digests.set(entry.name, { last: entry.last.split("\n", 1)[0]!, pads: entry.pads });
    }

    const busy = new Set<string>();
    const names = new Set<string>();

    for (const node of rail.nodes) {
      if (!workstreamIds().has(node.id) || node.id === props.door() || node.kind !== "agent" || node.status === null) continue;

      if (live(node.status.kind)) busy.add(node.name);
      else names.add(node.name);
    }

    for (const name of digests.keys()) if (name !== nameOf(props.door())) names.add(name);

    return [...names].flatMap((name) => (busy.has(name) ? [] : [{ name, last: digests.get(name)?.last ?? "", pads: digests.get(name)?.pads ?? [] }]));
  });

  // U423: the oldest open `ask_user` Decision of the Workstream's Agents, and the answer focused in it.
  const asking = createMemo(() => {
    const found = decisions.open().find((each) => workstreamIds().has(each.agent) && askedOf(each) !== null);

    return found ? { decision: found, question: askedOf(found)! } : undefined;
  }, undefined, { equals: (a, b) => a?.decision.id === b?.decision.id });

  const [focus, setFocus] = createSignal<number | null>(null);

  createEffect(() => {
    const open = asking();

    setFocus(open && open.question.answers.length > 0 ? 0 : null);
  });

  const focusedAnswer = () => {
    const at = focus();

    return at === null ? undefined : asking()?.question.answers[at];
  };

  const wordOf = (message: Message): string | null => {
    if (message.from.kind === "user" && message.status === "pending") return "queued";

    return statusText(message);
  };

  // U423: a question to `you` stays a Card until the user sends its sender any Message after it.
  const needs = createMemo(() =>
    feed
      .messages()
      .filter((message) => listed(message) && isCard(message) && !feed.messages().some((each) => each.from.kind === "user" && each.to === message.from.id && each.id > message.id))
      .map((message) => ({ id: message.id, fromId: message.from.id, from: rail.nameOf(message.from), body: message.body })),
  );

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
        mine: message.from.kind === "user",
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
        user: message.from.kind === "user",
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

  // U423: while a question is open the composer is its note field; else it says whom it reaches.
  const hint = () => {
    const open = asking();

    if (!open || answering()) return `Tell ${nameOf(props.door())} · ⏎ sends`;

    const label = focusedAnswer()?.label;

    return label ? `Note for ${label}, or your own answer` : "Your own answer";
  };

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

  const addFiles = (files: Iterable<File>, dropped = false) => {
    const { ok, refused } = dropped ? { ok: [...files], refused: [] } : sortFiles(files);

    if (refused.length > 0) setFailure(`${refused[0]} is not an image`);

    setAttachments((now) => [...now, ...ok.map((file) => ({ id: nextAttachment++, name: file.name, size: file.size, url: URL.createObjectURL(file) }))]);
  };

  // U199, U420: a native drop of any path is reported by the App seam, inside the composer's rectangle only.
  void app.onFileDrop((drop) => {
    const box = composer?.getBoundingClientRect();

    if (drop.phase !== "drop" || drop.paths.length === 0) return;

    if (!box || !holds(box, drop.x, drop.y)) {
      // U415: a drop no one takes was meant for the composer and says so; the Shelf, a Drawer and the Terminal pane (a Takeover or an Agent) take theirs or none and say nothing.
      const quiet = [".shelf", ".drawer", props.doorMode.mode() !== "thread" ? ".pane-body" : ""].some(
        (selector) => selector !== "" && [...document.querySelectorAll(selector)].some((element) => holds(element.getBoundingClientRect(), drop.x, drop.y)),
      );

      if (!quiet) setFailure("couldn't place the drop");

      return;
    }

    setAttachments((now) => [...now, ...namesOfPaths(drop.paths).map((name) => ({ id: nextAttachment++, name, size: null, url: null }))]);
  }).then((stop) => {
    if (closed) stop();
    else unlistenDrop = stop;
  });

  let unlistenDrop: (() => void) | undefined;
  let closed = false;

  onCleanup(() => {
    closed = true;
    unlistenDrop?.();
  });

  const insertAtCaret = (text: string) => {
    if (!field) return;

    field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
    setValue(field.value);
    setTyping(true);
    syncSkills();
    fit();
  };

  const pasteText = (text: string) => {
    if (!isLongPaste(text)) return insertAtCaret(text);

    const token = placeholderOf(++pasteCount, text);

    pastes.push({ token, text });
    insertAtCaret(token);
  };

  const fullText = (text: string): string => pastes.reduce((result, paste) => result.split(paste.token).join(paste.text), text);

  const rows = createMemo(() => {
    const query = slashQuery(value());
    const shown = skills();

    return query === null || shown === null || shown.list === null ? [] : matching(shown.list, query);
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
    void fetchSkills(mine);
  };

  const fetchSkills = async (mine: number) => {
    try {
      const { skills: list } = await app.rpc("agent.skills", { id: props.door() });

      if (mine === opened) setSkills({ list, error: null });
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (mine === opened) setSkills({ list: null, error: error.message });
    }
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

  const nothingToSend = () => (asking() && !answering() ? focusedAnswer() === undefined && value().trim() === "" : value().trim() === "" && quotes().length === 0 && attachments().length === 0);

  // U423: the field sends the open question's focused answer and its note.
  const answerQuestion = async (id: string) => {
    const typed = fullText(value().trim());
    const label = focusedAnswer()?.label ?? null;

    if (label === null && typed === "") return;

    await decisions.answer(id, label, typed.slice(0, 2000));

    if (decisions.answerFailure(id) === null) {
      setValue("");
      pastes = [];
      pasteCount = 0;
      setTyping(false);
      fit();
    }
  };

  const submit = async () => {
    const open = asking();

    // U423: a Message Card's answer mark claims the field over an open Decision.
    if (open && !answering()) return answerQuestion(open.decision.id);

    const typed = value().trim();
    const sentPastes = pastes;
    const sentCount = pasteCount;
    const body = [...quotes().map(quotedLines), fullText(typed)].filter((part) => part !== "").join("\n");
    const sentAttachments = attachments();
    const sentQuotes = quotes();

    setTyping(false);

    // U189: the field empties as the Message leaves, so a draft typed while the call is in flight is its own Message, never wiped by the earlier call's end.
    setKept((now) => [...now, ...sentAttachments]);
    setAttachments([]);
    setQuotes([]);
    setValue("");
    pastes = [];
    pasteCount = 0;
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
          pastes = sentPastes;
          pasteCount = sentCount;
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

    const open = asking();

    if (open && !skillsOpen() && !press.isComposing && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && !value().includes("\n")) {
      const next = moved(open.question.answers.length, focus(), press.key);

      if (next !== undefined) {
        press.preventDefault();
        setFocus(next);

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

    // U199: a placeholder is one unit, so `⌫` at its end removes all of it.
    if (press.key === "Backspace" && field && field.selectionStart === field.selectionEnd) {
      const caret = field.selectionStart;
      const hit = pastes.find((paste) => field!.value.slice(0, caret).endsWith(paste.token));

      if (hit) {
        press.preventDefault();
        field.setRangeText("", caret - hit.token.length, caret, "end");
        setValue(field.value);
        fit();

        return;
      }
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
      <Show when={props.doorMode.mode() !== "agent"}>
        <Show when={rail.nodes.find((node) => node.id === props.door())}>
          {(node) => (
            <ThreadHeader
              node={node()}
              taken={props.doorMode.mode() === "takeover"}
              running={props.doorMode.running()}
              onToggle={() => void (props.doorMode.mode() === "takeover" ? endTakeover() : takeOver())}
              messages={props.doorMode.mode() === "thread" ? { shown: logShown(), toggle: () => setLogShown((now) => !now) } : null}
            />
          )}
        </Show>
      </Show>
      <Show when={props.doorMode.mode() === "thread"}>
      <div class="thread-feed thread-column" role="log" aria-label="thread" tabIndex={0} ref={(element) => (feedElement = element)}>
        <Show when={asking()}>
          {(open) => (
            <section class="thread-question" data-question={open().decision.id} aria-label={`Question from ${nameOf(open().decision.agent)}`}>
              <p class="decision-title ink" data-tone="amber">
                {nameOf(open().decision.agent)} asks
              </p>
              <Markdown class="decision-question" body={open().question.question} />
              <AskAnswers
                question={open().question}
                stuck={() => daemonExit() !== null || decisions.answering(open().decision.id)}
                focus={focus}
                setFocus={setFocus}
                onKeyDown={(press) => {
                  const next = moved(open().question.answers.length, focus(), press.key);

                  if (next === undefined) return;

                  press.preventDefault();
                  setFocus(next);
                }}
              />
            </section>
          )}
        </Show>
        <For each={needs()}>
          {(need) => (
            <article class="thread-card" data-need={need.id}>
              <p class="thread-sender" data-need-sender>
                {need.from}
              </p>
              <div class="thread-card-body">
                <Markdown class="thread-card-text" body={need.body} />
              </div>
              <button data-button="quiet" type="button" class="word thread-card-answer" onClick={() => answer({ id: need.id, fromId: need.fromId, from: need.from })}>
                answer
              </button>
            </article>
          )}
        </For>
        <Show when={rowKeys().length > 0}>
          <div class="thread-rows">
            <For each={rowKeys()}>
              {(id) => {
                const node = () => rail.nodes.find((each) => each.id === id)!;

                return (
                  <p class="thread-row" data-now={id} data-kind={node().status?.kind} title={node().name}>
                    <KindGlyph kind={node().status!.kind} />
                    <span class="thread-row-name">{node().name}</span>
                  </p>
                );
              }}
            </For>
          </div>
        </Show>
        <DoneList done={done()} />
        <Show when={logShown()}>
          <section class="thread-log" data-log aria-label="All messages">
          <Index each={runs()}>
            {(run) => (
              <Show
                when={run().items[0]!.card ? run().items[0] : undefined}
                fallback={
                  <div class="thread-run" data-user={run().user ? "" : undefined}>
                    <Sender run={run()} />
                    <Index each={run().items}>
                      {(line) => (
                        <Show
                          when={line().foldable}
                          fallback={<ClampedBody id={line().id} status={line().status} word={line().word} taken={line().taken} body={line().body} user={line().mine} />}
                        >
                          <p class="thread-body" data-message={line().id} data-message-body data-status={line().status}>
                            <button data-button="quiet" data-reads="text" type="button" class="thread-fold" aria-expanded={line().open} onClick={() => flip(line().id)}>
                              {line().open ? line().body : line().folded}
                            </button>
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
                          <For each={imagePaths(line().body)}>{(path) => <MessageImage path={path} url={app.imageUrl(path)} />}</For>
                        </Show>
                      )}
                    </Index>
                  </div>
                }
              >
                {(card) => (
                  <article class="thread-card" data-message={card().id} data-message-card={card().kind}>
                    <Sender run={run()} />
                    <div class="thread-card-body">
                      <Markdown class="thread-card-text" body={card().body} />
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
                    </div>
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
          </section>
        </Show>
      </div>
      </Show>
      <div class="thread-failure thread-column">
        <Show when={failure() ?? feed.failure() ?? (asking() ? decisions.answerFailure(asking()!.decision.id) : null)}>
          {(message) => (
            <p class="ink thread-failure-text" data-tone="red" role="alert" title={message()}>
              <Icon name="x" />
              {message()}
            </p>
          )}
        </Show>
      </div>
      <Show when={props.doorMode.mode() !== "takeover"}>
      <div
        class="thread-composer thread-column"
        ref={(element) => (composer = element)}
        onDragOver={(drag) => drag.preventDefault()}
        onDrop={(drop) => {
          drop.preventDefault();
          addFiles(drop.dataTransfer?.files ?? [], true);
        }}
      >
        <Show when={answering()}>
          {(reply) => (
            <span class="thread-answering" data-answering>
              answering {reply().name}
              <button data-button="icon" type="button" class="word" aria-label="dismiss answer" onClick={() => setAnswering(null)}>
                <Icon name="x" />
              </button>
            </span>
          )}
        </Show>
        <For each={quotes()}>
          {(quote, index) => (
            <span class="thread-quote" data-quote title={quote.text}>
              <span class="light">{quote.source}</span> {quote.text}
              <button data-button="icon" type="button" class="word" aria-label={`remove quote from ${quote.source}`} onClick={() => setQuotes((now) => now.filter((_, at) => at !== index()))}>
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
                  when={shown().error === null}
                  fallback={
                    <p class="ink thread-skills-note" data-tone="red" role="alert">
                      <Icon name="x" />
                      {shown().error}
                    </p>
                  }
                >
                  <Show when={rows().length > 0} fallback={<p class="light thread-skills-note">{shown().list?.length === 0 ? "no Skills" : "no Skill matches"}</p>}>
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
          aria-label={hint()}
          placeholder={hint()}
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
            const files = pastedFiles(paste.clipboardData);
            const text = paste.clipboardData?.getData?.("text/plain") ?? "";

            if (files.length > 0) {
              paste.preventDefault();
              addFiles(files);

              if (text !== "") pasteText(text);

              return;
            }

            if (!isLongPaste(text)) return;

            paste.preventDefault();
            pasteText(text);
          }}
        />
        <button data-button="quiet"
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
          <img class="thread-preview" alt={shown().attachment.name} src={shown().attachment.url ?? undefined} style={{ left: `${shown().left}px`, top: `${shown().top}px` }} />
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
