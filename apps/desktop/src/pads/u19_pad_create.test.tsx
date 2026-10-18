import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { CONFLICT, openShelf, padOf, RpcError } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const typeName = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));
  const field = await screen.findByLabelText<HTMLInputElement>("Pad name");
  fireEvent.input(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });

  return field;
};

describe("u19 create", () => {
  it("u19_clicking_plus_opens_an_inline_name_field", async () => {
    await openShelf([]);

    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    expect(await screen.findByLabelText("Pad name")).toBeTruthy();
  });

  it("u19_the_name_field_is_a_row_after_the_last_pad", async () => {
    await openShelf([padOf("notes", USER)]);

    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    expect(screen.getByText("notes").compareDocumentPosition(await screen.findByLabelText("Pad name")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("u19_escape_closes_the_name_field_and_calls_nothing", async () => {
    const { calls } = await openShelf([]);
    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    fireEvent.keyDown(await screen.findByLabelText("Pad name"), {
      key: "Escape",
    });

    expect([
      screen.queryByLabelText("Pad name"),
      calls().includes("pad.create"),
    ]).toEqual([null, false]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Pad" }));
  });

  it("u19_enter_calls_pad_create_with_the_name_and_leaves_a_fresh_focused_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = ({ name }) => padOf(name, USER);

    const field = await typeName("notes");

    await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.create")).toEqual([
      { method: "pad.create", params: { name: "notes", text: null } },
    ]));
    expect(field).toHaveProperty("value", "");
    expect(document.activeElement).toBe(field);
  });

  it("u19_a_conflict_shows_the_message_and_keeps_the_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(CONFLICT, "pad notes exists");
    };

    await typeName("Notes");

    expect((await screen.findByText(/exists/)).textContent).toBe(
      "pad notes exists",
    );
    expect(screen.getByLabelText("Pad name")).toBeTruthy();
  });

  it("u19_invalid_params_shows_the_message_and_keeps_the_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(-32602, "name must not contain /");
    };

    await typeName("a/b");

    expect((await screen.findByText(/must not contain/)).textContent).toBe(
      "name must not contain /",
    );
    expect(screen.getByLabelText("Pad name")).toBeTruthy();
  });

  it("u19_clicking_plus_again_replaces_the_message_with_a_fresh_field", async () => {
    const { app } = await openShelf([]);
    app.handlers["pad.create"] = () => {
      throw new RpcError(CONFLICT, "pad notes exists");
    };

    await typeName("notes");
    await screen.findByText(/exists/);

    fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));

    expect(
      [
        await screen.findByLabelText("Pad name"),
        screen.queryByText(/exists/),
      ].map(Boolean),
    ).toEqual([true, false]);
  });
});
