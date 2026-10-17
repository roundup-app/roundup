import { renderMarkdown } from "./renderMarkdown";
import "./styles.css";

/** Q10: generated text as hold:Plain lays it out, its Markdown drawn as elements. */
export const Markdown = (props: { body: string; class?: string; ref?: (element: HTMLDivElement) => void }) => (
  <div
    class={`markdown ${props.class ?? ""}`.trim()}
    ref={props.ref}
    innerHTML={renderMarkdown(props.body)}
  />
);
