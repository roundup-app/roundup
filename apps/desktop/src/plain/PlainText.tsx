import { For, Index } from "solid-js";
import { blocksOf, spansOf } from "./blocks";
import "./styles.css";

/** Q3: generated text as hold:Plain lays it out: left-aligned, in `--font-ui`, a status reply as a table. */
export const PlainText = (props: { body: string; id?: number; status?: string }) => (
  <div class="thread-body plain-text" data-message={props.id} data-message-body data-status={props.status}>
    <For each={blocksOf(props.body)}>
      {(block) =>
        block.kind === "table" ? (
          <table class="plain-table">
            <thead>
              <tr>
                <Index each={block.head}>{(cell) => <th>{cell()}</th>}</Index>
              </tr>
            </thead>
            <tbody>
              <For each={block.rows}>{(row) => <tr><Index each={row}>{(cell) => <td>{cell()}</td>}</Index></tr>}</For>
            </tbody>
          </table>
        ) : block.kind === "code" ? (
          <pre class="plain-fence"><code>{block.text}</code></pre>
        ) : (
          <p class="plain-paragraph">
            <For each={spansOf(block.text)}>{(span) => (span.code ? <code>{span.text}</code> : span.text)}</For>
          </p>
        )
      }
    </For>
  </div>
);
