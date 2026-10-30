import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";

/** The shared row action keeps native pointer and keyboard activation. */
export const OpenButton = (props: { name: string; onOpen: () => void }) => (
  <IconButton class="todo-open" aria-label={copy.openItem(props.name)} onClick={event => { event.stopPropagation(); props.onOpen(); }}><ArrowUpRight aria-hidden="true" /></IconButton>
);
