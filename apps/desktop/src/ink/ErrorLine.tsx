import type { JSX } from "solid-js";
import { Icon } from "./Icon";
import { createCut } from "./Tip";
import { Tip } from "../ui/Tip";

export const ErrorLine = (props: { message: string; content?: JSX.Element }) => {
  const [ref, cut] = createCut(() => props.message);

  return (
    <Tip content={props.message} cut={cut}>
      {(trigger) => (
        <p {...trigger()} style={{ width: "fit-content", "max-width": "100%" }} ref={ref} class="ink" data-tone="red" data-kind="error" role="alert" aria-label={props.message} tabIndex={cut() ? 0 : undefined}>
          <Icon name="x" />{props.content ?? props.message.split(/\r\n|[\r\n]/, 1)[0]}
        </p>
      )}
    </Tip>
  );
};
