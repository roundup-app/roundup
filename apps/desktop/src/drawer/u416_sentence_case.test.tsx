import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";

afterEach(cleanup);

it("u416_drawer_frame_uses_sentence_case", () => {
  const drawer = createDrawer();
  render(() => <DrawerHost drawer={drawer} reducedMotion={() => true} />);
  drawer.open(() => <p>workstream</p>);

  expect(screen.getByRole("complementary", { name: "Drawer" }).textContent).toContain("workstream");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(drawer.content()).toBeNull();
});
