import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Field } from "./Field";

afterEach(cleanup);

it("u4382a_disabled_invalid_and_indeterminate_semantics", async () => {
  const change = vi.fn();
  render(() => <><Checkbox checked="indeterminate" onCheckedChange={change}>Partial</Checkbox>
    <Checkbox checked={false} disabled onCheckedChange={change}>Unavailable</Checkbox>
    <Field.Root invalid><Field.Label>Name</Field.Label><Field.Input />
      <Field.ErrorText>Choose a name</Field.ErrorText></Field.Root></>);
  const partial = screen.getByRole("checkbox", { name: "Partial" });
  await waitFor(() => expect(partial.getAttribute("aria-checked")).toBe("mixed"));
  fireEvent.click(partial);
  await waitFor(() => expect(change.mock.calls).toEqual([[true]]));
  screen.getByRole("checkbox", { name: "Unavailable" }).click();
  flush();
  expect(change.mock.calls).toEqual([[true]]);
  const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
  expect(name.getAttribute("aria-invalid")).toBe("true");
  const error = document.getElementById(name.getAttribute("aria-describedby")!);
  expect(error).toBe(screen.getByText("Choose a name"));
  fireEvent.input(name, { target: { value: "Repaired" } });
  flush();
  expect(name.value).toBe("Repaired");
});
