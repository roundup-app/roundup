import type { Accessor, Setter } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

/** A `createResource` `storage` that reconciles each reply by `key`, so a refetch that changes one row leaves every other row untouched. `rows` is the last reply, which a later failed read leaves in place (the resource's own `latest` throws then). */
export const keyedStore = <Row extends object>(key: string) => {
  const [shelf, setShelf] = createStore<{ rows: Row[] | undefined }>({ rows: undefined });
  const rows = () => shelf.rows;

  const storage = (init: Row[] | undefined): [Accessor<Row[] | undefined>, Setter<Row[] | undefined>] => {
    setShelf("rows", init);

    // `createResource` hands its setter a reply from `mutate` and a function returning it from a fetch.
    const write = (next: Row[] | undefined | (() => Row[] | undefined)) => {
      const reply = next instanceof Function ? next() : next;

      // SAFETY: `reconcile` takes the array, and `undefined` only reaches it from the initial value, which `createResource` never writes.
      setShelf("rows", reconcile(reply as Row[], { key }));

      return shelf.rows;
    };

    // SAFETY: Solid types the setter for any value, and `createResource` calls it with the two forms `write` takes.
    return [rows, write as Setter<Row[] | undefined>];
  };

  return { storage, rows };
};
