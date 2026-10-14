"""Apply temporary owner-read attribution; never ship this instrumentation."""
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[4]
p = root / 'crates/agents/src/rail.rs'
s = p.read_text()
s = s.replace('impl Rail {', 'thread_local! { pub(crate) static OWNER_TIMING: std::cell::Cell<(u128, u128)> = const { std::cell::Cell::new((0, 0)) }; }\n\nimpl Rail {', 1)
a = s.index('        let mut query = self', s.index('    pub fn terminal_owner('))
b = s.index('\n    }', a)
body = s[a:b]
marker = '        let mut rows = query.query([terminal]).map_err(sql)?;'
prepare, execute = body.split(marker)
s = s[:a] + '        let started = std::time::Instant::now();\n' + prepare + '        let prepared = std::time::Instant::now();\n        let result = (|| {\n' + marker + execute + '\n        })();\n        OWNER_TIMING.set((prepared.duration_since(started).as_nanos(), prepared.elapsed().as_nanos()));\n        result' + s[b:]
p.write_text(s)
p = root / 'crates/agents/src/lib.rs'
s = p.read_text()
a = s.index('        let rail = self.shared.rail();', s.index('    pub fn with_terminal_owner<R>('))
b = s.index('\n    }', a)
body = s[a:b].replace('        let rail = self.shared.rail();', '        let started = std::time::Instant::now();\n        let rail = self.shared.rail();\n        let rail_locked = std::time::Instant::now();').replace('        let runs = self.shared.runs();', '        let runs = self.shared.runs();\n        let attempts_locked = std::time::Instant::now();')
body = body.replace('        record(owner.as_ref())', '        let resolved = std::time::Instant::now();\n        let result = record(owner.as_ref());\n        let recorded = std::time::Instant::now();\n        let (prepare_ns, query_ns) = rail::OWNER_TIMING.get();\n        drop(runs);\n        drop(rail);\n        eprintln!("TRACE owner_read {} {} {} {} {} {}", rail_locked.duration_since(started).as_nanos(), attempts_locked.duration_since(rail_locked).as_nanos(), prepare_ns, query_ns, resolved.duration_since(started).as_nanos(), recorded.duration_since(resolved).as_nanos());\n        result')
p.write_text(s[:a] + body + s[b:])
