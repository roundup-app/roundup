import { renderMarkdown } from "./renderMarkdown";
import "./styles.css";

/** Q10: generated text as hold:Plain lays it out, its Markdown drawn as elements. */
export const Markdown = (props: { body: string; class?: string; id?: number; status?: string; open?: boolean; ref?: (element: HTMLDivElement) => void }) => (
  <div
    class={`markdown ${props.class ?? ""}`.trim()}
    data-open={props.open}
    data-message={props.id}
    data-message-body={props.id === undefined ? undefined : ""}
    data-status={props.status}
    ref={props.ref}
    innerHTML={renderMarkdown(props.body)}
  />
);
