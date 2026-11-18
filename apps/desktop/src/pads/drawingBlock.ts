import { appDark, followAppAppearance } from "../settings/preferences";
import { copy } from "./copy";
import { createElement } from "react";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import * as v from "valibot";
import type { VisualMount } from "./visualBlocks";

export type CanvasElement = { id: string; version: number; isDeleted?: boolean };

export type CanvasProps = {
  initialData: { elements: CanvasElement[]; scrollToContent: boolean };
  viewModeEnabled: boolean;
  theme: "light" | "dark";
  UIOptions: { canvasActions: Record<string, boolean> };
  onChange(elements: readonly CanvasElement[]): void;
};

/** The calls the Pad makes of Excalidraw. */
export type CanvasApi = {
  Excalidraw: ComponentType<CanvasProps>;
  /** Expands skeletons: a shape with a `label`, an arrow with `start` and `end` ids. Ids are kept, so a stored scene's bindings still point at their elements. */
  convertToExcalidrawElements(skeleton: Skeleton[], options: { regenerateIds: false }): CanvasElement[];
  /** Loads full elements a stored scene holds, keeping their bindings; converting them again would detach every arrow. */
  restoreElements(elements: Skeleton[]): CanvasElement[];
};

export type Skeleton = { type: string; id?: string | undefined; version?: number | undefined };

const Scene = v.object({ type: v.literal("excalidraw"), elements: v.array(v.looseObject({ type: v.string(), id: v.optional(v.string()), version: v.optional(v.number()) })) });

const parse = (text: string) => {
  const scene = v.safeParse(Scene, JSON.parse(text));

  if (!scene.success) throw new Error(copy.notAnExcalidrawScene);

  return scene.output.elements;
};

/** A scene the Pad itself wrote holds full elements; an Agent's holds skeletons. */
const isStored = (elements: Skeleton[]) => elements.length > 0 && elements.every((element) => element.version !== undefined);

const signature = (elements: readonly CanvasElement[]) => elements.map((element) => `${element.id}:${element.version}`).join(",");

/** U149: an Excalidraw scene on a canvas, editable unless the Pad is read-only. */
export const mountDrawing = (canvas: CanvasApi): VisualMount => (host, { text, readonly, replace }) => {
  let root: ReturnType<typeof createRoot> | undefined;
  let stopAppearance: (() => void) | undefined;
  // Loading may touch versions; only the user's own gesture counts as an edit.
  let touched = false;
  // U7414c: the drawing shows clean (Excalidraw's view mode, no tool bars) until Edit.
  let editing = false;
  let render = () => {};

  const surface = document.createElement("div");
  surface.className = "visual-drawing-surface";
  const edit = document.createElement("button");

  const setEditing = (next: boolean) => {
    if (editing === next) return;
    editing = next;
    edit.hidden = next;
    render();

    // listener-owner: removed when Edit ends and on release
    if (next) document.addEventListener("pointerdown", outside, true);
    else document.removeEventListener("pointerdown", outside, true);
  };

  const outside = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !host.contains(event.target)) setEditing(false);
  };

  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !editing) return;
    event.stopPropagation();
    setEditing(false);
    edit.focus();
  };

  const down = () => {
    touched = true;
  };

  host.classList.add("visual-drawing");
  host.addEventListener("pointerdown", down);
  host.addEventListener("keydown", () => (touched = true));
  // listener-owner: the mount's release function removes it
  host.addEventListener("keydown", escape);

  edit.type = "button";
  edit.dataset.button = "quiet";
  edit.className = "visual-drawing-edit";
  edit.textContent = copy.editDrawing;
  edit.hidden = readonly;
  // listener-owner: the mount's release function removes it
  edit.addEventListener("click", () => setEditing(true));
  host.append(surface);

  if (!readonly) host.append(edit);

  try {
    const skeleton = parse(text);
    const elements = isStored(skeleton) ? canvas.restoreElements(skeleton) : canvas.convertToExcalidrawElements(skeleton, { regenerateIds: false });
    let last = signature(elements);

    const initialData = { elements, scrollToContent: true };

    root = createRoot(surface);

    render = () => root?.render(
      createElement(canvas.Excalidraw, {
        initialData,
        viewModeEnabled: readonly || !editing,
        theme: appDark() ? "dark" : "light",
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
        onChange: (current) => {
          if (readonly) return;

          if (!touched) {
            last = signature(current);

            return;
          }

          if (signature(current) === last) return;
          last = signature(current);
          // Visual slots preserve their own widget on this transaction; capture every scene
          // immediately so navigation or reload during a gesture cannot lose it.
          replace(JSON.stringify({ type: "excalidraw", version: 2, elements: current.filter((element) => !element.isDeleted) }));
        },
      }),
    );

    render();
    stopAppearance = followAppAppearance(render);
  } catch (error) {
    const source = document.createElement("pre");
    const line = document.createElement("p");

    source.textContent = text;
    line.className = "visual-error";
    line.setAttribute("role", "alert");
    line.textContent = copy.drawing(error instanceof Error ? error.message : String(error));
    host.replaceChildren(source, line);
  }

  return () => {
    document.removeEventListener("pointerdown", outside, true);
    stopAppearance?.();
    // Unmounting during React's own render pass throws; defer it.
    queueMicrotask(() => root?.unmount());
  };
};
