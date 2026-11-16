import { Toast, ToastRegion, ToastTitle, type Toaster } from "@ui-sdk/solid/toast";

export function u492Fixture(toaster: Toaster, library = { ToastRegion, Toast, ToastTitle }) {
  return <>
    <button onClick={() => toaster({ title: "First result saved", duration: Infinity })}>First result</button>
    <button onClick={() => toaster({ title: "Second result saved", duration: Infinity })}>Second result</button>
    <button onClick={() => toaster.dismiss()}>Dismiss</button>
    <library.ToastRegion toaster={toaster}>
      {(toast) => <library.Toast><library.ToastTitle>{toast.title}</library.ToastTitle></library.Toast>}
    </library.ToastRegion>
  </>;
}
