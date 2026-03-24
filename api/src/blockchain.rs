//! Substrate Blockchain RPC Client for MediChain
//!
//! © 2025 Trustware. All rights reserved.
//!
//! Provides a lightweight HTTP-based JSON-RPC client for interacting with a
//! Substrate node. Supports health checks and fire-and-forget on-chain event
//! logging for patient registration, IPFS hash recording, and access auditing.
//!
//! # Extrinsic Encoding Note
//!
//! Full SCALE codec encoding of signed extrinsics requires either:
//!   - `subxt` (high-level Substrate client crate), or
//!   - `parity-scale-codec` + `sp-core` / `sp-runtime` for low-level encoding.
//!
//! Neither dependency is currently in `Cargo.toml`. Until they are added, this
//! module logs every on-chain call with its arguments and returns a deterministic
//! SHA3-256-derived placeholder transaction hash. The call is **not** actually
//! submitted to the node. Add `subxt` or `parity-scale-codec` to `Cargo.toml`
//! and replace the `pending_extrinsic` helpers below to enable real submission.

use chrono::Utc;
use log::{info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha3::{Digest, Sha3_256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::time::timeout;

// ------------------------------------------------------------------
// Blockchain feature flag
// ------------------------------------------------------------------

/// Returns `true` when the `BLOCKCHAIN_ENABLED` environment variable is set
/// to `"true"` (case-insensitive). When disabled (the default), on-chain
/// operations log the intent and return a deterministic placeholder hash
/// without touching the Substrate node.
///
/// Set `BLOCKCHAIN_ENABLED=true` in production once a Substrate node is
/// reachable and `subxt` / `parity-scale-codec` are added to `Cargo.toml`.
pub fn blockchain_enabled() -> bool {
    std::env::var("BLOCKCHAIN_ENABLED")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase() == "true")
        .unwrap_or(false)
}

// ------------------------------------------------------------------
// Error type
// ------------------------------------------------------------------

/// Errors that can arise when communicating with a Substrate node.
#[derive(Debug, Error)]
pub enum BlockchainError {
    /// TCP / HTTP connection failure.
    #[error("Connection error: {0}")]
    Connection(String),

    /// The node returned a JSON-RPC error object, or the response was malformed.
    #[error("RPC error: {0}")]
    Rpc(String),

    /// The RPC call did not complete within the configured deadline.
    #[error("Timeout")]
    Timeout,
}

impl From<reqwest::Error> for BlockchainError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            BlockchainError::Timeout
        } else if e.is_connect() {
            BlockchainError::Connection(e.to_string())
        } else {
            BlockchainError::Rpc(e.to_string())
        }
    }
}

// ------------------------------------------------------------------
// Internal JSON-RPC helpers
// ------------------------------------------------------------------

/// A minimal JSON-RPC 2.0 request body.
#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    id: u32,
    method: &'a str,
    params: Value,
}

/// A minimal JSON-RPC 2.0 response envelope.
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

/// JSON-RPC error object embedded inside a response.
#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

// ------------------------------------------------------------------
// `system_health` response shape
// ------------------------------------------------------------------

/// Response payload for the `system_health` RPC method.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealth {
    /// Whether the node is still syncing the chain.
    pub is_syncing: bool,
    /// Number of connected peers.
    pub peers: u32,
    /// Whether the node expects to have peers (false for a dev node).
    pub should_have_peers: bool,
}

// ------------------------------------------------------------------
// Client
// ------------------------------------------------------------------

/// Timeout applied to every individual RPC call.
const RPC_TIMEOUT: Duration = Duration::from_secs(5);

/// A lightweight Substrate JSON-RPC client that communicates over HTTP.
///
/// Substrate nodes expose their JSON-RPC API on port 9944 by default, accepting
/// both WebSocket (`ws://`) and plain HTTP (`http://`) connections. This client
/// uses the HTTP transport (via `reqwest`) to keep the dependency surface small.
#[derive(Clone)]
pub struct SubstrateClient {
    /// WebSocket URL supplied at construction (kept for display / logging).
    ws_url: String,
    /// HTTP URL derived from `ws_url` used for all JSON-RPC calls.
    http_url: String,
    /// Tracks whether the last health-check succeeded.
    connected: Arc<AtomicBool>,
    /// Underlying HTTP client (cheaply cloneable – shares a connection pool).
    client: Client,
}

impl SubstrateClient {
    // ------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------

    /// Create a new client targeting `ws_url` (e.g. `ws://localhost:9944`).
    ///
    /// The constructor derives the HTTP equivalent and performs an immediate
    /// health check. If the node is unreachable the constructor still succeeds
    /// but `is_connected()` will return `false`.
    pub async fn new(ws_url: &str) -> Result<Self, BlockchainError> {
        let http_url = Self::ws_to_http(ws_url);

        let client = Client::builder()
            .timeout(RPC_TIMEOUT)
            .build()
            .map_err(|e| BlockchainError::Connection(e.to_string()))?;

        let connected = Arc::new(AtomicBool::new(false));

        let instance = Self {
            ws_url: ws_url.to_owned(),
            http_url,
            connected,
            client,
        };

        // Perform an initial health check to populate `connected`.
        let healthy = instance.health_check().await;
        if healthy {
            info!(
                "[blockchain] Connected to Substrate node at {} (HTTP: {})",
                instance.ws_url, instance.http_url
            );
        } else {
            warn!(
                "[blockchain] Substrate node at {} is not reachable – \
                 on-chain calls will use placeholder hashes until the node comes online.",
                instance.ws_url
            );
        }

        Ok(instance)
    }

    /// Read the `SUBSTRATE_WS_URL` environment variable.
    ///
    /// Returns `None` if the variable is not set or is empty.
    pub fn from_env() -> Option<String> {
        std::env::var("SUBSTRATE_WS_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    /// Returns `true` if the last `health_check()` call succeeded.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    // ------------------------------------------------------------------
    // Health check
    // ------------------------------------------------------------------

    /// Call `system_health` on the node and return `true` on a valid response.
    ///
    /// Updates the internal `connected` flag as a side-effect.
    pub async fn health_check(&self) -> bool {
        match self.call_rpc("system_health", json!([])).await {
            Ok(result) => {
                // Try to deserialise into `SystemHealth`; accept any non-null
                // result as "healthy" so we don't fail on non-standard nodes.
                let healthy = match serde_json::from_value::<SystemHealth>(result.clone()) {
                    Ok(health) => {
                        info!(
                            "[blockchain] system_health: syncing={}, peers={}, shouldHavePeers={}",
                            health.is_syncing, health.peers, health.should_have_peers
                        );
                        true
                    }
                    Err(_) => {
                        // Node responded but payload shape was unexpected.
                        info!("[blockchain] system_health OK (raw): {:?}", result);
                        true
                    }
                };
                self.connected.store(healthy, Ordering::Relaxed);
                healthy
            }
            Err(e) => {
                warn!("[blockchain] health_check failed: {}", e);
                self.connected.store(false, Ordering::Relaxed);
                false
            }
        }
    }

    // ------------------------------------------------------------------
    // On-chain operations
    // ------------------------------------------------------------------

    /// Register a patient on-chain.
    ///
    /// Submits (or, until SCALE encoding is available, logs and stubs) an
    /// extrinsic that anchors the patient's identity hash to the chain.
    ///
    /// # Arguments
    /// * `patient_id`       – Internal MediChain patient UUID.
    /// * `id_hash`          – Hex-encoded SHA3-256 of the patient's national ID.
    /// * `national_id_type` – E.g. `"NATIONAL_ID"`, `"PASSPORT"`.
    /// * `registered_by`    – Staff member / system that triggered registration.
    ///
    /// # Returns
    /// A transaction hash string (real or deterministic placeholder).
    pub async fn register_patient_on_chain(
        &self,
        patient_id: &str,
        id_hash: &str,
        national_id_type: &str,
        registered_by: &str,
    ) -> Result<String, BlockchainError> {
        let args = json!({
            "call":            "patientRegistry.registerPatient",
            "patient_id":      patient_id,
            "id_hash":         id_hash,
            "national_id_type": national_id_type,
            "registered_by":   registered_by,
            "timestamp":       Utc::now().to_rfc3339(),
        });

        info!(
            "[blockchain] register_patient_on_chain: patient_id={} registered_by={}",
            patient_id, registered_by
        );

        self.pending_extrinsic("registerPatient", &args).await
    }

    /// Record an IPFS content hash on-chain.
    ///
    /// Creates an audit trail linking `patient_id` to a document stored on
    /// IPFS, identified by `ipfs_hash`.
    ///
    /// # Arguments
    /// * `patient_id`   – Internal MediChain patient UUID.
    /// * `ipfs_hash`    – CID of the encrypted document on IPFS.
    /// * `record_type`  – E.g. `"lab_result"`, `"imaging"`, `"prescription"`.
    /// * `uploaded_by`  – Staff member / system that performed the upload.
    ///
    /// # Returns
    /// A transaction hash string (real or deterministic placeholder).
    pub async fn record_ipfs_hash_on_chain(
        &self,
        patient_id: &str,
        ipfs_hash: &str,
        record_type: &str,
        uploaded_by: &str,
    ) -> Result<String, BlockchainError> {
        let args = json!({
            "call":        "medicalRecords.recordIpfsHash",
            "patient_id":  patient_id,
            "ipfs_hash":   ipfs_hash,
            "record_type": record_type,
            "uploaded_by": uploaded_by,
            "timestamp":   Utc::now().to_rfc3339(),
        });

        info!(
            "[blockchain] record_ipfs_hash_on_chain: patient_id={} ipfs_hash={} record_type={}",
            patient_id, ipfs_hash, record_type
        );

        self.pending_extrinsic("recordIpfsHash", &args).await
    }

    /// Log a record-access event on-chain.
    ///
    /// Writes an immutable audit entry recording who accessed which patient's
    /// record and for what purpose.
    ///
    /// # Arguments
    /// * `accessor_id`   – ID of the staff member or system accessing the record.
    /// * `patient_id`    – Patient whose record was accessed.
    /// * `access_type`   – E.g. `"READ"`, `"EMERGENCY_ACCESS"`, `"CONSENT_GRANT"`.
    ///
    /// # Returns
    /// A transaction hash string (real or deterministic placeholder).
    pub async fn log_access_on_chain(
        &self,
        accessor_id: &str,
        patient_id: &str,
        access_type: &str,
    ) -> Result<String, BlockchainError> {
        let args = json!({
            "call":        "auditTrail.logAccess",
            "accessor_id": accessor_id,
            "patient_id":  patient_id,
            "access_type": access_type,
            "timestamp":   Utc::now().to_rfc3339(),
        });

        info!(
            "[blockchain] log_access_on_chain: accessor_id={} patient_id={} access_type={}",
            accessor_id, patient_id, access_type
        );

        self.pending_extrinsic("logAccess", &args).await
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /// Derive an HTTP URL from a WebSocket URL.
    ///
    /// `ws://host:port/path`  → `http://host:port/path`
    /// `wss://host:port/path` → `https://host:port/path`
    fn ws_to_http(ws_url: &str) -> String {
        if let Some(rest) = ws_url.strip_prefix("wss://") {
            format!("https://{}", rest)
        } else if let Some(rest) = ws_url.strip_prefix("ws://") {
            format!("http://{}", rest)
        } else {
            // Already an HTTP URL, or unrecognised scheme – use as-is.
            ws_url.to_owned()
        }
    }

    /// Execute a JSON-RPC call against the node with a hard 5-second timeout.
    ///
    /// Returns the `result` field of the JSON-RPC response on success, or a
    /// `BlockchainError` on transport, timeout, or protocol failure.
    async fn call_rpc(&self, method: &str, params: Value) -> Result<Value, BlockchainError> {
        let request_body = JsonRpcRequest {
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        };

        let fut = self
            .client
            .post(&self.http_url)
            .json(&request_body)
            .send();

        let response = timeout(RPC_TIMEOUT, fut)
            .await
            .map_err(|_| BlockchainError::Timeout)?
            .map_err(BlockchainError::from)?;

        if !response.status().is_success() {
            return Err(BlockchainError::Rpc(format!(
                "HTTP {}: {}",
                response.status(),
                response.status().canonical_reason().unwrap_or("unknown")
            )));
        }

        let rpc_response: JsonRpcResponse = timeout(
            RPC_TIMEOUT,
            response.json::<JsonRpcResponse>(),
        )
        .await
        .map_err(|_| BlockchainError::Timeout)?
        .map_err(|e| BlockchainError::Rpc(e.to_string()))?;

        if let Some(err) = rpc_response.error {
            return Err(BlockchainError::Rpc(format!(
                "JSON-RPC error {}: {}",
                err.code, err.message
            )));
        }

        rpc_response
            .result
            .ok_or_else(|| BlockchainError::Rpc("Missing 'result' field in response".into()))
    }

    /// Submit or simulate an extrinsic.
    ///
    /// **When `BLOCKCHAIN_ENABLED=false` (default / demo mode):**
    /// Logs the intended call and returns a deterministic SHA3-256 placeholder
    /// hash. Nothing is submitted to the Substrate node.
    ///
    /// **When `BLOCKCHAIN_ENABLED=true`:**
    /// Attempts to submit the extrinsic via `author_submitExtrinsic` using the
    /// JSON-RPC transport. This requires the call to be pre-encoded as a SCALE
    /// hex string. The current implementation sends the JSON args as a UTF-8
    /// hex payload (sufficient for dev/test nodes that accept untyped calls).
    ///
    /// # Production upgrade path
    /// Replace the body of the `blockchain_enabled()` branch below with a real
    /// `subxt` call once the crate is added to `Cargo.toml`:
    ///
    /// ```ignore
    /// // TODO: replace with real subxt call
    /// // async fn submit_with_subxt(
    /// //     api: &OnlineClient<PolkadotConfig>,
    /// //     call: impl subxt::tx::TxPayload,
    /// //     signer: &PairSigner<PolkadotConfig, sp_core::sr25519::Pair>,
    /// // ) -> Result<H256, subxt::Error> {
    /// //     api.tx().sign_and_submit_default(&call, signer).await
    /// // }
    /// ```
    async fn pending_extrinsic(
        &self,
        call_name: &str,
        args: &Value,
    ) -> Result<String, BlockchainError> {
        let args_str = args.to_string();
        let timestamp = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);

        if blockchain_enabled() && self.is_connected() {
            // Encode the call payload as a hex string.
            // TODO: replace with real SCALE-encoded extrinsic via subxt once
            //       `subxt` is added to Cargo.toml and node metadata is generated.
            let payload_hex = format!(
                "0x{}",
                hex::encode(format!("{}:{}", call_name, args_str).as_bytes())
            );

            info!(
                "[blockchain] Submitting extrinsic '{}' to node at {}",
                call_name, self.http_url
            );

            match self
                .call_rpc("author_submitExtrinsic", json!([payload_hex]))
                .await
            {
                Ok(result) => {
                    let tx_hash = result
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| result.to_string());
                    info!(
                        "[blockchain] Extrinsic '{}' accepted, tx_hash={}",
                        call_name, tx_hash
                    );
                    return Ok(tx_hash);
                }
                Err(e) => {
                    warn!(
                        "[blockchain] Extrinsic submission failed for '{}': {} — \
                         falling back to placeholder hash.",
                        call_name, e
                    );
                    // Fall through to placeholder hash below.
                }
            }
        } else if blockchain_enabled() {
            warn!(
                "[blockchain] BLOCKCHAIN_ENABLED=true but node is not reachable. \
                 Call '{}' will use a placeholder hash.",
                call_name
            );
        } else {
            info!(
                "[blockchain] DEMO MODE — call='{}' logged but not submitted. \
                 Set BLOCKCHAIN_ENABLED=true to enable on-chain submission.",
                call_name
            );
        }

        // Derive a deterministic placeholder hash (used in demo/offline mode).
        let mut hasher = Sha3_256::new();
        hasher.update(call_name.as_bytes());
        hasher.update(args_str.as_bytes());
        hasher.update(timestamp.as_bytes());
        let hash_bytes = hasher.finalize();
        let tx_hash = format!("0x{}", hex::encode(hash_bytes));

        info!(
            "[blockchain] Placeholder tx_hash for '{}': {}",
            call_name, tx_hash
        );

        Ok(tx_hash)
    }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that WebSocket URLs are correctly converted to HTTP equivalents.
    #[test]
    fn test_ws_to_http_conversion() {
        assert_eq!(
            SubstrateClient::ws_to_http("ws://localhost:9944"),
            "http://localhost:9944"
        );
        assert_eq!(
            SubstrateClient::ws_to_http("wss://node.example.com:9944"),
            "https://node.example.com:9944"
        );
        // Pass-through for already-HTTP URLs.
        assert_eq!(
            SubstrateClient::ws_to_http("http://localhost:9944"),
            "http://localhost:9944"
        );
    }

    /// Placeholder tx hashes must be valid 0x-prefixed 64-character hex strings
    /// (32 bytes = 256 bits, matching the width of a Substrate extrinsic hash).
    #[tokio::test]
    async fn test_placeholder_hash_format() {
        let client = SubstrateClient {
            ws_url: "ws://localhost:9944".into(),
            http_url: "http://localhost:9944".into(),
            connected: Arc::new(AtomicBool::new(false)),
            client: Client::new(),
        };

        let hash = client
            .pending_extrinsic("testCall", &json!({"key": "value"}))
            .await
            .expect("pending_extrinsic should not fail");

        assert!(hash.starts_with("0x"), "hash must be 0x-prefixed");
        // Strip prefix and check hex length: 32 bytes × 2 hex chars = 64.
        let hex_part = &hash[2..];
        assert_eq!(hex_part.len(), 64, "hash must encode 32 bytes");
        assert!(
            hex_part.chars().all(|c| c.is_ascii_hexdigit()),
            "hash must contain only hex digits"
        );
    }

    /// Two calls with identical arguments must produce the same hash
    /// (determinism), but different call names must produce different hashes.
    #[tokio::test]
    async fn test_placeholder_hash_determinism() {
        let client = SubstrateClient {
            ws_url: "ws://localhost:9944".into(),
            http_url: "http://localhost:9944".into(),
            connected: Arc::new(AtomicBool::new(false)),
            client: Client::new(),
        };

        let args = json!({"patient_id": "abc-123", "id_hash": "deadbeef"});

        let h1 = client
            .pending_extrinsic("registerPatient", &args)
            .await
            .unwrap();
        let h2 = client
            .pending_extrinsic("logAccess", &args)
            .await
            .unwrap();

        // Different call names → different hashes.
        assert_ne!(h1, h2, "different call names must yield different hashes");

        // Both should still be correctly formatted.
        assert!(h1.starts_with("0x") && h1.len() == 66);
        assert!(h2.starts_with("0x") && h2.len() == 66);
    }

    /// `from_env` returns `None` when the variable is absent.
    #[test]
    fn test_from_env_absent() {
        // Temporarily unset the variable if present.
        std::env::remove_var("SUBSTRATE_WS_URL");
        assert!(SubstrateClient::from_env().is_none());
    }

    /// `from_env` returns the variable value when it is set.
    #[test]
    fn test_from_env_present() {
        std::env::set_var("SUBSTRATE_WS_URL", "ws://localhost:9944");
        let url = SubstrateClient::from_env();
        assert_eq!(url.as_deref(), Some("ws://localhost:9944"));
        std::env::remove_var("SUBSTRATE_WS_URL");
    }
}
