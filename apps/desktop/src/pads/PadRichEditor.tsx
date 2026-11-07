import { anchorBox } from "../ui/anchorBox";
import { animate } from "motion";
import { createReducedMotion, ReducedMotionContext } from "../app/reducedMotion";
import Highlighter from "lucide-solid/icons/highlighter";
import Check from "lucide-solid/icons/check";
import { isFocusVisible, trackFocusVisible } from "@zag-js/focus-visible";
import { Tip } from "../ui/Tip";
import { Menu } from "../ui/Menu";
import { DrawerExpandContext } from "../drawer/DrawerHost";
import { registerKeys } from "../keys/registry";
import { CHORDS, chordsOf } from "../keys/chords";
import { clearTextInCurrentBlockCommand, toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand, createCodeBlockCommand } from "@milkdown/kit/preset/commonmark";
import { captureFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, Show, createUniqueId, onCleanup, onMount, splitProps, useContext } from "solid-js";
import { Portal } from "solid-js/web";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import type { BlockEditFeatureConfig } from "@milkdown/crepe/feature/block-edit";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { linkPreviewTooltip } from "@milkdown/kit/component/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { padFormatMarkdown, padCallout, padColour, padHighlight, calloutKinds, padColours } from "./padFormats";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { codeColours } from "./codeColours";
import { table } from "@milkdown/crepe/feature/table";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { $prose } from "@milkdown/kit/utils";
import { trailingConfig } from "@milkdown/kit/plugin/trailing";
import type { Node as DocumentNode } from "@milkdown/kit/prose/model";
import { type EditorState, Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { sourceForDocument } from "./sourceForDocument";
import { visualBlocks } from "./visualBlocks";
import { agentDetailsRemark, agentDetailsNode, agentDetailsView } from "./agentDetails";
import { headingFolds } from "./headingFolds";
import { visualKinds } from "./visualKinds";
import "./editor.css";
import "../ui/reading.styles.css";

export type PadEditorHandle = {
  /** null pauses saving because the edited blocks cannot be mapped to authored source. */
  getText(): string | null;
  setText(text: string): void;
  focus(): void;
  snapshot(): { source: string; text: string; document: string; trailingCaret: boolean };
  /** Restores a native document without changing its source baseline or focus; false means invalid data. */
  restoreDocument(document: string, trailingCaret: boolean): boolean;
  /** Endpoints are ProseMirror document positions; restoration changes no focus. */
  selection(): { start: number; end: number; direction: "forward" | "backward" | "none" };
  restoreSelection(selection: { start: number; end: number; direction: "forward" | "backward" | "none" }): void;
  /** T27: brings the first heading whose text is `heading` (case, whitespace runs and leading `#` ignored, as P15 reads it) to the top of the view. */
  scrollToHeading(heading: string): void;
  /** The document equals the one last loaded, whatever Markdown it would serialize to. */
  unchanged(): boolean;
};

const topBarNames = new Map(Object.entries({
  "bold": copy.bold,
  "italic": copy.italic,
  "code": copy.inlineCode,
  "bullet-list": copy.bulletList,
  "ordered-list": copy.numberedList,
  "task-list": copy.checklist,
  "link": copy.link,
  "code-block": copy.codeBlock,
  "quote": copy.quote,
  "table": copy.table,
}));

/** U4698b: the toolbar is these eleven formats; Crepe's other items (strikethrough, rule) are removed before it renders. */
const toolbarKeys = new Set(["heading-selector", "bold", "italic", "code", "link", "bullet-list", "ordered-list", "task-list", "quote", "code-block", "table"]);

const toolbarCommands = [
  { key: "bold", action: CHORDS["terminal.switch"], label: copy.bold, command: toggleStrongCommand },
  { key: "italic", action: CHORDS["editor.italic"], label: copy.italic, command: toggleEmphasisCommand },
  { key: "quote", action: CHORDS["editor.quote"], label: copy.quote, command: wrapInBlockquoteCommand },
  { key: "bullet-list", action: CHORDS["editor.bullet-list"], label: copy.bulletList, command: wrapInBulletListCommand },
  { key: "ordered-list", action: CHORDS["editor.numbered-list"], label: copy.numberedList, command: wrapInOrderedListCommand },
  { key: "code-block", action: CHORDS["editor.code-block"], label: copy.codeBlock, command: createCodeBlockCommand, clearTextInCurrentBlockCommand },
  { key: "code", action: CHORDS["editor.inline-code"], label: copy.inlineCode, command: toggleInlineCodeCommand },
];

const normalHeading = (text: string) => text.replace(/^#+/, "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** U147: the Pad's one surface. `readonly` prevents editing unavailable content; `onChange` fires on every document change the user makes, `onText` follows with the settled Markdown. */
type EditorProps = {
  item?: "pad" | "todo";
  autofocus?: boolean;
  label?: string;
  initialFocus?: ReturnType<typeof captureFocus> | undefined;
  text: string;
  readonly: boolean;
  onChange: () => void;
  onText: (text: string) => void;
  onBlur: (next: EventTarget | null) => void;
  onReady: (editor: PadEditorHandle) => void;
  toolbar?: import("solid-js").JSX.Element;
  onSelection?: () => void;
};

/** U6249d E2: an editor that fails to open is mounted once more before its failure shows; a save is a mutation and never repeats. */
export default function PadRichEditor(props: EditorProps) {
  const [attempt, setAttempt] = createSignal(0);

  return <Show when={[attempt()]} keyed>{([count]) => <MountedEditor {...props} remount={count === 0 ? () => setAttempt(1) : undefined} />}</Show>;
}

function MountedEditor(props: EditorProps & { remount: (() => void) | undefined }) {
  const mountExpand = useContext(DrawerExpandContext);
  const [toolbarHost, setToolbarHost] = createSignal<HTMLElement>();
  const menuId = createUniqueId();
  const colourTriggerId = createUniqueId();
  const [paletteMotion, setPaletteMotion] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [palettePresent, setPalettePresent] = createSignal(false);
  const [paletteContent, setPaletteContent] = createSignal<HTMLElement>();
  const [palettePositioned, setPalettePositioned] = createSignal(false);
  const reduced = useContext(ReducedMotionContext) ?? (window.matchMedia ? createReducedMotion(query => window.matchMedia(query)) : () => true);
  let paletteAnimation: ReturnType<typeof animate> | undefined;
  let previousPalette: HTMLElement | undefined;

  createEffect(() => {
    const open = paletteOpen();
    const element = paletteContent();
    const animated = paletteMotion();
    const reduce = reduced();
    const positioned = palettePositioned();
    paletteAnimation?.stop();
    paletteAnimation = undefined;

    if (!element?.isConnected) return;

    if (animated && open && !positioned) {
      if (element !== previousPalette) element.style.opacity = "0";

      return;
    }

    const entering = element !== previousPalette;
    previousPalette = element;

    if (!animated) {
      element.style.opacity = open ? "1" : "0";
      element.style.transform = "none";

      if (!open) setPalettePresent(false);

      return;
    }

    const tokens = getComputedStyle(element);
    const scale = tokens.getPropertyValue("--scale-menu").trim();
    const duration = tokens.getPropertyValue(reduce ? "--duration-reduced" : open ? "--duration-menu-in" : "--duration-menu-out");
    const curve = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];
    const ease: [number, number, number, number] = [Number(curve[0]), Number(curve[1]), Number(curve[2]), Number(curve[3])];
    const opacity = [entering ? 0 : Number(tokens.opacity), open ? 1 : 0];

    if (reduce) element.style.transform = "none";
    const frames = reduce ? { opacity } : { opacity, transform: [entering ? `scale(${scale})` : tokens.transform, open ? "scale(1)" : `scale(${scale})`] };
    const animation = animate(element, frames, { duration: parseFloat(duration) / 1000, ease });
    paletteAnimation = animation;
    void animation.then(() => { if (paletteAnimation === animation && !paletteOpen()) setPalettePresent(false); });
  });
  onCleanup(() => paletteAnimation?.stop());
  let menuObserver: MutationObserver | undefined;
  let host: HTMLDivElement | undefined;
  let menuHost: HTMLDivElement | undefined;
  let crepe: CrepeBuilder | undefined;
  let created: ReturnType<CrepeBuilder["create"]> | undefined;
  const caretNodes = new WeakSet<DocumentNode>();
  let original = props.text;
  let applying = false;
  let closed = false;

  // The restored selection, kept until the user's first input: Chromium may still hand ProseMirror the caret it adopted at focus.
  let restored: { start: number; end: number; direction: "forward" | "backward" | "none" } | null = null;
  let restoreAgain = () => {};

  let ready = false;
  let topBarItems: { label: string; keys: string | undefined }[] = [];
  const [commandState, setCommandState] = createSignal<EditorState>();

  const highlighted = createMemo(() => {
    const state = commandState();

    return !props.label && state && crepe ? crepe.editor.action(ctx => {
      const { doc, selection } = state;

      return doc.rangeHasMark(selection.from, selection.to, padHighlight.type(ctx));
    }) : false;
  });

  const currentColour = createMemo(() => {
    const state = commandState();

    return !props.label && state && crepe ? crepe.editor.action(ctx => {
      const { doc, selection, storedMarks } = state;
      const type = padColour.type(ctx);
      const colours = new Set<string>();

      if (selection.empty) colours.add(type.isInSet(storedMarks ?? selection.$from.marks())?.attrs.colour ?? "default");
      else doc.nodesBetween(selection.from, selection.to, node => {
        if (node.isText) colours.add(type.isInSet(node.marks)?.attrs.colour ?? "default");
      });

      return colours.size === 1 ? [...colours][0] : undefined;
    }) : "default";
  });

  const [failure, setFailure] = createSignal<string | null>(null);

  onMount(() => {
    onCleanup(trackFocusVisible());
    const focus = props.initialFocus ?? captureFocus();

    if (!host || !menuHost) throw new Error(copy.padEditorHostIsMissing);

    // SAFETY: Crepe recursively partials HTMLElement in its root type; the supported root is a real DOM element.
    const blockConfig = {
      blockHandle: {
        getOffset: () => 0,
        // Nested node bounds can remain over another list after scrolling; keep controls outside the reading column.
        getPosition: ({ active, editorDom }) => {
          const editor = anchorBox(editorDom);
          const block = anchorBox(active.el) ?? editor;

          return new DOMRect(editor?.left ?? 0, block?.top ?? 0, 0, block?.height ?? 0);
        },
        root: menuHost,
      },
      slashMenu: { root: menuHost },
      textGroup: { divider: null },
      buildMenu: builder => {
        if (props.item === "todo") return;
        const group = builder.addGroup("callouts", copy.callouts);

        for (const kind of calloutKinds) group.addItem(kind, {
          label: kind, icon: "!", onRun: (ctx: import("@milkdown/kit/ctx").Ctx) => {
            ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
            const view = ctx.get(editorViewCtx);
            const start = view.state.selection.$from.before();
            const type = padCallout.type(ctx);
            const body = view.state.schema.nodes.paragraph!.create();
            const tr = view.state.tr.replaceSelectionWith(type.create({ kind }, body));
            tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)));
            view.dispatch(tr.scrollIntoView());
            view.focus();
          },
        });

        for (const shortcut of [false, true]) builder.getGroup("advanced").addItem(shortcut ? "for-agents" : "toggle", {
          label: shortcut ? copy.forAgents : copy.toggle,

          icon: "",
          onRun: (ctx) => {
            const view = ctx.get(editorViewCtx);
            ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
            const { $from } = view.state.selection;
            const tr = view.state.tr;
            let found: number | undefined;
            view.state.doc.forEach((node, pos) => {
              if (shortcut && node.type.name === "pad_agent_details" && /^<details>\s*<summary>For Agents<\/summary>/.test(node.textContent)) found = pos;
            });
            const label = shortcut ? copy.forAgents : copy.toggle;
            let at = found ?? (shortcut ? view.state.doc.content.size : $from.before());

            if (found === undefined) {
              const node = agentDetailsNode.type(ctx).create(null, view.state.schema.text(`<details>\n<summary>${label}</summary>\n\n\n\n</details>`));
              tr.insert(at, node);
            }

            if ($from.parent.type.name === "paragraph" && $from.parent.content.size === 0) tr.delete(tr.mapping.map($from.before()), tr.mapping.map($from.after(), -1));
            at = tr.mapping.map(at, -1);
            view.dispatch(tr);
            const section = view.nodeDOM(at);

            if (section instanceof HTMLDetailsElement) {
              section.open = true;
              section.querySelector<HTMLElement>(shortcut ? "textarea" : "input")?.focus();
            }
          },
        });
      },
    } as BlockEditFeatureConfig;

    crepe = new CrepeBuilder({
      root: host,
      defaultValue: props.text,
    })
      .setReadonly(props.readonly)
      .addFeature(blockEdit, blockConfig)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(placeholder)
      .addFeature(table)
      .addFeature(topBar, {
        buildTopBar: (builder) => {
          for (const group of builder.build()) group.items = group.items.filter((item) => toolbarKeys.has(item.key));

          topBarItems = builder.build().flatMap((group) =>
            group.items
              .filter((item) => item.key !== "heading-selector")
              .map((item) => {
                const label = topBarNames.get(item.key);

                if (!label) throw new Error(copy.padEditorToolbarActionHasNoName(item.key));

                return { label, keys: toolbarCommands.find(command => command.key === item.key)?.action.keys };
              }),
          );
        },
        headingOptions: [
          { label: copy.text, level: null },
          { label: copy.headingOne, level: 1 },
          { label: copy.headingTwo, level: 2 },
          { label: copy.headingThree, level: 3 },
        ],
      });

    crepe.editor.config((ctx) => {
      // Hovering a link while selecting text must not open a floating preview; the fixed bar still edits links.
      ctx.update(linkPreviewTooltip.key, (options) => ({ ...options, props: { ...options.props, handleDOMEvents: {} } }));
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const }));
      ctx.update(trailingConfig.key, (options) => ({
        ...options,
        getNode: (state) => {
          const node = options.getNode(state);
          caretNodes.add(node);

          return node;
        },
      }));
    });

    crepe.editor.use(
      $prose(
        () =>
          new Plugin({
            props: {
              decorations(state) {
                const empty: Decoration[] = [];

                // ProseMirror adds caret-supporting DOM breaks even to empty code.
                state.doc.descendants((node, pos) => {
                  if (node.isTextblock && node.content.size === 0)
                    empty.push(Decoration.node(pos, pos + node.nodeSize, { "data-pad-empty": "true" }));
                });

                return DecorationSet.create(state.doc, empty);
              },
            },
            view: () => ({
              update: (view, previous) => {
                if (view.state !== previous) setCommandState(view.state);

                if (!applying && !closed && !view.state.doc.eq(previous.doc)) {
                  restored = null;
                  props.onChange();
                } else if (!applying && !closed && restored && !view.state.selection.eq(previous.selection) && !view.composing) restoreAgain();
                else if (!applying && !closed && !view.state.selection.eq(previous.selection)) props.onSelection?.();
              },
            }),
          }),
      ),
    );

    if (!props.label) {
      crepe.editor.use(padFormatMarkdown).use(padCallout).use(padHighlight).use(padColour);
      crepe.editor.use($prose(() => codeColours()));
      crepe.editor.use(agentDetailsRemark).use(agentDetailsNode).use(agentDetailsView);
      crepe.editor.use($prose(headingFolds));
    }

    crepe.editor.use($prose(() => visualBlocks(visualKinds(), () => props.readonly)));

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (applying || closed) return;

        props.onText(markdown);
      });
    });

    registerKeys({ kind: "region", element: () => host }, toolbarCommands.map(({ action, label, command }) => ({
      action,
      chords: chordsOf(action, action.keys.includes("⌥") ? "code" : "key"),
      capture: focus => {
        commandState();

        if (!ready || closed || !crepe) return { available: () => false, invoke: () => {}, label };

        return crepe.editor.action(ctx => {
          const view = ctx.get(editorViewCtx);
          const { doc, selection } = view.state;
          const run = ctx.get(commandsCtx).get(command.key)();

          return {
            label,
            available: () => !closed && !props.readonly && !!focus && host?.contains(focus) === true
              && document.activeElement === focus && view.state.doc.eq(doc) && view.state.selection.eq(selection)
              && run(view.state),
            invoke: () => { run(view.state, view.dispatch, view); },
          };
        });
      },
    })));

    created = crepe.create();
    void created.then(() => {
      if (closed || !host || !crepe) return;

      const field = host.querySelector<HTMLElement>(".ProseMirror");

      if (!field) throw new Error(copy.padEditorDidNotOpen);

      const toolbar = host.querySelector<HTMLElement>(".milkdown-top-bar") ?? undefined;

      const buttons = host.querySelectorAll<HTMLButtonElement>(".milkdown-top-bar .top-bar-item");

      if (buttons.length !== topBarItems.length) throw new Error(copy.padEditorToolbarChanged);

      buttons.forEach((button, index) => {
        const item = topBarItems[index];

        if (!item) throw new Error(copy.padEditorToolbarLabelIsMissing);

        button.setAttribute("aria-label", item.label);
        button.title = item.keys ? `${item.label} (${item.keys})` : item.label;
      });

      const selectors = host.querySelectorAll<HTMLButtonElement>(".milkdown-top-bar .top-bar-heading-button");
      const heading = selectors[0];

      if (heading) {
        heading.setAttribute("aria-label", copy.heading);
        heading.title = copy.heading;
      }

      // Label Crepe's controls before mounting ours into the same toolbar.
      setToolbarHost(toolbar);
      mountExpand?.(toolbar);

      field.setAttribute("role", "textbox");
      field.setAttribute("aria-label", props.label ?? copy.padBody);
      field.setAttribute("aria-multiline", "true");

      // Crepe owns navigation; mirror its rendered selection without intercepting keys.
      const updateMenu = () => {
        const menu = menuHost?.querySelector(".milkdown-slash-menu");
        const list = menu?.querySelector(".menu-groups");
        const shown = menu?.getAttribute("data-show") === "true";
        const items = list?.querySelectorAll<HTMLElement>("li[data-index]");
        let active: string | undefined;

        if (list) {
          list.id = menuId;
          list.setAttribute("role", "listbox");
          list.setAttribute("aria-label", copy.blocks);
          list.querySelectorAll("ul").forEach((group) => group.setAttribute("role", "presentation"));
        }

        items?.forEach((item) => {
          item.id = `${menuId}-${item.dataset.index}`;
          item.setAttribute("role", "option");
          const selected = item.classList.contains("hover");

          item.setAttribute("aria-selected", String(selected));

          if (selected) active = item.id;
        });

        if (shown && active) {
          field.setAttribute("aria-controls", menuId);
          field.setAttribute("aria-activedescendant", active);
        } else {
          field.removeAttribute("aria-controls");
          field.removeAttribute("aria-activedescendant");
        }

        host?.querySelectorAll(".milkdown-block-handle .operation-item")
          .forEach((item) => item.setAttribute("aria-hidden", "true"));
      };

      menuObserver = new MutationObserver(updateMenu);
      menuObserver.observe(menuHost!, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-show"],
      });
      menuObserver.observe(host, { subtree: true, childList: true });
      updateMenu();

      const document = () => crepe!.editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
      let originalDocument = document();

      const getText = () => crepe!.editor.action((ctx) => sourceForDocument(original, originalDocument, document(), ctx, caretNodes));

      ready = true;
      crepe.setReadonly(props.readonly);

      // ProseMirror's own focus writes its selection to the DOM first, so Chromium has no caret of its own to adopt.
      const focusEditor = () => crepe!.editor.action((ctx) => ctx.get(editorViewCtx).focus());

      if (!props.readonly && props.autofocus !== false) focus(focusEditor);

      props.onReady({
        getText,
        setText: (text) => {
          if (text === getText()) {
            original = text;
            originalDocument = document();

            return;
          }

          applying = true;

          try {
            crepe!.editor.action(replaceAll(text));
            original = text;
            originalDocument = document();
          } finally {
            applying = false;
          }
        },
        snapshot: () => ({
          source: original,
          text: crepe!.editor.action(getMarkdown()),
          document: JSON.stringify(document().toJSON()),
          trailingCaret: Boolean(document().lastChild && caretNodes.has(document().lastChild!)),
        }),
        restoreDocument: (json, trailingCaret) => crepe!.editor.action(ctx => {
          const view = ctx.get(editorViewCtx);
          let next: DocumentNode;

          try {
            const value: unknown = JSON.parse(json);
            next = view.state.schema.nodeFromJSON(value);
            next.check();

            if (next.type !== view.state.schema.topNodeType) return false;
          } catch {
            return false;
          }

          applying = true;

          try {
            view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content));

            if (trailingCaret && view.state.doc.lastChild?.content.size === 0) caretNodes.add(view.state.doc.lastChild);
          } finally {
            applying = false;
          }

          return true;
        }),
        selection: () => crepe!.editor.action(ctx => {
          const { anchor, head, from, to } = ctx.get(editorViewCtx).state.selection;

          return { start: from, end: to, direction: anchor === head ? "none" : anchor < head ? "forward" : "backward" };
        }),
        restoreSelection: (selection) => crepe!.editor.action(ctx => {
          const view = ctx.get(editorViewCtx);

          const apply = () => {
            const start = Math.min(selection.start, view.state.doc.content.size);
            const end = Math.min(selection.end, view.state.doc.content.size);
            applying = true;

            try {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.direction === "backward" ? end : start, selection.direction === "backward" ? start : end)));
            } finally {
              applying = false;
            }
          };

          const release = () => { restored = null; restoreAgain = () => {}; };

          restored = selection;
          restoreAgain = apply;

          view.dom.addEventListener("keydown", release, { once: true });
          view.dom.addEventListener("pointerdown", release, { once: true });

          apply();
        }),
        focus: focusEditor,
        unchanged: () => document().eq(originalDocument),
        scrollToHeading: (heading) => {
          const wanted = normalHeading(heading);

          const scroll = () => crepe?.editor.action(ctx => {
            const view = ctx.get(editorViewCtx);

            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== "heading" || normalHeading(node.textContent) !== wanted) return true;

              const element = view.nodeDOM(pos);

              if (element instanceof HTMLElement) {
                // The sticky formatting toolbar covers the top of the scroll port; the heading stops below it.
                const bar = element.closest(".milkdown")?.querySelector<HTMLElement>(".milkdown-top-bar");

                element.style.scrollMarginTop = `${bar?.offsetHeight ?? 0}px`;
                element.scrollIntoView({ block: "start" });
              }

              return false;
            });
          });

          // One frame after the loaded text is in, the layout holds: aim once.
          requestAnimationFrame(() => { if (!closed) scroll(); });
        },
      });
    }).catch((error) => {
      if (closed) return;

      if (props.remount) props.remount();
      else setFailure(error instanceof Error ? error.message : String(error));
    });
  });

  createEffect(() => {
    const readonly = props.readonly;

    if (ready) crepe?.setReadonly(readonly);
  });

  onCleanup(() => {
    closed = true;
    mountExpand?.(undefined);
    menuObserver?.disconnect();

    // Destroying during create schedules a retry that can outlive the host's DOM environment.
    if (crepe) void created?.then(
      () => crepe!.destroy(),
      // Creation failures already reach the failure line; destroy failures must still escape.
      () => undefined,
    );
  });

  return (
    <>
      <Show when={!props.label && toolbarHost()}>{mount => <Portal mount={mount()}>
        <div class="pad-rich-editor pad-format-controls">
          <Menu.Root ids={{ trigger: colourTriggerId }} positioning={{ updatePosition: async ({ updatePosition }) => { await updatePosition(); setPalettePositioned(true); } }} open={paletteOpen()} present={palettePresent()} onOpenChange={({ open }) => {
            setPaletteMotion(!isFocusVisible());

            if (open) { setPalettePositioned(false); setPalettePresent(true); }

            setPaletteOpen(open);
          }} onSelect={({ value }) => crepe?.editor.action(ctx => {
            const view = ctx.get(editorViewCtx);
            const { from, to } = view.state.selection;
            const type = padColour.type(ctx);
            const tr = view.state.tr.removeMark(from, to, type);
            const colour = padColours.find(colour => colour === value);

            if (colour) tr.addMark(from, to, type.create({ colour }));
            view.dispatch(tr);
            view.focus();
          })}>
            <Tip text={copy.textColour} ids={{ trigger: colourTriggerId }}>{trigger => {
              // Both primitives resolve the same button; Menu retains its own identity and value.
              const [, attributes] = splitProps(trigger(), ["value", "id"]);

              return <Menu.Trigger {...attributes} class="top-bar-heading-button" aria-label={copy.textColour}>{copy.textColour}</Menu.Trigger>;
            }}</Tip>
            <Portal><Menu.Positioner class="pad-rich-editor"><Menu.Content ref={setPaletteContent} class="pad-colour-menu" inert={!paletteOpen()} onKeyDown={() => setPaletteMotion(false)}>
              <Menu.RadioItemGroup value={currentColour() ?? ""}><For each={["default" as const, ...padColours]}>{colour => <Menu.RadioItem value={colour}><Menu.ItemText>{copy.colours[colour]}</Menu.ItemText><Menu.ItemIndicator><Check class="icon" aria-hidden="true" /></Menu.ItemIndicator></Menu.RadioItem>}</For></Menu.RadioItemGroup>
            </Menu.Content></Menu.Positioner></Portal>
          </Menu.Root>
          <Tip text={copy.highlight}>{trigger => <button {...trigger()} type="button" class="top-bar-item" aria-label={copy.highlight} aria-pressed={highlighted()} classList={{ active: highlighted() }} onPointerDown={event => event.preventDefault()} onClick={() => crepe?.editor.action(ctx => {
            const view = ctx.get(editorViewCtx);
            toggleMark(padHighlight.type(ctx))(view.state, view.dispatch);
            view.focus();
          })}><Highlighter class="icon" aria-hidden="true" /></button>}</Tip>
        </div>
      </Portal>}</Show>
      <Show when={toolbarHost()}>{target => <Portal mount={target()}><div class="pad-width-control">{props.toolbar}</div></Portal>}</Show>
      <Portal>
        <div class="pad-rich-editor pad-block-menu">
          <div class="milkdown" ref={(element) => (menuHost = element)} />
        </div>
      </Portal>
      <div
        class="pad-editor pad-rich-editor reading"
        classList={{ "pad-readonly": props.readonly }}
        onFocusOut={(event) => props.onBlur(event.relatedTarget)}>
        <ReservedLine message={failure()} dismiss={() => setFailure(null)} />
        <div class="pad-editor-host" ref={(element) => (host = element)} />
      </div>
    </>
  );
}
