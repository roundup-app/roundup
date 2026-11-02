import { createMemo, For } from "solid-js";
import { RpcError } from "../app/seam";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { absolutePath, findTargets, type Printed } from "./links";
import "./styles.css";

/** U365: shared recognised ranges in read-only Ask and Message text. */
export const TargetText = (props: { text: string; base: string; onFailure: (message: string | null) => void }) => {
  const { app } = useConnectedProject();

  const pieces = createMemo(() => {
    const pieces: { text: string; printed?: Printed }[] = [];
    let end = 0;

    for (const found of findTargets(props.text)) {
      pieces.push({ text: props.text.slice(end, found.start) });
      pieces.push({ text: props.text.slice(found.start, found.end), printed: found.printed });
      end = found.end;
    }

    pieces.push({ text: props.text.slice(end) });

    return pieces;
  });

  const open = async (printed: Printed) => {
    const target = printed.kind === "url" ? printed : { ...printed, path: absolutePath(printed.path, props.base) };

    try {
      await app.openTarget(target);
      props.onFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      props.onFailure(error instanceof RpcError && error.code === -32001 && target.kind === "path" ? copy.doesNotExist(target.path) : error.message);
    }
  };

  return <><For each={pieces()}>{piece => piece.printed
    ? <a class="target-link" href={piece.printed.kind === "url" ? piece.printed.url : piece.printed.path}
      onClick={event => { event.preventDefault(); event.stopPropagation(); void open(piece.printed!); }}
      onKeyDown={event => event.stopPropagation()}>{piece.text}</a>
    : piece.text}</For></>;
};
