import { type createToaster, Toaster, Toast } from "@ark-ui/solid/toast";

export function u492Probe(toaster: ReturnType<typeof createToaster>) {
  return <>
    <button onClick={() => toaster.create({ title: "First result saved", duration: Infinity })}>First result</button>
    <button onClick={() => toaster.create({ title: "Second result saved", duration: Infinity })}>Second result</button>
    <button onClick={() => toaster.dismiss()}>Dismiss</button>
    <Toaster toaster={toaster}>
      {(toast) => <Toast.Root><Toast.Title>{toast().title}</Toast.Title></Toast.Root>}
    </Toaster>
  </>;
}
