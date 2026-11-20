import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { copy } from "./copy";
import { sizeText } from "../resources/format";
import { sizeChange, type Picture, type Side } from "./images";

/** U7694b: the picture's bytes as a `Blob` URL, revoked when the picture leaves. */
const blobUrl = (picture: Picture): string => {
  const bytes = Uint8Array.from(atob(picture.data ?? ""), char => char.charCodeAt(0));

  return URL.createObjectURL(new Blob([bytes], { type: picture.mime }));
};

const Version = (props: Side & { decoded: (size: [number, number] | undefined) => void }) => {
  const [failed, setFailed] = createSignal(false);

  const url = createMemo(() => {
    const made = blobUrl(props.picture);

    onCleanup(() => URL.revokeObjectURL(made));

    return made;
  });

  const fail = () => { setFailed(true); props.decoded(undefined); };

  return <figure class="image-version">
    <figcaption>{props.label}</figcaption>
    <Show when={!failed()} fallback={<p class="image-failed">{copy.imageFailed} · {sizeText(props.picture.size)}</p>}>
      <img src={url()} alt={props.label} onLoad={event => props.decoded([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])} onError={fail} />
    </Show>
  </figure>;
};

/** U7694b: a changed image's old version above its new, and under them the size change. */
export const ImagePane = (props: { sides: Side[] }) => {
  const [sizes, setSizes] = createSignal<Record<string, [number, number] | undefined>>({});

  const note = () => sizeChange(props.sides.map(({ picture }) => picture.size), props.sides.map(({ side }) => sizes()[side]));

  return <div class="image-pane">
    <For each={props.sides}>{each => <Version {...each} decoded={size => setSizes(previous => ({ ...previous, [each.side]: size }))} />}</For>
    <p class="image-note">{note()}</p>
  </div>;
};
