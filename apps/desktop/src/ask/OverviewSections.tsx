import { createEffect, createSignal, onCleanup, untrack, type JSX } from "solid-js";
import * as v from "valibot";
import { Accordion } from "../ui/Accordion";
import { useConnectedProject } from "../state/connectedProject";
import { storageSchema, storedValue } from "../state/storage";

const schema = storageSchema("roundup:overview-seen", v.array(v.string()));

/** Visibility is separate from Sent-part acknowledgement: reading never acknowledges delivery. */
export const OverviewSections = (props: {
  ready: boolean;
  items: { id: string; label: string; records: () => { id: string; at: number }[]; actions?: JSX.Element; content: () => JSX.Element }[];
}) => {
  const connected = useConnectedProject();
  const storage = storedValue(`roundup:overview-seen:${connected.project.path}`, schema);
  const [seen, setSeen] = createSignal(storage.read() ?? []);
  const [open, setOpen] = createSignal<string[]>([]);
  let initialized = false;
  let chosen = false;
  let workstreamsOpen = false;
  let root: HTMLDivElement | undefined;

  const unseen = (id: string) => props.items.find(item => item.id === id)?.records().filter(record => !seen().includes(`${id}:${record.id}`)) ?? [];

  createEffect(() => {
    if (!props.ready || initialized) return;
    initialized = true;
    const attention = props.items[0]!;

    const newest = props.items.flatMap((item, order) => unseen(item.id).map(record => ({ section: item.id, at: record.at, order })))
      .sort((a, b) => b.at - a.at || a.order - b.order)[0];

    if (chosen || untrack(open).length) return;
    setOpen(attention.records().length ? [attention.id] : newest ? [newest.section] : []);
  });

  createEffect(() => {
    const requested = connected.view();

    if (!connected.hasView("workstreams")) workstreamsOpen = false;

    if (!props.ready) return;

    if (requested !== "made" && requested !== "reactions" && requested !== "asks" && requested !== "workstreams") return;

    if (requested === "workstreams" && workstreamsOpen) return;
    workstreamsOpen = connected.hasView("workstreams");
    untrack(() => {
      if (requested !== "workstreams") connected.rail.select(null);
      setOpen([requested === "workstreams" ? "attention" : requested]);

      if (requested !== "workstreams") connected.hideView(requested);
    });
  });

  createEffect(() => {
    const section = open()[0];
    const records = props.items.find(item => item.id === section)?.records() ?? [];

    if (!section || !root) return;

    const observer = new IntersectionObserver(entries => {
      if (open()[0] !== section) return;

      const visible = entries.filter(entry => entry.target.isConnected && entry.isIntersecting && !entry.target.closest("[hidden], [inert], [aria-hidden=true]")).flatMap(entry => {
        const id = entry.target.getAttribute("data-overview-item");

        return id && records.some(record => record.id === id) ? [`${section}:${id}`] : [];
      });

      if (!visible.length) return;
      setSeen(previous => {
        const next = [...new Set([...previous, ...visible])];

        if (next.length !== previous.length) void storage.write(next);

        return next.length === previous.length ? previous : next;
      });
    }, { root: root.closest(".ask-bar") });

    const observe = () => {
      for (const element of root!.querySelectorAll("[data-overview-item]")) observer.observe(element);
    };

    const changes = new MutationObserver(observe);
    changes.observe(root, { childList: true, subtree: true });
    queueMicrotask(observe);
    onCleanup(() => { observer.disconnect(); changes.disconnect(); });
  });

  return <div class="overview-sections-owner" ref={root}><Accordion value={open()} onChange={value => { chosen = true; setOpen(value); }} items={props.items.map(item => ({ ...item, unseen: unseen(item.id).length > 0 }))} /></div>;
};
