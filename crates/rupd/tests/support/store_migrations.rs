use rusqlite::Connection;

pub fn schema(db: &Connection) -> Vec<(String, String)> {
    db.prepare("SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
        .unwrap()
        .query_map([], |row| {
            let sql: String = row.get(1)?;
            Ok((
                row.get(0)?,
                sql.split_whitespace()
                    .collect::<String>()
                    .replace("IFNOTEXISTS", ""),
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
