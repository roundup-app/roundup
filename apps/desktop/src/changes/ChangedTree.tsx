import { createEffect, onSettled, untrack } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { copy } from "./copy";
import { statusText } from "./paths";
import treeStyles from "./tree.styles.css?inline";

/** The library is fetched when the view first has files to draw (rule 7). */
let library: Promise<typeof import("@pierre/trees")> | undefined;

const loadTrees = () => (library ??= import("@pierre/trees"));

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** U7674a: the path a tree shows first — folders before files at each level, each in name order. */
export const firstInTree = (files: readonly ChangedFile[]): string | undefined => {
  const order = (a: ChangedFile, b: ChangedFile): number => {
    const left = a.path.split("/");
    const right = b.path.split("/");

    for (let depth = 0; depth < Math.min(left.length, right.length); depth++) {
      const leftFolder = depth < left.length - 1;
      const rightFolder = depth < right.length - 1;

      if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;

      const same = byName(left[depth] ?? "", right[depth] ?? "");

      if (same !== 0) return same;
    }

    return left.length - right.length;
  };

  return [...files].sort(order)[0]?.path;
};

const fileRow = (event: Event): string | undefined => {
  const row = event.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.itemType === "file");

  return row?.dataset.itemPath;
};

/** U7674a, U7674c: the changed files as a tree of `@pierre/trees`; a file row that takes focus or a click is chosen, and Enter or a double click on one edits it (U2539d). */
export const ChangedTree = (props: { files: readonly ChangedFile[]; selected: string | undefined; onChoose: (path: string) => void; onEdit: (path: string) => void }) => {
  let host: HTMLDivElement | undefined;
  let files = new Map<string, ChangedFile>();
  let tree: InstanceType<Awaited<ReturnType<typeof loadTrees>>["FileTree"]> | undefined;

  const status = (list: readonly ChangedFile[]) => list.map(file => ({ path: file.path, status: file.status }));

  // `select()` adds to the selection: drop every other path so exactly the open file is selected.
  const openOnly = (path: string) => {
    for (const other of tree?.getSelectedPaths() ?? []) if (other !== path) tree?.getItem(other)?.deselect();
    tree?.getItem(path)?.select();
  };

  createEffect(() => props.files, list => {
    files = new Map(list.map(file => [file.path, file]));
    tree?.resetPaths(list.map(file => file.path));
    tree?.setGitStatus(status(list));
  });

  // The open file carries the selection: feed it back on every choose.
  createEffect(() => props.selected, path => {
    if (path) openOnly(path);
  });

  onSettled(() => {
    let gone = false;
    const cleanups: (() => void)[] = [];
    const mount = host;
    const initial = untrack(() => ({ list: props.files, selected: props.selected }));

    files = new Map(initial.list.map(file => [file.path, file]));

    void loadTrees().then(({ FileTree }) => {
      if (gone || !mount) return;

      tree = new FileTree({
        paths: initial.list.map(file => file.path),
        initialExpansion: "open",
        itemHeight: parseFloat(getComputedStyle(mount).getPropertyValue("--space-5")) || 24,
        stickyFolders: false,
        rangeSelection: "replace",
        icons: { set: "minimal", colored: false },
        // The library defines its palette on :host, inside its shadow root; keep the overrides there too.
        unsafeCSS: treeStyles,
        gitStatus: status(initial.list),
        renderRowDecoration: ({ item }) => {
          const counts = files.get(item.path)?.counts;

          return counts ? { text: `${copy.addedLines(counts.added)} ${copy.removedLines(counts.removed)}` } : null;
        },
      });
      tree.render({ containerWrapper: mount });

      const shadow = mount.querySelector("file-tree-container")?.shadowRoot;
      const start = initial.selected;

      if (start) {
        tree.focusPath(start);
        openOnly(start);
      }

      shadow?.querySelector<HTMLElement>(start ? `[data-item-path="${CSS.escape(start)}"]` : '[tabindex="0"]')?.focus();

      // Virtualization replaces rows; restore accessible names on every rendered batch.
      const describe = () => {
        for (const row of shadow?.querySelectorAll<HTMLElement>('[data-item-type="file"]') ?? []) {
          const file = files.get(row.dataset.itemPath ?? "");
          const label = file ? `${file.path}, ${statusText[file.status]}` : "";

          if (file && row.getAttribute("aria-label") !== label) row.setAttribute("aria-label", label);
        }
      };

      if (shadow) {
        // `focus` does not bubble and is not retargeted out of the shadow root everywhere: listen inside it, in the capture phase.
        // listener-owner: removed with the tree in the cleanup below; the shadow root is the tree library's and has no solid-primitives target.
        shadow.addEventListener("focus", choose, true);
        cleanups.push(() => shadow.removeEventListener("focus", choose, true));

        const observer = new MutationObserver(describe);

        observer.observe(shadow, { subtree: true, childList: true });
        describe();
        cleanups.push(() => observer.disconnect());
      }
    });

    const choose = (event: Event) => {
      const path = fileRow(event);

      if (path) props.onChoose(path);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const path = tree?.getFocusedPath();

      if (event.key === "Enter" && path && files.has(path)) props.onEdit(path);
    };

    const onDoubleClick = (event: MouseEvent) => {
      const path = fileRow(event);

      if (path) props.onEdit(path);
    };

    // listener-owner: removed in the cleanup below with the tree it listens on.
    mount?.addEventListener("click", choose);
    // listener-owner: removed in the cleanup below.
    mount?.addEventListener("keydown", onKeyDown);
    // listener-owner: removed in the cleanup below.
    mount?.addEventListener("dblclick", onDoubleClick);

    return () => {
      gone = true;
      mount?.removeEventListener("click", choose);
        mount?.removeEventListener("keydown", onKeyDown);
      mount?.removeEventListener("dblclick", onDoubleClick);

      for (const stop of cleanups) stop();
      tree?.cleanUp();
    };
  });

  return <div ref={element => { host = element; }} class="changes-tree" />;
};
