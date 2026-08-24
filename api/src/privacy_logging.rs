//! Last-resort sanitization for application log messages.
//!
//! Structured audit records are the system of record. Operational logs must
//! never become an alternative store for patient, wallet, credential, or
//! clinical identifiers. Existing code still uses `log::*` broadly, so this
//! module places a conservative filter at that shared output boundary.

use std::fmt::Write;

/// Replace recognizable sensitive values with a non-reversible marker.
///
/// This is a defence-in-depth sink control, not permission to log sensitive
/// fields. Call sites should still log operation and request identifiers rather
/// than clinical or identity data.
pub fn redact_message(message: &str) -> String {
    message
        .split_whitespace()
        .map(redact_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_token(token: &str) -> String {
    if let Some((field, value)) = token.split_once('=') {
        if is_sensitive_field(field) || is_sensitive_value(value) {
            return format!("{field}=[REDACTED]");
        }
    }
    let (prefix, core, suffix) = split_punctuation(token);
    if is_sensitive_value(core) {
        format!("{prefix}[REDACTED]{suffix}")
    } else {
        token.to_string()
    }
}

fn is_sensitive_field(field: &str) -> bool {
    let field = field.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_');
    matches!(
        field.to_ascii_lowercase().as_str(),
        "patient"
            | "patient_id"
            | "wallet"
            | "wallet_address"
            | "national_id"
            | "token"
            | "access_token"
            | "refresh_token"
            | "authorization"
            | "email"
            | "phone"
    )
}

fn split_punctuation(token: &str) -> (&str, &str, &str) {
    let start = token
        .find(|c: char| c.is_ascii_alphanumeric() || c == '0')
        .unwrap_or(token.len());
    let end = token
        .rfind(|c: char| c.is_ascii_alphanumeric())
        .map(|index| index + 1)
        .unwrap_or(start);
    (&token[..start], &token[start..end], &token[end..])
}

fn is_sensitive_value(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    value.contains('@')
        || looks_like_wallet(value)
        || looks_like_uuid(value)
        || [
            "PAT-", "MCHI-", "NATIONAL", "ID-", "TOKEN-", "JWT-", "SOAP-", "LAB-",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix))
}

fn looks_like_wallet(value: &str) -> bool {
    value.len() >= 45
        && value.len() <= 64
        && value.starts_with('5')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() && !matches!(byte, b'0' | b'O' | b'I' | b'l'))
}

fn looks_like_uuid(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    [8, 4, 4, 4, 12]
        == parts
            .iter()
            .map(|part| part.len())
            .collect::<Vec<_>>()
            .as_slice()
        && parts
            .iter()
            .all(|part| part.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// Formats a sanitised record for the shared logger backend.
pub fn format_record(record: &log::Record<'_>) -> String {
    let mut rendered = String::new();
    let _ = write!(&mut rendered, "{}", record.args());
    redact_message(&rendered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_wallet_patient_email_and_uuid_values() {
        let raw = "wallet 5F3sa2TJAWMqDhXG6jhV4N8ko9p7w5A9Y5LwZC3FyLw7fJQ patient PAT-001 email patient@example.test id 123e4567-e89b-12d3-a456-426614174000 wallet_address=5F3sa2TJAWMqDhXG6jhV4N8ko9p7w5A9Y5LwZC3FyLw7fJQ";
        let redacted = redact_message(raw);
        assert!(!redacted.contains("5F3sa2TJAWMqDhXG6jhV4N8ko9p7w5A9Y5LwZC3FyLw7fJQ"));
        assert!(!redacted.contains("PAT-001"));
        assert!(!redacted.contains("patient@example.test"));
        assert!(!redacted.contains("123e4567-e89b-12d3-a456-426614174000"));
        assert_eq!(redacted.matches("[REDACTED]").count(), 5);
    }

    #[test]
    fn shared_log_record_formatter_uses_the_redactor() {
        let record = log::Record::builder()
            .args(format_args!(
                "patient PAT-001 wallet 5F3sa2TJAWMqDhXG6jhV4N8ko9p7w5A9Y5LwZC3FyLw7fJQ"
            ))
            .level(log::Level::Error)
            .target("medichain_api::clinical")
            .build();
        let rendered = format_record(&record);

        assert!(!rendered.contains("PAT-001"));
        assert!(!rendered.contains("5F3sa2TJAWMqDhXG6jhV4N8ko9p7w5A9Y5LwZC3FyLw7fJQ"));
    }

    #[test]
    fn masks_identifiers_embedded_in_operational_error_messages() {
        let record_id = "123e4567-e89b-12d3-a456-426614174000";
        let session_id = "123e4567-e89b-12d3-a456-426614174001";
        let raw = format!(
            "record {record_id} lookup failed; telehealth session ({session_id}) audit failed"
        );
        let redacted = redact_message(&raw);

        assert!(!redacted.contains(record_id));
        assert!(!redacted.contains(session_id));
        assert_eq!(redacted.matches("[REDACTED]").count(), 2);
    }
}
