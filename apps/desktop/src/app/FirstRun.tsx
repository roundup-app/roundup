import { Icon } from "../ink/Icon";
import { Show } from "solid-js";
import { ErrorLine } from "../ink/ErrorLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = () => (
  <>
    <p>Workstreams and Agents<br />appear here, one per row,<br />nested by indent</p>
  </>
);

export const ChooseProject = (props: { failure: string | null; onChoose: () => void }) => (
  <>
    <Show when={props.failure} fallback={<p>Open a folder to start</p>}>
      {(message) => <ErrorLine message={message()} />}
    </Show>
    <button data-button="quiet" type="button" class="word" onClick={() => props.onChoose()}>
      Choose folder…
    </button>
  </>
);

export const EmptyShelf = () => (
  <>
    <p>Todos</p>
    <p>Agents add them as they<br />plan; so can you</p>
    <p>Pads</p>
    <p><Icon name="owned" /> Agent notes</p>
    <p><Icon name="diamond" /> Yours</p>
  </>
);
