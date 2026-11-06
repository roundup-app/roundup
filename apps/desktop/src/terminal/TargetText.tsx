import { createMemo, For } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { findTargets, openPrinted, type Printed } from "./links";
import "./styles.css";

/** U365: shared recognised ranges in read-only Ask and Message text. */
export const TargetText = (props: { text: string; base: string; objectLinks?: boolean}) => {
  const { app, project } = useConnectedProject();

  const pieces = createMemo(() => {
    const pieces: { text: string; printed?: Printed }[] = [];
    let end = 0;

    for (const found of findTargets(props.text, props.objectLinks)) {
      pieces.push({ text: props.text.slice(end, found.start) });
      pieces.push({ text: props.text.slice(found.start, found.end), printed: found.printed });
      end = found.end;
    }

    pieces.push({ text: props.text.slice(end) });

    return pieces;
  });

  // U6249c4: a printed path that cannot open is logged by `openPrinted`; the Terminal's own line is the one surface that shows a failure.
  const open = async (printed: Printed) => {
    const failure = await openPrinted((target) => app.openTarget(target), printed, [props.base, project.path]);

    if (failure !== null) console.warn(copy.linkNotOpened(failure));
  };

  return <><For each={pieces()}>{piece => piece.printed
    ? <a data-native-link={props.objectLinks && piece.printed.kind === "url" && /^roundup:/i.test(piece.printed.url) ? project.path : undefined} class="target-link" href={piece.printed.kind === "url" ? piece.printed.url : piece.printed.path}
      onClick={event => { event.preventDefault(); event.stopPropagation(); void open(piece.printed!); }}
      onKeyDown={event => event.stopPropagation()}>{piece.text}</a>
    : piece.text}</For></>;
};
