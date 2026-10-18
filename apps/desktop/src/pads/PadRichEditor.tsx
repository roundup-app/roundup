import { copy } from "../copy";
import { KindGlyph } from "../ink/KindGlyph";
import { createEffect, createSignal, createUniqueId, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import type { BlockEditFeatureConfig } from "@milkdown/crepe/feature/block-edit";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import { editorViewCtx } from "@milkdown/kit/core";
import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import { replaceAll } from "@milkdown/kit/utils";
import { sourceForDocument } from "./sourceForDocument";
import { visualBlocks } from "./visualBlocks";
import { visualKinds } from "./visualKinds";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";

export type PadEditorHandle = {
  getText(): string;
  setText(text: string): void;
  focus(): void;
  /** The document equals the one last loaded, whatever Markdown it would serialize to. */
  unchanged(): boolean;
};

const topBarNames = new Map([
  ["bold", copy.bold],
  ["italic", copy.italic],
  ["strikethrough", copy.strikethrough],
  ["code", copy.inlineCode],
  ["bullet-list", copy.bulletList],
  ["ordered-list", copy.numberedList],
  ["task-list", copy.checklist],
  ["link", copy.link],
  ["code-block", copy.codeBlock],
  ["quote", copy.quote],
  ["hr", copy.horizontalRule],
]);

/** U147: the Pad's one surface. `readonly` is ownership (P2), never a mode; `onChange` fires on every document change the user makes, `onText` follows with the settled Markdown. */
export default function PadRichEditor(props: {
  text: string;
  readonly: boolean;
  onChange: () => void;
  onText: (text: string) => void;
  onBlur: (next: EventTarget | null) => void;
  onReady: (editor: PadEditorHandle) => void;
}) {
  const menuId = createUniqueId();
  let menuObserver: MutationObserver | undefined;
  let host: HTMLDivElement | undefined;
  let menuHost: HTMLDivElement | undefined;
  let crepe: CrepeBuilder | undefined;
  let created: ReturnType<CrepeBuilder["create"]> | undefined;
  let original = props.text;
  let applying = false;
  let closed = false;
  let ready = false;
  let topBarLabels: string[] = [];
  const [failure, setFailure] = createSignal<string | null>(null);

  onMount(() => {
    if (!host || !menuHost) throw new Error(copy.padEditorHostIsMissing);

    // SAFETY: Crepe recursively partials HTMLElement in its root type; the supported root is a real DOM element.
    const blockConfig = {
      blockHandle: { getOffset: () => 0 },
      slashMenu: { root: menuHost },
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
      .addFeature(toolbar)
      .addFeature(topBar, {
        buildTopBar: (builder) => {
          topBarLabels = builder.build().flatMap((group) =>
            group.items
              .filter((item) => item.key !== "heading-selector")
              .map((item) => {
                const label = topBarNames.get(item.key);

                if (!label) throw new Error(copy.padEditorToolbarActionHasNoName(item.key));

                return label;
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

    crepe.editor.use(
      $prose(
        () =>
          new Plugin({
            view: () => ({
              update: (view, previous) => {
                if (!applying && !closed && !view.state.doc.eq(previous.doc)) props.onChange();
              },
            }),
          }),
      ),
    );

    crepe.editor.use($prose(() => visualBlocks(visualKinds(), () => props.readonly)));

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (applying || closed) return;

        props.onText(markdown);
      });
    });

    created = crepe.create();
    void created.then(() => {
      if (closed || !host || !crepe) return;

      const field = host.querySelector<HTMLElement>(".ProseMirror");

      if (!field) throw new Error(copy.padEditorDidNotOpen);

      const buttons = host.querySelectorAll<HTMLButtonElement>(".milkdown-top-bar .top-bar-item");

      if (buttons.length !== topBarLabels.length) throw new Error(copy.padEditorToolbarChanged);

      buttons.forEach((button, index) => {
        const label = topBarLabels[index];

        if (!label) throw new Error(copy.padEditorToolbarLabelIsMissing);

        button.setAttribute("aria-label", label);
        button.title = label;
      });

      const heading = host.querySelector<HTMLButtonElement>(".milkdown-top-bar .top-bar-heading-button");

      if (heading) {
        heading.setAttribute("aria-label", copy.heading);
        heading.title = copy.heading;
      }

      field.setAttribute("role", "textbox");
      field.setAttribute("aria-label", copy.padBody);
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
      const getText = () => sourceForDocument(original, originalDocument, document(), () => crepe!.getMarkdown());

      ready = true;
      crepe.setReadonly(props.readonly);

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
        focus: () => field.focus(),
        unchanged: () => document().eq(originalDocument),
      });

      if (!props.readonly) field.focus();
    }).catch((error) => {
      if (!closed) setFailure(error instanceof Error ? error.message : String(error));
    });
  });

  createEffect(() => {
    const readonly = props.readonly;

    if (ready) crepe?.setReadonly(readonly);
  });

  onCleanup(() => {
    closed = true;
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
      <Portal>
        <div class="pad-rich-editor pad-block-menu">
          <div class="milkdown" ref={(element) => (menuHost = element)} />
        </div>
      </Portal>
      <div
        class="pad-editor pad-rich-editor"
        classList={{ "pad-readonly": props.readonly }}
        onFocusOut={(event) => props.onBlur(event.relatedTarget)}>
        <Show when={failure()}>
          {(message) => <p role="alert" class="pad-editor-failure"><KindGlyph kind="error" decorative /> {message()}</p>}
        </Show>
        <div ref={(element) => (host = element)} />
      </div>
    </>
  );
}
