import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { ReservedLine } from "../ink/ReservedLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = () => (
  <>
    <p>{copy.agentsAndTerminals}<br />{copy.appearHereOnePerRow}<br />{copy.nestedByIndent}</p>
  </>
);

export const ChooseProject = (props: { failure: string | null; onChoose: () => void }) => (
  <>
    <ReservedLine message={props.failure} status={copy.openAFolderToStart} />
    <button data-button="quiet" type="button" class="word" onClick={() => props.onChoose()}>{copy.chooseFolder}</button>
  </>
);

export const EmptyShelf = () => (
  <>
    <p>{copy.todos}</p>
    <p>{copy.agentsAddThemAsThey}<br />{copy.planSoCanYou}</p>
    <p>{copy.pads}</p>
    <p><Icon name="owned" />{copy.agentNotes}</p>
    <p><Icon name="diamond" />{copy.yours}</p>
  </>
);
