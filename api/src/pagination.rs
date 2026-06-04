//! Cursor-based pagination (Phase 9.3).
//!
//! Opaque cursors encode `{ts, id}` (base64 JSON), where `ts` is a millisecond
//! timestamp and `id` is the row id used as a stable tiebreaker. Lists are
//! ordered **`ts` DESC, then `id` ASC**; a cursor marks the last item of the
//! previous page and the next page begins strictly after it. Reusable across
//! list endpoints — adopt incrementally by implementing [`Cursorable`].

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Default / maximum page sizes.
pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 200;

#[derive(Serialize, Deserialize)]
struct CursorPayload {
    ts: i64,
    id: String,
}

/// Query string for cursor pagination: `?limit=N&cursor=<opaque>`.
#[derive(Debug, Deserialize, Default)]
pub struct CursorQuery {
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

/// Encode an opaque cursor from a millisecond timestamp + id.
pub fn encode_cursor_ms(ts_ms: i64, id: &str) -> String {
    let json = serde_json::to_vec(&CursorPayload { ts: ts_ms, id: id.to_string() }).unwrap_or_default();
    STANDARD_NO_PAD.encode(json)
}

/// Encode an opaque cursor from a `DateTime` + id.
pub fn encode_cursor(created_at: DateTime<Utc>, id: &str) -> String {
    encode_cursor_ms(created_at.timestamp_millis(), id)
}

/// Decode a cursor back into `(ts_ms, id)`. Returns `None` if malformed.
pub fn decode_cursor(s: &str) -> Option<(i64, String)> {
    let bytes = STANDARD_NO_PAD.decode(s).ok()?;
    let p: CursorPayload = serde_json::from_slice(&bytes).ok()?;
    Some((p.ts, p.id))
}

/// The sort key for a paginated item.
pub trait Cursorable {
    fn cursor_ts(&self) -> i64; // milliseconds
    fn cursor_id(&self) -> String;
}

/// Paginate items **already sorted `ts` DESC, `id` ASC** by an opaque cursor.
///
/// Returns the page plus `next_cursor` (None when the list is exhausted). The
/// limit is clamped to `[1, MAX_LIMIT]`.
pub fn paginate_cursor<T: Cursorable + Clone>(
    items: &[T],
    cursor: Option<&str>,
    limit: Option<usize>,
) -> (Vec<T>, Option<String>) {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let start = match cursor.and_then(decode_cursor) {
        Some((ts, id)) => items
            .iter()
            .position(|it| {
                it.cursor_ts() < ts || (it.cursor_ts() == ts && it.cursor_id() > id)
            })
            .unwrap_or(items.len()),
        None => 0,
    };

    let page: Vec<T> = items.iter().skip(start).take(limit).cloned().collect();
    let next = if start + page.len() < items.len() {
        page.last().map(|it| encode_cursor_ms(it.cursor_ts(), &it.cursor_id()))
    } else {
        None
    };
    (page, next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct Item {
        ts: i64,
        id: String,
    }
    impl Cursorable for Item {
        fn cursor_ts(&self) -> i64 {
            self.ts
        }
        fn cursor_id(&self) -> String {
            self.id.clone()
        }
    }

    fn sample() -> Vec<Item> {
        // Sorted ts DESC.
        vec![
            Item { ts: 500, id: "e".into() },
            Item { ts: 400, id: "d".into() },
            Item { ts: 300, id: "c".into() },
            Item { ts: 200, id: "b".into() },
            Item { ts: 100, id: "a".into() },
        ]
    }

    #[test]
    fn cursor_round_trips() {
        let c = encode_cursor_ms(400, "d");
        assert_eq!(decode_cursor(&c), Some((400, "d".to_string())));
        assert_eq!(decode_cursor("not-base64!!"), None);
    }

    #[test]
    fn first_page_then_follow_cursor() {
        let items = sample();
        let (page1, next1) = paginate_cursor(&items, None, Some(2));
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].id, "e");
        assert!(next1.is_some());

        let (page2, next2) = paginate_cursor(&items, next1.as_deref(), Some(2));
        assert_eq!(page2.iter().map(|i| i.id.clone()).collect::<Vec<_>>(), vec!["c", "b"]);
        assert!(next2.is_some());

        let (page3, next3) = paginate_cursor(&items, next2.as_deref(), Some(2));
        assert_eq!(page3.iter().map(|i| i.id.clone()).collect::<Vec<_>>(), vec!["a"]);
        assert!(next3.is_none()); // exhausted
    }

    #[test]
    fn limit_is_clamped() {
        let items = sample();
        let (page, _) = paginate_cursor(&items, None, Some(99999));
        assert_eq!(page.len(), items.len());
    }
}
