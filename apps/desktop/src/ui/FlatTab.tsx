import { omit } from "solid-js";
import type { JSX } from "@solidjs/web";
import "./flat-tab.styles.css";

// U2231: the one tab look of the Project strip and the Terminal tabs (`flat-tab.styles.css`). Callers pass content, selection, a Tab mark and handlers.
export const FlatTab = (props: JSX.HTMLAttributes<HTMLDivElement> & { selected: boolean }) => {
  const rest = omit(props, "selected");

  return <div {...rest} data-flat-tab="" data-selected={props.selected ? "true" : undefined} />;
};

export const FlatAdd = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} data-flat-add="" />;
