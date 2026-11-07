//! N22: columns that hold a word or a JSON document read and write through a type, never a bare string.
use std::{fmt::Display, str::FromStr};

use rusqlite::{
    Result,
    types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef},
};
use serde::{Serialize, de::DeserializeOwned};

/// A column holding `T`'s word (`Display`); a stored word `T` does not parse fails the read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Word<T>(pub T);

impl<T: FromStr> FromSql for Word<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        value
            .as_str()?
            .parse()
            .map(Word)
            .map_err(|e| FromSqlError::Other(Box::new(e)))
    }
}

impl<T: Display> ToSql for Word<T> {
    fn to_sql(&self) -> Result<ToSqlOutput<'_>> {
        Ok(self.0.to_string().into())
    }
}

/// A column holding `T` as one JSON document; a document `T` does not read fails the read.
#[derive(Debug, Clone, PartialEq)]
pub struct Json<T>(pub T);

impl<T: DeserializeOwned> FromSql for Json<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        serde_json::from_slice(value.as_bytes()?)
            .map(Json)
            .map_err(|e| FromSqlError::Other(Box::new(e)))
    }
}

impl<T: Serialize> ToSql for Json<T> {
    fn to_sql(&self) -> Result<ToSqlOutput<'_>> {
        serde_json::to_string(&self.0)
            .map(Into::into)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[derive(Debug, PartialEq)]
    enum Mode {
        Open,
        Done,
    }

    impl FromStr for Mode {
        type Err = std::fmt::Error;
        fn from_str(word: &str) -> std::result::Result<Self, Self::Err> {
            match word {
                "open" => Ok(Mode::Open),
                "done" => Ok(Mode::Done),
                _ => Err(std::fmt::Error),
            }
        }
    }

    impl Display for Mode {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(match self {
                Mode::Open => "open",
                Mode::Done => "done",
            })
        }
    }

    #[test]
    fn n22_a_stored_word_reads_back_and_an_unknown_one_fails_the_read() {
        let db = Connection::open_in_memory().unwrap();
        db.execute("CREATE TABLE t(w TEXT)", []).unwrap();
        db.execute("INSERT INTO t VALUES(?1)", [Word(Mode::Done)])
            .unwrap();
        let read =
            |db: &Connection| db.query_row("SELECT w FROM t", [], |r| r.get::<_, Word<Mode>>(0));
        assert_eq!(read(&db).unwrap(), Word(Mode::Done));
        db.execute("UPDATE t SET w='shelved'", []).unwrap();
        assert!(read(&db).is_err());
        assert_ne!(Word(Mode::Open), Word(Mode::Done));
    }

    #[test]
    fn n22_a_json_document_reads_back_and_a_malformed_one_fails_the_read() {
        let db = Connection::open_in_memory().unwrap();
        db.execute("CREATE TABLE t(j TEXT)", []).unwrap();
        db.execute("INSERT INTO t VALUES(?1)", [Json(vec![1, 2])])
            .unwrap();
        let read =
            |db: &Connection| db.query_row("SELECT j FROM t", [], |r| r.get::<_, Json<Vec<u8>>>(0));
        assert_eq!(read(&db).unwrap(), Json(vec![1, 2]));
        db.execute("UPDATE t SET j='{'", []).unwrap();
        assert!(read(&db).is_err());
    }
}
