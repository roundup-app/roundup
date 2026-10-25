import { copy } from "./copy";
import type { ActorKind } from "@contracts/ActorKind";
import type { Actor } from "@contracts/Actor";
import { Icon } from "./Icon";

const LABELS: Record<ActorKind, string> = { user: copy.userOwned, agent: copy.agentOwned, ext: copy.extensionOwned };

export const OwnerMark = (props: { owner: Actor; decorative?: boolean }) => (
  <span role={props.decorative ? undefined : "img"} aria-label={props.decorative ? undefined : LABELS[props.owner.kind]}>
    <Icon name={props.owner.kind === "user" ? "diamond" : "owned"} />
  </span>
);
