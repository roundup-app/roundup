import type { JSX } from "@solidjs/web";
import { Icon } from "./Icon";
import { createCut } from "./Tip";
import { Tip } from "../ui/Tip";
import "./failureLine.css";

/** HM7589a: a message ending in a shell command shows it apart, in mono and selectable, so the user can copy it whole. */
const COMMAND = /^(.*?)(curl \S+ \S+ \| sh)$/;

const withCommand = (line: string): JSX.Element => {
  const found = COMMAND.exec(line);

  return found === null ? line : <>{found[1]}<code class="ink-command">{found[2]}</code></>;
};

export const ErrorLine = (props: { message: string; content?: JSX.Element; notice?: boolean | undefined }) => {
  const [ref, cut] = createCut(() => props.message);

  return (
    <Tip kind="changing" content={props.message} cut={cut}>
      {(trigger) => (
        <p {...trigger({ ref })} style={{ width: "fit-content", "max-width": "100%" }} class="ink" data-kind={props.notice ? "notice" : "error"} role={props.notice ? "status" : "alert"} aria-label={props.message} tabindex={cut() ? 0 : undefined}>
          {!props.notice && <Icon name="x" />}{props.content ?? withCommand(props.message.split(/\r\n|[\r\n]/, 1)[0] ?? "")}
        </p>
      )}
    </Tip>
  );
};
