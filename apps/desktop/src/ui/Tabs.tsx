import type { OptionsOf } from "@ui-sdk/core";
import { tabs } from "@ui-sdk/core/tabs";
import { usePart, usePrimitive, type PartProps, type PrimitiveHandle } from "@ui-sdk/solid/primitive";
import { TabsList, TabsPanel, TabsTab } from "@ui-sdk/solid/tabs";
import { createContext, createEffect, createMemo, createSignal, omit, untrack, useContext, type Accessor } from "solid-js";
import type { ComponentProps, JSX } from "@solidjs/web";
import { withOptions } from "./primitiveOptions";
import "./Tabs.css";

const tabsPrimitive = withOptions(tabs);

type TabsPrimitive = typeof tabsPrimitive;

type TabsPrimitiveOptions = OptionsOf<TabsPrimitive>;

type TabsOptions = {
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (details: { value: string }) => void;
  activationMode?: "automatic" | "manual";
  orientation?: "horizontal" | "vertical";
  /** DOM ids of a value's trigger and panel, for callers that address them; the parts link to each other through whatever they are. */
  ids?: { trigger?: (value: string) => string; content?: (value: string) => string };
};

type Mounting = { lazyMount?: boolean; unmountOnExit?: boolean };

/** What the parts and their callers read: the selected value, and the attributes of a panel the caller draws itself. */
type TabsApi = { readonly value: string | null; getContentProps: (options: { value: string }) => JSX.HTMLAttributes<HTMLDivElement> };

type TabsState = { primitive: PrimitiveHandle<TabsPrimitive>; options: Accessor<TabsOptions>; api: TabsApi };

const optionKeys = ["value", "defaultValue", "onValueChange", "activationMode", "orientation", "ids"] as const;

/** One Tabs state that any number of `Tabs.RootProvider`s show: the Shelf's triggers and its panels sit in two places of the window. */
export const useTabs = (options: Accessor<TabsOptions>): TabsState => {
  const primitive = usePrimitive(tabsPrimitive, () => {
    const { value, defaultValue, activationMode, orientation } = options();

    const chosen: TabsPrimitiveOptions = {
      onValueChange: (value: string | null) => {
        if (value !== null) options().onValueChange?.({ value });
      },
    };

    if (value !== undefined) chosen.value = value;

    if (defaultValue !== undefined) chosen.defaultValue = defaultValue;

    if (activationMode !== undefined) chosen.activation = activationMode;

    if (orientation !== undefined) chosen.orientation = orientation;

    return chosen;
  });

  const [chosen, setChosen] = createSignal(primitive.state.value);

  createEffect(() => 0, () => {
    const read = () => setChosen(primitive.state.value);

    read();

    return primitive.instance.subscribe(read);
  });

  const value = () => options().value === undefined ? chosen() : options().value ?? null;

  return {
    primitive,
    options,
    api: {
      get value() { return value(); },
      getContentProps: ({ value }) => primitive.slot("panel", () => ({ value }), { id: options().ids?.content?.(value), "aria-labelledby": options().ids?.trigger?.(value) }),
    },
  };
};

const PartsContext = createContext<{ tabs: TabsState; mounting: Mounting }>();

export const useTabsContext = (): Accessor<TabsApi> => {
  const { tabs } = useContext(PartsContext);

  return () => tabs.api;
};

const RootProvider = (props: { value: TabsState } & Mounting & PartProps<"div">) => {
  const rest = omit(props, "value", "lazyMount", "unmountOnExit");

  return (
    <PartsContext value={{ tabs: untrack(() => props.value), mounting: props }}>
      {usePart(untrack(() => props.value.primitive), "root", undefined, rest, "div")}
    </PartsContext>
  );
};

const Root = (props: TabsOptions & Mounting & PartProps<"div">) => {
  const tabs = useTabs(() => props);
  const rest = omit(props, ...optionKeys);

  return <RootProvider {...rest} value={tabs} />;
};

const Context = (props: { children: (tabs: Accessor<TabsApi>) => JSX.Element }) => untrack(() => props.children(useTabsContext()));

type WithClass<Props> = Omit<Props, "class"> & { class?: string };

const List = (props: WithClass<ComponentProps<typeof TabsList>>) => {
  const rest = omit(props, "class");

  return <TabsList {...rest} class={["app-tabs-list", props.class]} />;
};

const Trigger = (props: WithClass<ComponentProps<typeof TabsTab>>) => {
  const { tabs } = useContext(PartsContext);
  const rest = omit(props, "class");

  return <TabsTab data-button="quiet" data-value={props.value} id={tabs.options().ids?.trigger?.(props.value)} {...rest} class={["app-tabs-trigger", props.class]} />;
};

/** A panel mounts on first show and stays (`lazyMount`), only while shown (`unmountOnExit`), or at once (neither). */
const Content = (props: WithClass<Omit<ComponentProps<typeof TabsPanel>, "keepMounted" | "hiddenUntilFound">>) => {
  const { tabs, mounting } = useContext(PartsContext);
  const visited = createMemo<boolean>((seen) => seen === true || tabs.api.value === props.value);
  const keepMounted = () => mounting.unmountOnExit ? false : mounting.lazyMount ? visited() : true;
  const rest = omit(props, "class");

  return (
    <TabsPanel
      id={tabs.options().ids?.content?.(props.value)}
      aria-labelledby={tabs.options().ids?.trigger?.(props.value)}
      {...rest}
      class={["app-tabs-content", props.class]}
      keepMounted={keepMounted()}
    />
  );
};

export const Tabs = { Root, RootProvider, Context, List, Trigger, Content };
