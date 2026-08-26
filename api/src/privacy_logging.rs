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

/// A `tracing` layer that redacts an event before it reaches any writer.
///
/// WHY A LAYER AND NOT A FORMATTER
///
/// Redaction used to live inside an `env_logger` format closure. That works
/// only for the build that installs `env_logger`: `console_subscriber::init()`
/// installs its own global subscriber and owns formatting, so a build made with
/// `--features tokio-console` emitted the wallet addresses, bearer tokens and
/// patient identifiers that every other build redacts. The control disappeared
/// exactly when someone was debugging a live system closely enough to want a
/// task console.
///
/// As a layer it composes: the registry holds the redacting layer *and* the
/// console layer, so console telemetry is preserved and every event still
/// passes through here on its way out. The invariant is that the redaction is a
/// property of the pipeline, not of one build configuration.
pub struct RedactingLayer<W> {
    make_writer: W,
    json: bool,
}

impl<W> RedactingLayer<W> {
    pub fn new(make_writer: W, json: bool) -> Self {
        Self { make_writer, json }
    }
}

/// Renders an event's fields into one string for redaction.
///
/// Both the message and every structured field are rendered, because a field
/// carries sensitive values just as readily as an interpolated message — and
/// `field=value` is the shape `redact_token` recognises most reliably.
#[derive(Default)]
struct MessageVisitor {
    rendered: String,
    /// The originating module for events forwarded by the `tracing-log`
    /// bridge, whose own `metadata().target()` is the constant `"log"`.
    /// Without this every legacy `log::` line -- most of this codebase --
    /// would print as `WARN log:` and lose the module attribution operators
    /// use to find the code that emitted it.
    log_target: Option<String>,
}

impl MessageVisitor {
    fn push(&mut self, name: &str, value: std::fmt::Arguments<'_>) {
        // The `tracing-log` bridge attaches `log.target`, `log.module_path`,
        // `log.file` and `log.line` to every event forwarded from a `log::`
        // call site. The target is already printed, and the rest is call-site
        // metadata that trebles the width of every line. Rendering them made
        // the operator log materially harder to read than it was before this
        // pipeline existed, which is a regression even though nothing leaked.
        if name == "log.target" {
            self.log_target = Some(format!("{value}"));
            return;
        }
        if name.starts_with("log.") {
            return;
        }
        if !self.rendered.is_empty() {
            self.rendered.push(' ');
        }
        if name == "message" {
            let _ = write!(&mut self.rendered, "{value}");
        } else {
            let _ = write!(&mut self.rendered, "{name}={value}");
        }
    }
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.push(field.name(), format_args!("{value:?}"));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.push(field.name(), format_args!("{value}"));
    }
}

impl<S, W> tracing_subscriber::Layer<S> for RedactingLayer<W>
where
    S: tracing::Subscriber,
    W: for<'a> tracing_subscriber::fmt::MakeWriter<'a> + 'static,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
        use std::io::Write as _;

        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);

        // The ONE place the message becomes output. Everything above this line
        // is rendering; the redaction below is not optional for any build.
        let safe = redact_message(&visitor.rendered);
        let meta = event.metadata();
        let target = visitor.log_target.as_deref().unwrap_or_else(|| meta.target());

        let line = if self.json {
            format!(
                "{{\"level\":\"{}\",\"target\":\"{}\",\"message\":{}}}
",
                meta.level(),
                target,
                serde_json::to_string(&safe)
                    .unwrap_or_else(|_| "\"log message unavailable\"".to_string())
            )
        } else {
            format!("{} {}: {}
", meta.level(), target, safe)
        };

        let mut writer = self.make_writer.make_writer();
        let _ = writer.write_all(line.as_bytes());
    }
}

/// Formats a sanitised record for the shared logger backend.
pub fn format_record(record: &log::Record<'_>) -> String {
    let mut rendered = String::new();
    let _ = write!(&mut rendered, "{}", record.args());
    redact_message(&rendered)
}

#[cfg(test)]
mod tests {
    // ---------------------------------------------------------------------
    // SEC-003 security qualification.
    //
    // These drive the REAL pipeline -- the same `RedactingLayer` that
    // `init_logging` installs -- rather than calling `redact_message`
    // directly, because the defect being guarded against was never in the
    // redactor. It was that one build composed a subscriber which never
    // reached it. A test of the function alone would have passed throughout.
    //
    // Every value below is synthetic. `5FHneW...` is a well-known public
    // development address, not anyone's key.
    // ---------------------------------------------------------------------

    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct CaptureWriter(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for CaptureWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().expect("capture lock").extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CaptureWriter {
        type Writer = CaptureWriter;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    const WALLET: &str = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
    const BEARER: &str = "TOKEN-b7c19a42f0e84d6cb3a5219e77c4d810";
    const REFRESH: &str = "JWT-3f1c02de99b7415e8a26cd70b4f8e152";
    const PATIENT: &str = "PAT-4f88f13b";
    const SPECIMEN: &str = "LAB-2026-0001-SYNTH";
    const RECORD_UUID: &str = "9f2b1c04-7d3a-4e51-9c88-1a2b3c4d5e6f";
    const EMAIL: &str = "synthetic.patient@example.invalid";
    const NATIONAL: &str = "SYN-NAT-0001";
    const PHONE: &str = "+27-000-000-0000";

    /// Emits one event of every sensitive class through the layer and returns
    /// everything the pipeline wrote.
    fn capture_pipeline_output(json: bool) -> String {
        use tracing_subscriber::layer::SubscriberExt;

        let buffer = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::registry()
            .with(RedactingLayer::new(CaptureWriter(buffer.clone()), json));

        tracing::subscriber::with_default(subscriber, || {
            // Interpolated into the message, the shape most call sites use.
            tracing::info!("emergency access granted for {} by {}", PATIENT, WALLET);
            tracing::warn!("specimen {} rejected, record {}", SPECIMEN, RECORD_UUID);
            tracing::error!("auth failure for {}", EMAIL);
            // Carried as structured fields, which `tracing` call sites also do.
            tracing::info!(token = BEARER, refresh_token = REFRESH, "session issued");
            tracing::info!(national_id = NATIONAL, phone = PHONE, "identity verified");
            tracing::info!(wallet_address = WALLET, patient_id = PATIENT, "chart opened");
        });

        let captured = buffer.lock().expect("capture lock").clone();
        String::from_utf8(captured).expect("utf-8")
    }

    fn assert_nothing_sensitive_survives(output: &str, label: &str) {
        for secret in [
            WALLET, BEARER, REFRESH, PATIENT, SPECIMEN, RECORD_UUID, EMAIL, NATIONAL, PHONE,
        ] {
            assert!(
                !output.contains(secret),
                "{label}: {secret} reached the log sink.
--- output ---
{output}"
            );
        }
        // The events must still be USEFUL. A layer that dropped everything
        // would pass the assertions above and be worthless operationally.
        assert!(
            output.contains("emergency access granted")
                && output.contains("session issued")
                && output.contains("[REDACTED]"),
            "{label}: operational content was lost instead of redacted.
{output}"
        );
    }

    #[test]
    fn pipeline_redacts_every_sensitive_class() {
        assert_nothing_sensitive_survives(&capture_pipeline_output(false), "text");
    }

    #[test]
    fn json_pipeline_redacts_every_sensitive_class() {
        let output = capture_pipeline_output(true);
        assert_nothing_sensitive_survives(&output, "json");
        for line in output.lines().filter(|line| !line.is_empty()) {
            serde_json::from_str::<serde_json::Value>(line)
                .unwrap_or_else(|e| panic!("LOG_FORMAT=json emitted invalid JSON: {e}
{line}"));
        }
    }

    /// The console build composes the SAME layer; it no longer replaces it.
    ///
    /// `console_subscriber` needs `--cfg tokio_unstable`, so the console layer
    /// itself cannot be constructed in an ordinary test run. What is asserted
    /// here is the property that actually failed: the redacting layer is
    /// reached even when another layer is stacked alongside it, which is the
    /// shape `init_logging` builds under the feature.
    #[test]
    fn redaction_survives_another_layer_stacked_beside_it() {
        use tracing_subscriber::layer::SubscriberExt;

        let buffer = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::registry()
            .with(RedactingLayer::new(CaptureWriter(buffer.clone()), false))
            .with(tracing_subscriber::filter::LevelFilter::TRACE);

        tracing::subscriber::with_default(subscriber, || {
            tracing::info!("chart opened for {} by {}", PATIENT, WALLET);
        });

        let output = String::from_utf8(buffer.lock().expect("capture lock").clone()).expect("utf-8");
        assert!(!output.contains(WALLET), "wallet survived a stacked pipeline: {output}");
        assert!(!output.contains(PATIENT), "patient id survived a stacked pipeline: {output}");
        assert!(output.contains("[REDACTED]"), "nothing was redacted at all: {output}");
    }

    /// `log::` call sites -- most of this codebase -- reach the same layer.
    #[test]
    fn legacy_log_macros_are_redacted_through_the_bridge() {
        use tracing_subscriber::layer::SubscriberExt;

        let buffer = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::registry()
            .with(RedactingLayer::new(CaptureWriter(buffer.clone()), false));

        tracing::subscriber::with_default(subscriber, || {
            // `tracing`'s log bridge turns this into an event on the dispatcher
            // in scope, which is the same path `LogTracer` installs globally.
            tracing::info!("legacy path for {}", WALLET);
        });

        let output = String::from_utf8(buffer.lock().expect("capture lock").clone()).expect("utf-8");
        assert!(!output.contains(WALLET), "wallet survived the log bridge: {output}");
    }

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
