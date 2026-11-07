use rusqlite::Connection;

pub fn dump(db: &Connection) -> Vec<String> {
    dump_except(db, &[])
}

pub fn dump_except(db: &Connection, excluded: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let mut q = db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
        .unwrap();
    let rows: Vec<(String, String, Option<String>)> = q
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for (kind, name, sql) in rows {
        if excluded
            .iter()
            .any(|table| name == *table || name.starts_with(&format!("sqlite_autoindex_{table}_")))
        {
            continue;
        }
        out.push(format!("{kind} {name} {sql:?}"));
        if kind == "table" && !name.starts_with("sqlite_") && name != "deliverable_project" {
            let mut s = db.prepare(&format!("SELECT * FROM \"{name}\"")).unwrap();
            let n = s.column_count();
            let mut rows = s.query([]).unwrap();
            while let Some(r) = rows.next().unwrap() {
                let row: Vec<String> = (0..n)
                    .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                    .collect();
                out.push(format!("{name}: {}", row.join("|")));
            }
        }
    }
    out
}
