import { ark } from "@ark-ui/solid/factory";
import { splitProps, type ComponentProps } from "solid-js";

// U2231: the one tab look of the Project strip and the Terminal tabs (`flat-tab.styles.css`), on Ark's polymorphic parts. Callers pass content, selection, a Tab mark and handlers.
export const FlatBar = (props: ComponentProps<typeof ark.div>) => <ark.div {...props} data-flat-bar="" />;

export const FlatTab = (props: ComponentProps<typeof ark.div> & { selected: boolean }) => {
  const [local, rest] = splitProps(props, ["selected"]);

  return <ark.div {...rest} data-flat-tab="" data-selected={local.selected} />;
};

export const FlatAdd = (props: ComponentProps<typeof ark.button>) => <ark.button type="button" {...props} data-flat-add="" />;
