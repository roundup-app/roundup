import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openPad, openShelf, padOf, RpcError } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

const calls = (app: Awaited<ReturnType<typeof openShelf>>["app"]) => app.calls.filter((call) => call.method === "pad.delete");

const ask = async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })); };

describe("u150 delete asks first (Pad)", () => {
  it("u150_confirming_calls_pad_delete_once_closes_with_no_deleted_line", async () => {
    const { app, connected } = await openShelf([padOf("notes", USER, "a")]);

    await openPad("notes");
    await ask();

    app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });

    await waitFor(() => expect(connected.drawer.content()).toBeNull());
    expect([calls(app), screen.queryByText(/was deleted/)]).toEqual([[{ method: "pad.delete", params: { name: "notes", expectedIncarnation: "fixture-notes", operation: expect.any(String) } }], null]);
  });

  it("u150_an_error_keeps_the_drawer_and_the_pad", async () => {
    const { app, connected } = await openShelf([padOf("notes", USER, "a")]);
    app.handlers["pad.delete"] = () => Promise.reject(new RpcError(-32002, "forbidden"));
    await openPad("notes");
    await ask();


    expect([(await screen.findByText(/forbidden/)).textContent]).toEqual(["forbidden"]);
    expect(connected.drawer.content()).not.toBeNull();
    expect(screen.getAllByText("notes").length).toBeGreaterThan(0);
  });
});
