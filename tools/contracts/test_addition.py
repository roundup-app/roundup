"""Add only one declaration and one handler, then exercise production routers and MCP."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DECLARATION = '        "todo.contractProbe": contracts::todo::TodoId => contracts::todo::TodoId, rpc_contract_probe, all(schema(contracts::todo::TodoId, "A harmless contract fixture."));\n'
HANDLER = '''
impl Todos {
    pub async fn rpc_contract_probe(&self, _ctx: &Ctx, _method: &str, value: Value) -> Result<Value, RpcError> {
        let p: contracts::todo::TodoId = params(value)?;
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
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

                manifest = checkout / "crates/rup/Cargo.toml"
                manifest.write_text(manifest.read_text().replace("[dev-dependencies]", '[dev-dependencies]\ntodos = { path = "../todos" }\nprovenance = { path = "../provenance" }'))
                declaration = checkout / "crates/contracts/src/declarations.rs"
                original = declaration.read_text()
                declaration.write_text(original.replace("    todos_methods {\n", "    todos_methods {\n" + DECLARATION))
                handler = checkout / "crates/todos/src/dispatch.rs"
                handler.write_text(handler.read_text() + HANDLER)
                adapter = checkout / "crates/rup/src/mcp.rs"
                adapter.write_text(adapter.read_text() + "\n#[cfg(test)]\nmod c4_addition;\n")
                (adapter.parent / "mcp/c4_addition.rs").write_bytes((ROOT / "tools/contracts/fixtures/addition.rs").read_bytes())
                run("just", "contracts")
                run("cargo", "test", "-q", "-p", "rup", "--bin", "rup", "c4_one_declaration_reaches_every_surface")
                caller = checkout / "contracts/c4-addition.ts"
                caller.write_text('''import type { RpcMethods } from "./generated/methods";
import type { TodoId } from "./generated/todo/TodoId";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type C4Caller = Assert<Equal<RpcMethods["todo.contractProbe"], {params: TodoId; result: TodoId}>>;
''')
                (checkout / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
                run(str(ROOT / "node_modules/.bin/tsc"), "--project", "tsconfig.json")
                caller.unlink()
                declaration.write_text(original)
                run("just", "contracts")
                env["C4_REMOVED"] = "1"
                run("cargo", "test", "-q", "-p", "rup", "--bin", "rup", "c4_one_declaration_reaches_every_surface")
                self.assertNotIn('"todo.contractProbe"', (checkout / "contracts/generated/methods.ts").read_text())
                self.assertNotIn('"todo.contractProbe"', (checkout / "contracts/generated/contract.ts").read_text())
            finally:
                subprocess.run(["git", "worktree", "remove", "--force", str(checkout)], cwd=ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
