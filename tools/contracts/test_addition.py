"""Add only one declaration and one handler, then exercise production routers and MCP."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DECLARATION = '        "project.contractProbe": contracts::todo::TodoId => contracts::todo::TodoId, rpc_contract_probe, all(schema(contracts::todo::TodoId, "A harmless contract fixture.")), measured("ping_p95_ms"), tool;\n'
HANDLER = '''
impl Todos {
    pub async fn rpc_contract_probe(&self, ctx: &Ctx, _method: &str, value: Value) -> Result<Value, RpcError> {
        let p: contracts::todo::TodoId = params(value)?;
        ctx.touch(contracts::Verb::Read, "c4:contractProbe")?;
        reply(&contracts::todo::TodoId {id: p.id + 1})
    }
}
'''


class Addition(unittest.TestCase):
    def test_c4_one_declaration_reaches_every_surface(self):
        with tempfile.TemporaryDirectory(prefix="c4-addition-") as directory:
            checkout = Path(directory) / "checkout"
            subprocess.run(["git", "worktree", "add", "--detach", str(checkout), "HEAD"], cwd=ROOT, check=True, capture_output=True)
            try:
                env = {**os.environ, "CARGO_TARGET_DIR": str(ROOT / "target/c4-addition")}

                def run(*args):
                    result = subprocess.run(args, cwd=checkout, env=env, text=True, capture_output=True)
                    self.assertEqual(result.returncode, 0, str({key: value for key, value in env.items() if key.startswith("C4_")}) + result.stdout + result.stderr)

                declaration = checkout / "crates/contracts/src/declarations.rs"
                original = declaration.read_text()
                declaration.write_text(original.replace("    todos_methods[\"todo\"] {\n", "    todos_methods[\"todo\"] {\n" + DECLARATION))
                handler = checkout / "crates/todos/src/dispatch.rs"
                handler.write_text(handler.read_text() + HANDLER)
                integration = checkout / "crates/rup/tests/mcp.rs"
                integration.write_text(integration.read_text() + '\n#[allow(dead_code)]\n#[path = "../src/mcp/c4_adapter.rs"]\nmod c4_adapter;\n')
                adapter = checkout / "crates/rup/src/mcp.rs"
                # The integration crate supplies its own real Daemon; binary-unit helpers are unavailable here.
                production = adapter.read_text().replace("#[cfg(test)]\nmod tests;", "")
                (adapter.parent / "mcp/c4_adapter.rs").write_text(production + "\n#[cfg(test)]\nmod c4_addition;\n")
                (adapter.parent / "mcp/c4_addition.rs").write_bytes((ROOT / "tools/contracts/fixtures/addition.rs").read_bytes())
                run("just", "contracts")
                run("cargo", "test", "-q", "-p", "rup", "--test", "mcp", "c4_one_declaration_reaches_every_surface")
                caller = checkout / "contracts/c4-addition.ts"
                caller.write_text('''import type { RpcMethods } from "./generated/methods";
import type { TodoId } from "./generated/todo/TodoId";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type C4Caller = Assert<Equal<RpcMethods["project.contractProbe"], {params: TodoId; result: TodoId}>>;
''')
                (checkout / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
                run(str(ROOT / "node_modules/.bin/tsc"), "--project", "tsconfig.json")
                caller.unlink()
                variants = [
                    ("C4_DOOR_ONLY", DECLARATION.replace(", all(", ", door(")),
                    ("C4_NO_TOOL", DECLARATION.rsplit(", all(", 1)[0] + ", none(\"Fixture has no tool\"), off_path(\"Fixture outside workload\"), text(\"A harmless contract fixture.\");\n"),
                    ("C4_REMOVED", ""),
                ]
                for mode, row in variants:
                    declaration.write_text(original.replace('    todos_methods["todo"] {\n', '    todos_methods["todo"] {\n' + row))
                    run("just", "contracts")
                    env[mode] = "1"
                    run("cargo", "test", "-q", "-p", "rup", "--test", "mcp", "c4_one_declaration_reaches_every_surface")
                    del env[mode]
                self.assertNotIn('"project.contractProbe"', (checkout / "contracts/generated/methods.ts").read_text())
                self.assertNotIn('"project.contractProbe"', (checkout / "contracts/generated/contract.ts").read_text())
            finally:
                subprocess.run(["git", "worktree", "remove", "--force", str(checkout)], cwd=ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
