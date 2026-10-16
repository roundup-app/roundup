import { createToaster, Toaster, Toast } from "@ark-ui/solid/toast";
import { render } from "solid-js/web";

const toaster = createToaster({ placement: "bottom-end", removeDelay: 150 });

render(() => <>
  <button onClick={() => toaster.create({ title: "First result saved", duration: Infinity })}>First result</button>
  <button onClick={() => toaster.create({ title: "Second result saved", duration: Infinity })}>Second result</button>
  <button onClick={() => toaster.dismiss()}>Dismiss</button>
  <Toaster toaster={toaster}>
    {(toast) => <Toast.Root><Toast.Title>{toast().title}</Toast.Title></Toast.Root>}
  </Toaster>
</>, document.getElementById("root")!);
