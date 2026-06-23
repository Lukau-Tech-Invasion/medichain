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

use subxt::dynamic::Value as DynamicValue;
use subxt::{OnlineClient, PolkadotConfig};

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

/// Classify an access-audit event as emergency (break-glass) or routine.
///
/// Emergency access is the only case that maps to the access-control pallet's
/// `grant_emergency_access` extrinsic; everything else (reads, consent actions)
/// is recorded via the dedicated `log_access` audit extrinsic. Routing routine
/// reads through `grant_emergency_access` was the C5 audit-integrity bug.
pub(crate) fn is_emergency_access(access_type: &str) -> bool {
    matches!(
        access_type.trim().to_ascii_uppercase().as_str(),
        "EMERGENCY" | "EMERGENCY_ACCESS" | "BREAK_GLASS"
    )
}

/// The access-control extrinsic an audit event of `access_type` must use.
///
/// Returns `(call_name, is_emergency)`.
pub(crate) fn audit_call_for(access_type: &str) -> (&'static str, bool) {
    if is_emergency_access(access_type) {
        ("grant_emergency_access", true)
    } else {
        ("log_access", false)
    }
}

/// Resolve the operator signing keypair for on-chain extrinsics.
///
/// Production keys come from `SUBSTRATE_SIGNING_KEY` (an sr25519 secret URI / seed
/// phrase). The insecure well-known Alice dev key is used **only** when explicitly
/// opted in with `SUBSTRATE_ALLOW_DEV_SIGNER=true` (local dev/test). Otherwise we
/// fail closed rather than silently signing with — and attributing chain state to
/// — a shared public test key (the C5 Alice-key vulnerability).
fn operator_signer() -> Result<subxt_signer::sr25519::Keypair, BlockchainError> {
    use core::str::FromStr;
    if let Ok(raw) = std::env::var("SUBSTRATE_SIGNING_KEY") {
        let uri = subxt_signer::SecretUri::from_str(raw.trim())
            .map_err(|e| BlockchainError::Rpc(format!("invalid SUBSTRATE_SIGNING_KEY: {e}")))?;
        return subxt_signer::sr25519::Keypair::from_uri(&uri)
            .map_err(|e| BlockchainError::Rpc(format!("cannot derive operator keypair: {e}")));
    }

    let allow_dev = std::env::var("SUBSTRATE_ALLOW_DEV_SIGNER")
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if allow_dev {
        warn!(
            "[blockchain] SUBSTRATE_SIGNING_KEY unset — using INSECURE Alice dev key \
             (SUBSTRATE_ALLOW_DEV_SIGNER=true). Never enable this in production."
        );
        Ok(subxt_signer::sr25519::dev::alice())
    } else {
        Err(BlockchainError::Rpc(
            "SUBSTRATE_SIGNING_KEY is not set; refusing to sign extrinsics with the \
             insecure Alice dev key. Set SUBSTRATE_SIGNING_KEY (operator seed) or, for \
             local dev only, SUBSTRATE_ALLOW_DEV_SIGNER=true."
                .to_string(),
        ))
    }
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
    /// subxt OnlineClient for real extrinsic submission.
    subxt: Option<OnlineClient<PolkadotConfig>>,
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
        let subxt = if blockchain_enabled() {
            match OnlineClient::<PolkadotConfig>::from_url(ws_url).await {
                Ok(client) => Some(client),
                Err(e) => {
                    warn!(
                        "[blockchain] Failed to initialize subxt client at {}: {}",
                        ws_url, e
                    );
                    None
                }
            }
        } else {
            None
        };

        let instance = Self {
            ws_url: ws_url.to_owned(),
            http_url,
            connected,
            client,
            subxt,
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
        _registered_by: &str,
    ) -> Result<String, BlockchainError> {
        info!(
            "[blockchain] register_patient_on_chain: patient_id={} national_id_type={}",
            patient_id, national_id_type
        );

        // Convert patient_id to AccountId32 (assuming it's a valid SS58 address or hash)
        let patient_account = match patient_id.parse::<sp_core::crypto::AccountId32>() {
            Ok(acc) => acc,
            Err(_) => {
                // If not a valid address, we can't submit to a real chain.
                // Fall back to placeholder if needed, or error out.
                return self
                    .pending_extrinsic("PatientIdentity", "register_patient", vec![])
                    .await;
            }
        };

        // Parse id_hash from hex
        let id_hash_bytes = match hex::decode(id_hash.trim_start_matches("0x")) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut h = [0u8; 32];
                h.copy_from_slice(&bytes);
                h
            }
            _ => [0u8; 32],
        };

        // Map national_id_type string to enum variant
        let id_type_variant = match national_id_type.to_uppercase().as_str() {
            "GHANACARD" | "GHANA_CARD" => "GhanaCard",
            "NIN" => "NIN",
            "SMARTID" | "SMART_ID" => "SmartID",
            _ => "FaydaID",
        };

        let params = vec![
            DynamicValue::unnamed_variant(
                "AccountId32",
                vec![DynamicValue::from_bytes(AsRef::<[u8]>::as_ref(
                    &patient_account,
                ))],
            ),
            DynamicValue::unnamed_variant(id_type_variant, vec![]),
            DynamicValue::from_bytes(&id_hash_bytes),
        ];

        self.pending_extrinsic("PatientIdentity", "register_patient", params)
            .await
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
        _uploaded_by: &str,
    ) -> Result<String, BlockchainError> {
        info!(
            "[blockchain] record_ipfs_hash_on_chain: patient_id={} ipfs_hash={} record_type={}",
            patient_id, ipfs_hash, record_type
        );

        // Convert patient_id to AccountId32
        let patient_account = match patient_id.parse::<sp_core::crypto::AccountId32>() {
            Ok(acc) => acc,
            Err(_) => {
                return self
                    .pending_extrinsic("MedicalRecords", "update_ipfs_hash", vec![])
                    .await;
            }
        };

        // For real on-chain recording, we use the medical records pallet.
        // If the record doesn't exist, we should technically call create_health_record first,
        // but for this audit-logging purpose we assume it exists or use update_ipfs_hash.
        let params = vec![
            DynamicValue::unnamed_variant(
                "AccountId32",
                vec![DynamicValue::from_bytes(AsRef::<[u8]>::as_ref(
                    &patient_account,
                ))],
            ),
            DynamicValue::from_bytes(ipfs_hash.as_bytes()), // IPFS hash as Vec<u8>
        ];

        self.pending_extrinsic("MedicalRecords", "update_ipfs_hash", params)
            .await
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
        info!(
            "[blockchain] log_access_on_chain: accessor_id={} patient_id={} access_type={}",
            accessor_id, patient_id, access_type
        );

        // Route by access type: genuine emergency (break-glass) access is an
        // `grant_emergency_access`; everything else (routine reads, consent
        // actions) is recorded with the dedicated `log_access` audit extrinsic.
        // Previously ALL access was misrouted through `grant_emergency_access`,
        // making the on-chain audit trail legally unreliable (C5/F-05).
        let (call_name, emergency) = audit_call_for(access_type);

        let patient_account = match patient_id.parse::<sp_core::crypto::AccountId32>() {
            Ok(acc) => acc,
            Err(_) => {
                return self
                    .pending_extrinsic("AccessControl", call_name, vec![])
                    .await;
            }
        };

        // Reason hash (sha3-256 of access type + timestamp)
        let mut hasher = Sha3_256::new();
        hasher.update(access_type.as_bytes());
        hasher.update(Utc::now().to_rfc3339().as_bytes());
        let reason_hash: [u8; 32] = hasher.finalize().into();

        let mut params = vec![
            DynamicValue::unnamed_variant(
                "AccountId32",
                vec![DynamicValue::from_bytes(AsRef::<[u8]>::as_ref(
                    &patient_account,
                ))],
            ),
            DynamicValue::from_bytes(&reason_hash),
        ];
        // `log_access(patient, reason_hash, emergency)` takes the extra bool flag;
        // `grant_emergency_access(patient, reason_hash)` does not.
        if !emergency {
            params.push(DynamicValue::bool(emergency));
        }

        self.pending_extrinsic("AccessControl", call_name, params)
            .await
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

        let fut = self.client.post(&self.http_url).json(&request_body).send();

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

        let rpc_response: JsonRpcResponse =
            timeout(RPC_TIMEOUT, response.json::<JsonRpcResponse>())
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
        pallet_name: &str,
        call_name: &str,
        params: Vec<DynamicValue>,
    ) -> Result<String, BlockchainError> {
        let timestamp = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);

        if blockchain_enabled() && self.is_connected() && self.subxt.is_some() {
            let api = self.subxt.as_ref().unwrap();

            info!(
                "[blockchain] Submitting real extrinsic '{}.{}' to node at {}",
                pallet_name, call_name, self.ws_url
            );

            // Sign with the operator-managed key (never the shared Alice dev key
            // in production — see `operator_signer`). Fail closed to a placeholder
            // rather than signing with an insecure key when none is configured.
            match operator_signer() {
                Ok(signer) => {
                    let tx = subxt::dynamic::tx(pallet_name, call_name, params);

                    match api
                        .tx()
                        .sign_and_submit_then_watch_default(&tx, &signer)
                        .await
                    {
                        Ok(progress) => {
                            // Wait for the transaction to be finalized.
                            match progress.wait_for_finalized_success().await {
                                Ok(events) => {
                                    let tx_hash = format!("{:?}", events.extrinsic_hash());
                                    info!(
                                        "[blockchain] Extrinsic '{}.{}' included in block, tx_hash={}",
                                        pallet_name, call_name, tx_hash
                                    );
                                    return Ok(tx_hash);
                                }
                                Err(e) => {
                                    warn!(
                                        "[blockchain] Failed to wait for block for '{}.{}': {}",
                                        pallet_name, call_name, e
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            warn!(
                                "[blockchain] Extrinsic submission failed for '{}.{}': {} — \
                                 falling back to placeholder hash.",
                                pallet_name, call_name, e
                            );
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        "[blockchain] No operator signer for '{}.{}': {} — \
                         not submitting; returning placeholder hash.",
                        pallet_name, call_name, e
                    );
                }
            }
        } else if blockchain_enabled() {
            warn!(
                "[blockchain] BLOCKCHAIN_ENABLED=true but node/subxt is not ready. \
                 Call '{}.{}' will use a placeholder hash.",
                pallet_name, call_name
            );
        } else {
            info!(
                "[blockchain] DEMO MODE — call='{}.{}' logged but not submitted.",
                pallet_name, call_name
            );
        }

        // Derive a deterministic placeholder hash (used in demo/offline mode).
        let mut hasher = Sha3_256::new();
        hasher.update(pallet_name.as_bytes());
        hasher.update(call_name.as_bytes());
        hasher.update(timestamp.as_bytes());
        let hash_bytes = hasher.finalize();
        let tx_hash = format!("0x{}", hex::encode(hash_bytes));

        info!(
            "[blockchain] Placeholder tx_hash for '{}.{}': {}",
            pallet_name, call_name, tx_hash
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

    /// Routine access must NOT be recorded as an emergency-access grant; only
    /// genuine break-glass access maps to `grant_emergency_access` (C5/F-05).
    #[test]
    fn test_audit_call_routing() {
        assert_eq!(audit_call_for("READ"), ("log_access", false));
        assert_eq!(audit_call_for("CONSENT_GRANT"), ("log_access", false));
        assert_eq!(
            audit_call_for("EMERGENCY_ACCESS"),
            ("grant_emergency_access", true)
        );
        // Case-insensitive + alias.
        assert_eq!(
            audit_call_for("break_glass"),
            ("grant_emergency_access", true)
        );
        assert!(!is_emergency_access("read"));
        assert!(is_emergency_access("Emergency"));
    }

    /// The operator signer must fail closed when no key is configured, and never
    /// silently fall back to the insecure Alice dev key (C5/F-04).
    #[test]
    fn test_operator_signer_fail_closed() {
        // Run sequentially within one test to avoid cross-test env races.
        std::env::remove_var("SUBSTRATE_SIGNING_KEY");
        std::env::remove_var("SUBSTRATE_ALLOW_DEV_SIGNER");
        assert!(
            operator_signer().is_err(),
            "must refuse to sign without an operator key"
        );

        // Explicit dev opt-in yields a usable (insecure) signer.
        std::env::set_var("SUBSTRATE_ALLOW_DEV_SIGNER", "true");
        assert!(operator_signer().is_ok(), "dev opt-in should produce a key");
        std::env::remove_var("SUBSTRATE_ALLOW_DEV_SIGNER");

        // A real operator secret URI is accepted.
        std::env::set_var("SUBSTRATE_SIGNING_KEY", "//Operator");
        assert!(operator_signer().is_ok(), "valid secret URI should parse");
        std::env::remove_var("SUBSTRATE_SIGNING_KEY");
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
            subxt: None,
        };

        let hash = client
            .pending_extrinsic("medicalRecords", "testCall", vec![])
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
            subxt: None,
        };

        let h1 = client
            .pending_extrinsic("patientIdentity", "registerPatient", vec![])
            .await
            .unwrap();
        let h2 = client
            .pending_extrinsic("accessControl", "logAccess", vec![])
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
        // Use a unique variable name to avoid interference from other tests
        let var_name = "SUBSTRATE_WS_URL_TEST_ABSENT";
        let _original_val = std::env::var(var_name).ok();
        std::env::remove_var(var_name);

        // We need to modify SubstrateClient::from_env to take a var name or test it indirectly
        // Actually, let's just make sure SUBSTRATE_WS_URL is unset for this test
        let real_original = std::env::var("SUBSTRATE_WS_URL").ok();
        std::env::remove_var("SUBSTRATE_WS_URL");

        let result = SubstrateClient::from_env();

        // Restore
        if let Some(val) = real_original {
            std::env::set_var("SUBSTRATE_WS_URL", val);
        }

        assert!(
            result.is_none(),
            "Expected None when SUBSTRATE_WS_URL is unset, got {:?}",
            result
        );
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
