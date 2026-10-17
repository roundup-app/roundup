import { Icon } from "./Icon";
import { createCut, Tip } from "./Tip";

export const ErrorLine = (props: { message: string }) => {
  const [ref, cut] = createCut(() => props.message);

  return (
    <Tip content={props.message} cut={cut}>
      {(trigger) => (
        <p {...trigger()} ref={ref} class="ink" data-tone="red" data-kind="error" role="alert" aria-label={props.message} tabIndex={cut() ? 0 : undefined}>
          <Icon name="x" />{props.message.split(/\r\n|[\r\n]/, 1)[0]}
        </p>
      )}
    </Tip>
  );
};

/** For `ErrorBoundary`: Solid hands a fallback an Error even when something else was thrown (a string becomes its message; anything else reads "Unknown error", with the original as `cause`). */
export const failureLine = (failure: Error) => <ErrorLine message={failure.message} />;
