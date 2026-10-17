import { Icon } from "./Icon";
import { Tip } from "./Tip";

export const ErrorLine = (props: { message: string }) => (
  <Tip content={props.message}>
    {(trigger) => (
      <p {...trigger()} class="ink" data-tone="red" data-kind="error" role="alert" aria-label={props.message} tabIndex={0}>
        <Icon name="x" />{props.message.split(/\r\n|[\r\n]/, 1)[0]}
      </p>
    )}
  </Tip>
);

/** For `ErrorBoundary`: Solid hands a fallback an Error even when something else was thrown (a string becomes its message; anything else reads "Unknown error", with the original as `cause`). */
export const failureLine = (failure: Error) => <ErrorLine message={failure.message} />;
