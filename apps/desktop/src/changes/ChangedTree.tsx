import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { ErrorLine } from "../ink/ErrorLine";
import { failureOf } from "../todos/failureOf";
import { useConnectedProject } from "../state/connectedProject";
import { absolutePath, statusText } from "./paths";
import treeStyles from "./tree.styles.css?inline";

/** The library is fetched when the panel first has files to draw (rule 7). */
let library: Promise<typeof import("@pierre/trees")> | undefined;

const loadTrees = () => (library ??= import("@pierre/trees"));

/** Whether the library has been asked for yet. */
export const treesLoaded = (): boolean => library !== undefined;

/** U2539b, U2539d: the changed files as a tree of `@pierre/trees`; `Enter` or a double click on a file opens it in the editor at its line. */
export const ChangedTree = (props: { root: string; files: readonly ChangedFile[] }) => {
  const { app } = useConnectedProject();
  const [failure, setFailure] = createSignal<string | null>(null);
  const byPath = new Map(props.files.map((file) => [file.path, file]));
  const [host, setHost] = createSignal<HTMLDivElement>();

  const choose = (path: string | null) => {
    const file = path === null ? undefined : byPath.get(path);

    if (!file || file.status === "deleted") return;

    setFailure(null);
    void failureOf(() => app.openInEditor(absolutePath(props.root, file), file.line ?? undefined)).then(setFailure);
  };

  onMount(() => {
    let tree: InstanceType<Awaited<ReturnType<typeof loadTrees>>["FileTree"]> | undefined;
    let gone = false;

    void loadTrees().then(({ FileTree }) => {
      const mount = host();

      if (gone || !mount) return;

      tree = new FileTree({
        paths: props.files.map((file) => file.path),
        initialExpansion: "open",
        icons: { set: "minimal", colored: false },
        // The library defines its palette on :host, inside its shadow root.
        // Keep the overrides there too so inheritance cannot restore its defaults.
        unsafeCSS: treeStyles,
        gitStatus: props.files.map((file) => ({ path: file.path, status: file.status })),
        renderRowDecoration: ({ item }) => {
          const file = byPath.get(item.path);

          return file ? { text: statusText[file.status], title: file.from ? `${file.from} → ${file.path}` : file.path } : null;
        },
      });
      tree.render({ containerWrapper: mount });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") choose(tree?.getFocusedPath() ?? null);
    };

    const onDoubleClick = (event: MouseEvent) => {
      const row = event.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemType === "file");

      choose(row?.dataset.itemPath ?? null);
    };

    const element = host();

    element?.addEventListener("keydown", onKeyDown);
    element?.addEventListener("dblclick", onDoubleClick);
    onCleanup(() => {
      gone = true;
      element?.removeEventListener("keydown", onKeyDown);
      element?.removeEventListener("dblclick", onDoubleClick);
      tree?.cleanUp();
    });
  });

  return (
    <>
      <div ref={setHost} class="worktree-tree" />
      <Show when={failure()}>{(message) => <ErrorLine message={message()} />}</Show>
    </>
  );
};
