import { For, Match, Show, Switch, createResource } from "solid-js";
import { Markdown } from "../plain/Markdown";
import "./styles.css";
import { useConnectedProject } from "../state/connectedProject";

type SpawnRead = { prompt: string | null; error: string | null };

/** O6: the whole order of one Agent or Door. What it shows follows the Rail, so a changed order reaches it. */
export const OrderDrawer = (props: { id: string }) => {
  const { rail, app } = useConnectedProject();
  const node = () => rail.nodes.find((each) => each.id === props.id);
  const order = () => node()?.work ?? null;

  /** O10: read when the Drawer opens, never on the Rail; a failed read keeps its text. */
  const [spawn] = createResource(() => props.id, async (id): Promise<SpawnRead> => {
    try {
      const answer = await app.rpc("agent.spawnPrompt", { id });

      return { prompt: answer.prompt, error: null };
    } catch (thrown) {
      return { prompt: null, error: thrown instanceof Error ? thrown.message : "the prompt could not be read" };
    }
  });

  return (
    <section
      class="order-drawer"
      aria-label={`full order of ${node()?.name ?? props.id}`}
    >
      <Switch>
        <Match when={order()} keyed>
          {(each) =>
            each.kind === "work" ? (
              <>
                <Markdown class="order-ask" body={each.ask} />
                <Show when={each.done}>
                  {(done) => (
                    <>
                      <h3 class="order-part-label">done when</h3>
                      <Markdown class="order-done" body={done()} />
                    </>
                  )}
                </Show>
                <Show when={each.limits.length > 0}>
                  <h3 class="order-part-label">limits</h3>
                  <ul class="order-limits">
                    <For each={each.limits}>{(limit) => <li><Markdown body={limit} /></li>}</For>
                  </ul>
                </Show>
                <Show when={spawn()?.prompt ?? spawn()?.error}>
                  {(text) => (
                    <details class="order-prompt">
                      <summary>prompt</summary>
                      <Show
                        when={spawn()?.error === null}
                        fallback={<p class="order-prompt-error">{text()}</p>}
                      >
                        <Markdown class="order-prompt-body" body={text()} />
                      </Show>
                    </details>
                  )}
                </Show>
              </>
            ) : (
              <Markdown class="order-ask" body={each.question} />
            )
          }
        </Match>
      </Switch>
    </section>
  );
};
