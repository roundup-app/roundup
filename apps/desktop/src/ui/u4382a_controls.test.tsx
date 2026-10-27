import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { RadioGroup } from "./RadioGroup";
import { Field } from "./Field";

afterEach(cleanup);

it("u4382a_disabled_invalid_and_indeterminate_semantics", () => {
  const change = vi.fn();
  render(() => <><Checkbox checked="indeterminate" onCheckedChange={change}>Partial</Checkbox>
    <Checkbox checked={false} disabled onCheckedChange={change}>Unavailable</Checkbox>
    <Field.Root invalid><Field.Label>Name</Field.Label><Field.Input />
      <Field.ErrorText>Choose a name</Field.ErrorText></Field.Root></>);
  const partial = screen.getByRole<HTMLInputElement>("checkbox", { name: "Partial" });
  expect(partial.indeterminate).toBe(true);
  fireEvent.click(partial);
  expect(change.mock.calls).toEqual([[true]]);
  screen.getByRole<HTMLInputElement>("checkbox", { name: "Unavailable" }).click();
  expect(change.mock.calls).toEqual([[true]]);
  const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
  expect(name.getAttribute("aria-invalid")).toBe("true");
  const error = document.getElementById(name.getAttribute("aria-describedby")!);
  expect(error?.textContent).toBe("Choose a name");
  fireEvent.input(name, { target: { value: "Repaired" } });
  expect(name.value).toBe("Repaired");
});

it("u4382a_disabled_radio_emits_no_choice", () => {
  const change = vi.fn();
  render(() => <RadioGroup label="Mode" choices={[{value:"a", label:"First"}, {value:"b", label:"Second"}]} value="a" disabled onValueChange={change} />);
  screen.getByRole<HTMLInputElement>("radio", {name:"Second"}).click();
  expect(change).not.toHaveBeenCalled();
});
