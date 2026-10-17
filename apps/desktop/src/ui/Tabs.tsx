import { Tabs as ArkTabs, useTabsContext } from "@ark-ui/solid/tabs";
import "./Tabs.css";

export const Tabs = {
  ...ArkTabs,
  List: (props: ArkTabs.ListProps) => <ArkTabs.List {...props} class={`app-tabs-list ${props.class ?? ""}`} />,
  Trigger: (props: ArkTabs.TriggerProps) => {
    const tabs = useTabsContext();

    // Ark omits inactive controls links; keep every mounted panel linked using Ark's own content id.
    return <ArkTabs.Trigger aria-controls={tabs().getContentProps({ value: props.value }).id} data-button="quiet" {...props} class={`app-tabs-trigger ${props.class ?? ""}`} />;
  },
  Content: (props: ArkTabs.ContentProps) => <ArkTabs.Content {...props} class={`app-tabs-content ${props.class ?? ""}`} />,
};
