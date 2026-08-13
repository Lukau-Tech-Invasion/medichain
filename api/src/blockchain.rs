//! Substrate Blockchain RPC Client for MediChain
//!
//! © 2025 Lukau Invasion (Pty) Ltd. All rights reserved.
//!
//! Provides a lightweight HTTP-based JSON-RPC client for interacting with a
//! Substrate node. Supports health checks and finalized on-chain event logging
//! for patient registration, IPFS hash recording, and access auditing.
//!
//! # Extrinsic Encoding Note
//!
//! Real extrinsic submission via `subxt` is wired in `pending_extrinsic`: when
//! `BLOCKCHAIN_ENABLED=true`, a node is connected, and an operator signing key is
//! configured (`SUBSTRATE_SIGNING_KEY`), calls are signed and submitted for real via
//! `sign_and_submit_then_watch_default` + `wait_for_finalized_success`. In every
//! other case (disabled/demo mode, node not ready, no operator key, or failed
//! submission) returns an error. MediChain never fabricates a value that could
//! be mistaken for a transaction hash.

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
/// to `"true"` (case-insensitive). Disabled integrations return a typed error;
/// they never fabricate a transaction hash or claim that an event was anchored.
pub fn blockchain_enabled() -> bool {
    std::env::var("BLOCKCHAIN_ENABLED")
        .ok()
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Validate the operator-controlled blockchain posture before the API starts.
pub fn validate_blockchain_configuration(is_demo: bool) -> Result<(), String> {
    if !blockchain_enabled() {
        return if is_demo {
            Ok(())
        } else {
            Err("BLOCKCHAIN_ENABLED=true is required outside demo mode".to_string())
        };
    }
    if SubstrateClient::from_env().is_none() {
        return Err("SUBSTRATE_WS_URL is required when blockchain is enabled".to_string());
    }
    let has_operator_key =
        std::env::var("SUBSTRATE_SIGNING_KEY").is_ok_and(|value| !value.trim().is_empty());
    let allow_dev = std::env::var("SUBSTRATE_ALLOW_DEV_SIGNER")
        .is_ok_and(|value| value.eq_ignore_ascii_case("true"));
    if has_operator_key || (is_demo && allow_dev) {
        return Ok(());
    }
    Err(
        "SUBSTRATE_SIGNING_KEY is required; Alice is permitted only in explicit demo mode"
            .to_string(),
    )
}

/// Classify an access-audit event as emergency (break-glass) or routine.
///
/// The result becomes the `emergency` flag on an immutable audit event. Audit
/// logging never creates or mutates an access grant.
pub(crate) fn is_emergency_access(access_type: &str) -> bool {
    matches!(
        access_type.trim().to_ascii_uppercase().as_str(),
        "EMERGENCY" | "EMERGENCY_ACCESS" | "BREAK_GLASS"
    )
}

/// Decode a 64-character hex commitment into the fixed 32 bytes the pallet
/// expects.
///
/// Returns `None` for anything that is not exactly 32 bytes of valid hex — a
/// short, long, or non-hex value must not be silently padded or truncated into
/// a digest that commits to nothing.
fn decode_commitment(commitment_hex: &str) -> Option<[u8; 32]> {
    let bytes = hex::decode(commitment_hex).ok()?;
    bytes.try_into().ok()
}

/// The access-control extrinsic an audit event of `access_type` must use.
///
/// Returns `(call_name, is_emergency)`.
pub(crate) fn audit_call_for(access_type: &str) -> (&'static str, bool) {
    ("log_delegated_access", is_emergency_access(access_type))
}

/// Encode an `AccountId32` as a call argument.
///
/// It is the raw 32 bytes, not a named variant. In runtime metadata
/// `AccountId32` is a *composite* — a newtype wrapping `[u8; 32]` — so wrapping
/// it in `Value::unnamed_variant("AccountId32", ..)` makes subxt try to encode
/// the variant name as a string and the whole extrinsic fails to build:
///
/// ```text
/// Extrinsic encoding failed: cannot encode call data:
/// Error at [0]: Cannot encode Str into type with ID 2
/// ```
///
/// That failure is invisible until a call is actually submitted to a node with
/// real metadata — it is not a compile error and no unit test with a mocked
/// client catches it.
fn account_arg(account: &sp_core::crypto::AccountId32) -> DynamicValue {
    DynamicValue::from_bytes(AsRef::<[u8]>::as_ref(account))
}

fn keyed_audit_digest(domain: &str, values: &[&str]) -> [u8; 32] {
    let key = std::env::var("NATIONAL_ID_HASH_KEY")
        .unwrap_or_else(|_| "medichain-dev-national-id-key-change-in-production".to_string());
    let mut hasher = Sha3_256::new();
    hasher.update(key.as_bytes());
    hasher.update(b":chain-audit:");
    hasher.update(domain.as_bytes());
    for value in values {
        hasher.update(b":");
        hasher.update(value.as_bytes());
    }
    hasher.finalize().into()
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
    /// Blockchain integration is intentionally disabled for this runtime.
    #[error("Blockchain integration is disabled")]
    Disabled,

    /// The operator enabled blockchain writes but the node is not ready.
    #[error("Blockchain node is not ready: {0}")]
    NotReady(String),
    /// TCP / HTTP connection failure.
    #[error("Connection error: {0}")]
    Connection(String),

    /// The node returned a JSON-RPC error object, or the response was malformed.
    #[error("RPC error: {0}")]
    Rpc(String),

    /// The RPC call did not complete within the configured deadline.
    #[error("Timeout")]
    Timeout,

    /// A caller passed a value that cannot be submitted. Distinct from `Rpc`
    /// because the node was never reached and retrying will not help.
    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
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

/// Result of an on-chain operation attempt.
///
/// Successful results always come from a finalized node-confirmed extrinsic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainTxResult {
    /// The finalized on-chain transaction hash.
    pub hash: String,
    /// Retained for API compatibility; successful results are always finalized.
    pub finalized: bool,
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
                 on-chain writes will fail closed until the node is ready.",
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

    pub fn is_ready(&self) -> bool {
        self.is_connected() && self.subxt.is_some()
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
    /// Submits a signed extrinsic that anchors the patient's identity hash to
    /// the chain and waits for finalized success.
    ///
    /// # Arguments
    /// * `patient_id`       – Internal MediChain patient UUID.
    /// * `id_hash`          – Hex-encoded SHA3-256 of the patient's national ID.
    /// * `national_id_type` – E.g. `"NATIONAL_ID"`, `"PASSPORT"`.
    /// * `registered_by`    – Staff member / system that triggered registration.
    ///
    /// # Returns
    /// A `ChainTxResult` containing the real finalized extrinsic hash.
    pub async fn register_patient_on_chain(
        &self,
        patient_id: &str,
        id_hash: &str,
        national_id_type: &str,
        _registered_by: &str,
    ) -> Result<ChainTxResult, BlockchainError> {
        info!(
            "[blockchain] register_patient_on_chain: patient_id={} national_id_type={}",
            patient_id, national_id_type
        );

        // Convert patient_id to AccountId32 (assuming it's a valid SS58 address or hash)
        let patient_account = patient_id
            .parse::<sp_core::crypto::AccountId32>()
            .map_err(|_| BlockchainError::InvalidArgument("patient wallet is not SS58".into()))?;

        // Parse id_hash from hex
        let id_hash_bytes = match hex::decode(id_hash.trim_start_matches("0x")) {
            Ok(bytes) if bytes.len() == 32 => {
                let mut h = [0u8; 32];
                h.copy_from_slice(&bytes);
                h
            }
            _ => {
                return Err(BlockchainError::InvalidArgument(
                    "national ID commitment must be exactly 32 bytes of hex".into(),
                ));
            }
        };

        // Map national_id_type string to enum variant
        let id_type_variant = match national_id_type.to_uppercase().as_str() {
            "GHANACARD" | "GHANA_CARD" => "GhanaCard",
            "NIN" => "NIN",
            "SMARTID" | "SMART_ID" => "SmartID",
            _ => "FaydaID",
        };

        let params = vec![
            account_arg(&patient_account),
            DynamicValue::unnamed_variant(id_type_variant, vec![]),
            DynamicValue::from_bytes(id_hash_bytes),
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
    /// A `ChainTxResult` containing the real finalized extrinsic hash.
    pub async fn record_ipfs_hash_on_chain(
        &self,
        patient_id: &str,
        ipfs_hash: &str,
        record_type: &str,
        _uploaded_by: &str,
    ) -> Result<ChainTxResult, BlockchainError> {
        info!(
            "[blockchain] record_ipfs_hash_on_chain: patient_id={} ipfs_hash={} record_type={}",
            patient_id, ipfs_hash, record_type
        );

        // Convert patient_id to AccountId32
        let patient_account = patient_id
            .parse::<sp_core::crypto::AccountId32>()
            .map_err(|_| BlockchainError::InvalidArgument("patient wallet is not SS58".into()))?;

        // The pallet upserts an opaque record shell on first use and updates the
        // encrypted IPFS reference thereafter. This avoids a permanent retry
        // loop when an upload is the patient's first on-chain medical action.
        let params = vec![
            account_arg(&patient_account),
            DynamicValue::from_bytes(ipfs_hash.as_bytes()), // IPFS hash as Vec<u8>
        ];

        self.pending_extrinsic("MedicalRecords", "upsert_ipfs_hash", params)
            .await
    }

    /// Log a record-access event on-chain.
    ///
    /// Writes an immutable audit entry recording who accessed which patient's
    /// record and for what purpose.
    ///
    /// # Arguments
    /// * `audit_event_id` – Stable ID of the durable application audit event.
    /// * `accessor_id`   – ID of the staff member or system accessing the record.
    /// * `patient_id`    – Patient whose record was accessed.
    /// * `access_type`   – E.g. `"READ"`, `"EMERGENCY_ACCESS"`, `"CONSENT_GRANT"`.
    ///
    /// # Returns
    /// A `ChainTxResult` containing the real finalized extrinsic hash.
    pub async fn log_access_on_chain(
        &self,
        audit_event_id: &str,
        accessor_id: &str,
        patient_id: &str,
        access_type: &str,
    ) -> Result<ChainTxResult, BlockchainError> {
        info!(
            "[blockchain] log_access_on_chain: accessor_id={} patient_id={} access_type={}",
            accessor_id, patient_id, access_type
        );

        // A backend operator signs the extrinsic, but the event also carries a
        // keyed commitment to the real application accessor. This avoids both
        // misattributing every access to the operator account and publishing an
        // internal user identifier on a public ledger.
        let (call_name, emergency) = audit_call_for(access_type);

        let patient_account = patient_id
            .parse::<sp_core::crypto::AccountId32>()
            .map_err(|_| BlockchainError::InvalidArgument("patient wallet is not SS58".into()))?;

        let accessor_hash = keyed_audit_digest("accessor", &[accessor_id]);
        let reason_hash = keyed_audit_digest("event", &[audit_event_id, access_type]);

        let params = vec![
            account_arg(&patient_account),
            DynamicValue::from_bytes(accessor_hash),
            DynamicValue::from_bytes(reason_hash),
            DynamicValue::bool(emergency),
        ];

        self.pending_extrinsic("AccessControl", call_name, params)
            .await
    }

    /// Anchor an emergency capsule commitment on-chain (Horizon HZ-003).
    ///
    /// Publishes only the 32-byte digest and its version — never the blood
    /// type, organ-donor flag, or DNR status those values used to be stored as.
    /// The pallet rejects a version that is not strictly greater than the one
    /// already recorded, so a superseded capsule cannot be replayed as current.
    ///
    /// # Arguments
    /// * `patient_id`     – Patient account (SS58).
    /// * `commitment_hex` – Hex-encoded SHA3-256 capsule commitment, 64 chars.
    /// * `version`        – Capsule version this commitment belongs to.
    ///
    /// # Returns
    /// A `ChainTxResult` containing the real finalized extrinsic hash.
    pub async fn set_emergency_capsule_commitment_on_chain(
        &self,
        patient_id: &str,
        commitment_hex: &str,
        version: u32,
    ) -> Result<ChainTxResult, BlockchainError> {
        info!(
            "[blockchain] set_emergency_capsule_commitment_on_chain: patient_id={} version={}",
            patient_id, version
        );

        let commitment = match decode_commitment(commitment_hex) {
            Some(bytes) => bytes,
            None => {
                // A malformed commitment is a caller bug, not a chain problem.
                // Submitting a zero or truncated digest would anchor something
                // that can never match the capsule it claims to commit to.
                return Err(BlockchainError::InvalidArgument(format!(
                    "commitment must be 64 hex characters, got {} characters",
                    commitment_hex.len()
                )));
            }
        };

        let patient_account = patient_id
            .parse::<sp_core::crypto::AccountId32>()
            .map_err(|_| BlockchainError::InvalidArgument("patient wallet is not SS58".into()))?;

        let params = vec![
            account_arg(&patient_account),
            DynamicValue::from_bytes(commitment),
            DynamicValue::u128(u128::from(version)),
        ];

        self.pending_extrinsic(
            "MedicalRecords",
            "upsert_emergency_capsule_commitment",
            params,
        )
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

    /// Submit a signed dynamic extrinsic and wait for finalized success.
    async fn pending_extrinsic(
        &self,
        pallet_name: &str,
        call_name: &str,
        params: Vec<DynamicValue>,
    ) -> Result<ChainTxResult, BlockchainError> {
        self.pending_extrinsic_when_enabled(blockchain_enabled(), pallet_name, call_name, params)
            .await
    }

    /// Submission implementation with an explicit feature flag. Keeping the
    /// flag as an argument makes fail-closed behavior testable without mutating
    /// process-global environment variables across async suspension points.
    async fn pending_extrinsic_when_enabled(
        &self,
        enabled: bool,
        pallet_name: &str,
        call_name: &str,
        params: Vec<DynamicValue>,
    ) -> Result<ChainTxResult, BlockchainError> {
        if !enabled {
            return Err(BlockchainError::Disabled);
        }
        if !self.is_connected() {
            return Err(BlockchainError::NotReady("health check failed".into()));
        }
        let api = self
            .subxt
            .as_ref()
            .ok_or_else(|| BlockchainError::NotReady("subxt client unavailable".into()))?;
        let signer = operator_signer()?;
        let tx = subxt::dynamic::tx(pallet_name, call_name, params);
        // `tx()` is async as of subxt 0.50: it resolves the chain's metadata and
        // transaction-extension set before a call can be encoded.
        let progress = api
            .tx()
            .await
            .map_err(|error| BlockchainError::Rpc(error.to_string()))?
            .sign_and_submit_then_watch_default(&tx, &signer)
            .await
            .map_err(|error| BlockchainError::Rpc(error.to_string()))?;
        let events = progress
            .wait_for_finalized_success()
            .await
            .map_err(|error| BlockchainError::Rpc(error.to_string()))?;
        let tx_hash = format!("{:?}", events.extrinsic_hash());
        info!(
            "[blockchain] Extrinsic '{}.{}' finalized, tx_hash={}",
            pallet_name, call_name, tx_hash
        );
        Ok(ChainTxResult {
            hash: tx_hash,
            finalized: true,
        })
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

    /// Every audit uses the non-grant delegated event; break-glass access is
    /// distinguished by its immutable emergency flag (C5/F-05).
    #[test]
    fn test_audit_call_routing() {
        assert_eq!(audit_call_for("READ"), ("log_delegated_access", false));
        assert_eq!(
            audit_call_for("CONSENT_GRANT"),
            ("log_delegated_access", false)
        );
        assert_eq!(
            audit_call_for("EMERGENCY_ACCESS"),
            ("log_delegated_access", true)
        );
        // Case-insensitive + alias.
        assert_eq!(
            audit_call_for("break_glass"),
            ("log_delegated_access", true)
        );
        assert!(!is_emergency_access("read"));
        assert!(is_emergency_access("Emergency"));
    }

    /// The operator signer must fail closed when no key is configured, and never
    /// silently fall back to the insecure Alice dev key (C5/F-04).
    #[test]
    fn test_operator_signer_fail_closed() {
        let _guard = ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());
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

    /// Disabled mode must never fabricate a transaction hash.
    #[tokio::test]
    async fn disabled_blockchain_returns_typed_error_without_hash() {
        let client = SubstrateClient {
            ws_url: "ws://localhost:9944".into(),
            http_url: "http://localhost:9944".into(),
            connected: Arc::new(AtomicBool::new(false)),
            client: Client::new(),
            subxt: None,
        };

        let result = client
            .pending_extrinsic_when_enabled(false, "MedicalRecords", "test_call", vec![])
            .await;
        assert!(matches!(result, Err(BlockchainError::Disabled)));
    }

    /// Enabled mode must fail closed when no node/subxt client is ready.
    #[tokio::test]
    async fn enabled_but_unready_blockchain_returns_typed_error() {
        let client = SubstrateClient {
            ws_url: "ws://localhost:9944".into(),
            http_url: "http://localhost:9944".into(),
            connected: Arc::new(AtomicBool::new(false)),
            client: Client::new(),
            subxt: None,
        };

        let result = client
            .pending_extrinsic_when_enabled(true, "AccessControl", "log_access", vec![])
            .await;
        assert!(matches!(result, Err(BlockchainError::NotReady(_))));
    }

    /// Serialises the two `from_env` tests.
    ///
    /// Environment variables are process-global, and `cargo test` runs tests on
    /// multiple threads. Without this, `test_from_env_present` can set
    /// `SUBSTRATE_WS_URL` in the window between `test_from_env_absent` clearing
    /// it and reading it back — the absent test then sees the present test's
    /// value and fails. That is a race in the tests, not in `from_env`, and it
    /// surfaces only when unrelated changes shift thread timing.
    static ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// `from_env` returns `None` when the variable is absent.
    #[test]
    fn test_from_env_absent() {
        // `unwrap_or_else(|e| e.into_inner())` rather than `unwrap()`: if the
        // sibling test panics while holding the lock, this test should still
        // run and report its own result instead of failing as "poisoned".
        let _guard = ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());

        let original = std::env::var("SUBSTRATE_WS_URL").ok();
        std::env::remove_var("SUBSTRATE_WS_URL");

        let result = SubstrateClient::from_env();

        if let Some(val) = original {
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
        let _guard = ENV_GUARD.lock().unwrap_or_else(|e| e.into_inner());

        let original = std::env::var("SUBSTRATE_WS_URL").ok();
        std::env::set_var("SUBSTRATE_WS_URL", "ws://localhost:9944");

        let url = SubstrateClient::from_env();

        match original {
            Some(val) => std::env::set_var("SUBSTRATE_WS_URL", val),
            None => std::env::remove_var("SUBSTRATE_WS_URL"),
        }

        assert_eq!(url.as_deref(), Some("ws://localhost:9944"));
    }

    /// End-to-end: a real signed extrinsic through the production `subxt` path.
    ///
    /// What makes this meaningful is `wait_for_finalized_success` inside
    /// `pending_extrinsic`. It errors unless the extrinsic was accepted by the
    /// pool, included in a block, **executed successfully by the pallet** (a
    /// dispatch error such as `NotHealthcareProvider` fails here even though the
    /// extrinsic made it on chain), and that block was finalized by GRANDPA. A
    /// returned `ChainTxResult` therefore covers inclusion, execution and
    /// finality in one assertion.
    ///
    /// Ignored by default because it needs a running node; CI never runs it.
    ///
    /// ```text
    /// # terminal 1
    /// scripts/blockchain/run-dev-node.sh --persist
    /// # terminal 2
    /// SUBSTRATE_SIGNING_KEY=//Alice \
    ///   cargo test --bin medichain-api -- --ignored --nocapture chain_e2e
    /// # then read the value back off chain state
    /// python3 scripts/blockchain/verify-capsule.py <patient> <commitment> <version>
    /// ```
    ///
    /// Synthetic dev accounts only — never real patient data.
    #[tokio::test]
    #[ignore = "needs a running MediChain dev node; see docs/BLOCKCHAIN_NODE.md"]
    async fn chain_e2e_capsule_commitment_reaches_finalized_success() {
        let ws =
            std::env::var("SUBSTRATE_WS_URL").unwrap_or_else(|_| "ws://127.0.0.1:9944".to_string());
        std::env::set_var("BLOCKCHAIN_ENABLED", "true");
        // The signer must hold a provider role on chain. The dev genesis grants
        // //Alice `Role::Admin`, which satisfies `can_edit_medical_records`.
        if std::env::var("SUBSTRATE_SIGNING_KEY").is_err() {
            std::env::set_var("SUBSTRATE_SIGNING_KEY", "//Alice");
        }

        let client = SubstrateClient::new(&ws)
            .await
            .expect("could not connect to the dev node");
        assert!(client.health_check().await, "node health check failed");

        // Which account actually signs matters more than it looks: a signer that
        // resolves to an unfunded account fails with "Inability to pay some
        // fees", which reads like a chain problem rather than a key problem.
        let signer = operator_signer().expect("operator signer");
        let signer_pub: [u8; 32] = signer.public_key().0;
        println!("signer pubkey 0x{}", hex::encode(signer_pub));

        // Well-known dev account standing in for a patient.
        const SYNTHETIC_PATIENT: &str = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
        let commitment = "ab".repeat(32);
        // The pallet requires a strictly increasing version per patient, so this
        // test can be re-run against a chain that already holds a record.
        let version = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before the unix epoch")
            .as_secs() as u32;

        let result = client
            .set_emergency_capsule_commitment_on_chain(SYNTHETIC_PATIENT, &commitment, version)
            .await
            .expect("extrinsic did not reach finalized success");

        assert!(
            result.finalized,
            "a result must never be reported as final unless it was finalized"
        );
        assert!(
            result.hash.starts_with("0x") && result.hash.len() > 10,
            "expected a real transaction hash, got {:?}",
            result.hash
        );

        println!("patient    {SYNTHETIC_PATIENT}");
        println!("commitment 0x{commitment}");
        println!("version    {version}");
        println!("tx         {}", result.hash);
    }
}
