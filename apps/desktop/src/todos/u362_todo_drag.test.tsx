import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node, workstream } from "../testing/nodes";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const mount = async () => {
  const result = await mountTodos([todo(1)], true, [workstream('r1', { name: 'alpha' }), node("a")], true);
  await screen.findByRole('button', { name: 'Idle #1 todo 1' });

  return result;
};

it('u362_project_root_selection_follows_the_rail_selection', async () => {
  const mounted = await mount();
  const root = screen.getByRole('button', {name: 'Project root'});
  mounted.connected.rail.select(null);
  expect(root.getAttribute('aria-pressed')).toBe('true');
  mounted.connected.rail.select('r1');
  expect(root.getAttribute('aria-pressed')).toBe('false');
  mounted.connected.rail.select(null);
  expect(root.getAttribute('aria-pressed')).toBe('true');
});
