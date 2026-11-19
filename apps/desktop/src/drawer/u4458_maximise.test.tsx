import { flush } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4458_every_drawer_kind_gets_the_control", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);

  for (const kind of ["work-order", "future-kind"]) {
    drawer.open(() => <p>detail</p>, "key", { kind, project: "/one" });
    flush();
    fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
    expect(screen.getByLabelText("Drawer").dataset.maximised).toBe("true");
    drawer.close("key");
    flush();
  }
});
