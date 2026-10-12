import { createSignal, Show } from "solid-js";

type Editing = { from: string; text: string; width: number };

/**
 * Double-click edits; leaving the field commits once, and only when the text differs from what the field started
 * with, so another Actor's change made meanwhile is never written back. A failed commit reopens the field with
 * the typed text.
 */
export const EditableText = (props: {
  value: string;
  multiline: boolean;
  name: "title" | "body";
  /** Resolves with the failure message, or `null` when the commit went through. */
  commit: (text: string) => Promise<string | null>;
}) => {
  const [editing, setEditing] = createSignal<Editing | null>(null);

  let shown: HTMLParagraphElement | undefined;

  const startWith = (text: string, width = shown?.getBoundingClientRect().width ?? 0) => {
    setEditing({ from: props.value, text, width });
  };

  const fit = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const field = (started: Editing) => (element: HTMLTextAreaElement) => {
    element.value = started.text;
    // Fitted again once attached: `scrollHeight` is 0 before then.
    queueMicrotask(() => {
      fit(element);
      element.focus({ preventScroll: true });
    });

    element.addEventListener("input", () => {
      if (!props.multiline && element.value.includes("\n")) element.value = element.value.replace(/\r?\n/g, " ");

      fit(element);
    });

    // Removing a focused field can fire a second blur in a webview.
    let left = false;

    element.addEventListener("blur", () => {
      if (left) return;

      left = true;
      setEditing(null);

      if (element.value === started.from) return;

      void props.commit(element.value).then((failure) => {
        if (failure !== null) startWith(element.value, started.width);
      });
    });
  };

  return (
    <Show
      when={editing()}
      fallback={
        <p
          ref={(element) => { shown = element; }}
          tabIndex={0}
          onDblClick={() => startWith(props.value)}
          onKeyDown={(key) => {
            if (key.key === "Enter") startWith(props.value);
          }}
          style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere", "min-height": "1.4em", "flex-shrink": props.multiline ? "0" : "1" }}
        >
          <Show when={props.value !== ""} fallback={<span class="light">{`no ${props.name}`}</span>}>
            {props.value}
          </Show>
        </p>
      }
      keyed
    >
      {(started) => (
        <textarea
          ref={field(started)}
          aria-label={props.name}
          rows={1}
          onKeyDown={(key) => {
            if (!props.multiline && key.key === "Enter") {
              key.preventDefault();
              key.currentTarget.blur();
            }
          }}
          style={{
            display: "block",
            font: "inherit",
            "letter-spacing": "inherit",
            "line-height": "inherit",
            color: "inherit",
            "text-align": "inherit",
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere",
            padding: "0",
            margin: "0",
            border: "0",
            "box-sizing": "content-box",
            width: started.width > 0 ? `${started.width}px` : "100%",
            "flex-shrink": "0",
            "min-height": "1.4em",
            resize: "none",
            overflow: "hidden",
            outline: "none",
            background: "var(--hover)",
            "caret-color": "var(--accent)",
          }}
        />
      )}
    </Show>
  );
};
