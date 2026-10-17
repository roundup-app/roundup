import { type CreateToasterReturn, Toaster, Toast } from "@ark-ui/solid/toast";

export function u492Fixture(toaster: CreateToasterReturn, library = { Toaster, Toast }) {
  return <>
    <button onClick={() => toaster.create({ title: "First result saved", duration: Infinity })}>First result</button>
    <button onClick={() => toaster.create({ title: "Second result saved", duration: Infinity })}>Second result</button>
    <button onClick={() => toaster.dismiss()}>Dismiss</button>
    <library.Toaster toaster={toaster}>
      {(toast) => <library.Toast.Root><library.Toast.Title>{toast().title}</library.Toast.Title></library.Toast.Root>}
    </library.Toaster>
  </>;
}
