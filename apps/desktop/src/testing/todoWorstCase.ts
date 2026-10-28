import type { Controls } from "./seeds";

/** U363: a harness-only switch that replaces the Todo fixture through the same calls as the user. */
export const mountTodoWorstCase = (controls: Controls) => {
  const group = document.createElement("div");
  group.setAttribute("aria-label", "Todo fixture");
  group.className = "todo-fixture";
  const button = document.createElement("button");
  button.dataset.button = "quiet";
  button.textContent = "Demo data / Worst case";
  const count = document.createElement("button");
  count.dataset.button = "quiet";
  count.value = "200";
  count.textContent = "200 Todos";
  count.setAttribute("aria-label", "Todo count");

  let worst = false;
  let busy = false;
  const app = controls.app;

  const update = async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    count.disabled = true;
    controls.actAs({kind: "user", id: "you", parent: null});
    const before = await app.rpc("todo.list", null);

    for (const todo of before) await app.rpc("todo.delete", { operation: crypto.randomUUID(), ids: [todo.id] });
    const amount = worst ? Number(count.value) : 8;
    const titles = ["Review the deployment plan ".repeat(12).slice(0, 300), "J", "🧭", "確認してから変更を公開する", "Confirm that all deployment checks pass".padEnd(40, ".")];
    const blockers: number[] = [];

    for (let index = 0; index < amount; index++) {
      const made = await app.rpc("todo.create", {
        title: worst ? index === 10 ? "Wait for ten reviews" : titles[index % titles.length]! : `Todo ${index + 1}`,
        body: null,
        blockers: worst && index === 10 ? blockers : null,
      });

      if (index < 10) blockers.push(made.id);
    }

    const stream = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream");

    if (stream) await app.rpc("rail.rename", {id: stream.id, name: worst ? "Review deployment changes for the next production release".padEnd(60, ".") : "backend"});
    busy = false;
    button.disabled = false;
    count.disabled = false;
    button.setAttribute("aria-pressed", String(worst));
  };

  button.onclick = () => { worst = !worst; void update(); };

  count.onclick = () => {
    count.value = count.value === "200" ? "0" : "200";
    count.textContent = `${count.value} Todos`;

    if (worst) void update();
  };

  group.append(button, count);
  // Kept outside the App so the harness fixture controls cannot change its row geometry.
  document.body.append(group);
};
