import { useConnectedProject } from "../state/connectedProject";
import { Walk } from "./Walk";
import { walkStorage } from "./walkStorage";

/** PW2: the Drawer body of a walk link, a Pad read one step at a time over the Project's saved steps (PW4). */
export const WalkHost = (props: { name: string; text: string; path: string; finish: () => void }) => {
  const connected = useConnectedProject();

  return <Walk name={props.name} text={props.text} storage={walkStorage(props.path)} reducedMotion={connected.reducedMotion} onFinish={props.finish} />;
};
