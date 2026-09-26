//! Merkle batching of the access audit (WP8): the canonical leaf of an
//! `access_logs` row, the tree over a batch of leaves, and inclusion proofs.
//!
//! One root per batch goes on chain (`AccessControl::anchor_audit_batch`), in
//! place of one extrinsic per read. Anyone holding a row, its proof and the
//! anchored root can check the row is exactly what was anchored; a row edited
//! in the database afterwards hashes to a different leaf and fails.
//!
//! Every hash is SHA3-256 with a domain-separation prefix, so a leaf can never
//! be passed off as an interior node or the other way round. Fields are hashed
//! in a fixed order, each with a presence byte and a length prefix, so no two
//! different rows share an encoding.

use sha3::{Digest, Sha3_256};

use crate::repositories::traits::AccessLogEntity;

/// Domain prefix of a leaf hash. The version changes if the encoding does.
const LEAF_DOMAIN: &[u8] = b"medichain.audit.leaf.v1\0";
/// Domain prefix of an interior node hash.
const NODE_DOMAIN: &[u8] = b"medichain.audit.node.v1\0";

/// A 32-byte SHA3-256 digest.
pub type Digest32 = [u8; 32];

/// Append one optional field: 0 for absent, else 1, a u32 length and bytes.
fn push_field(buffer: &mut Vec<u8>, value: Option<&str>) {
    match value {
        None => buffer.push(0),
        Some(text) => {
            buffer.push(1);
            // Audit fields are bounded far below 4 GiB by their columns.
            buffer.extend_from_slice(&(text.len() as u32).to_be_bytes());
            buffer.extend_from_slice(text.as_bytes());
        }
    }
}

/// The canonical byte encoding of an access-log row, fields in a fixed order.
///
/// `blockchain_tx_hash` is left out: it is written after the fact and is not
/// part of what happened. Time is encoded in microseconds, the precision
/// PostgreSQL stores.
pub fn canonical_row(row: &AccessLogEntity) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(256);
    push_field(&mut buffer, Some(&row.id));
    push_field(&mut buffer, Some(&row.accessor_id));
    push_field(&mut buffer, Some(&row.accessor_role));
    push_field(&mut buffer, row.patient_id.as_deref());
    push_field(&mut buffer, Some(&row.resource_type));
    push_field(&mut buffer, row.resource_id.as_deref());
    push_field(&mut buffer, Some(&row.action));
    push_field(&mut buffer, row.access_reason.as_deref());
    buffer.push(u8::from(row.is_emergency_access));
    push_field(&mut buffer, row.ip_address.as_deref());
    push_field(&mut buffer, row.user_agent.as_deref());
    buffer.extend_from_slice(&row.accessed_at.timestamp_micros().to_be_bytes());
    push_field(&mut buffer, row.facility_id.as_deref());
    // WP9: what authorised the access is part of what happened.
    push_field(&mut buffer, row.authority_type.as_deref());
    push_field(&mut buffer, row.authority_id.as_deref());
    buffer
}

/// The leaf hash of an access-log row.
pub fn leaf_hash(row: &AccessLogEntity) -> Digest32 {
    let mut hasher = Sha3_256::new();
    hasher.update(LEAF_DOMAIN);
    hasher.update(canonical_row(row));
    hasher.finalize().into()
}

/// The hash of an interior node over two children.
fn node_hash(left: &Digest32, right: &Digest32) -> Digest32 {
    let mut hasher = Sha3_256::new();
    hasher.update(NODE_DOMAIN);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

/// One level up: pairs are hashed, and an unpaired last node is carried up
/// unchanged (never duplicated, so no two leaf lists share a root that way).
fn next_level(level: &[Digest32]) -> Vec<Digest32> {
    level
        .chunks(2)
        .map(|pair| match pair {
            [left, right] => node_hash(left, right),
            [only] => *only,
            _ => unreachable!("chunks(2) yields one or two items"),
        })
        .collect()
}

/// The Merkle root of `leaves`, or `None` for an empty batch.
pub fn merkle_root(leaves: &[Digest32]) -> Option<Digest32> {
    if leaves.is_empty() {
        return None;
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = next_level(&level);
    }
    Some(level[0])
}

/// Which side of the running hash a proof sibling sits on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SiblingSide {
    Left,
    Right,
}

/// One step of an inclusion proof.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProofStep {
    /// The sibling's hash, hex.
    pub sibling: String,
    pub side: SiblingSide,
}

/// The inclusion proof of leaf `index` among `leaves`, or `None` if out of
/// range. Levels where the node is carried up unpaired contribute no step.
pub fn inclusion_proof(leaves: &[Digest32], index: usize) -> Option<Vec<ProofStep>> {
    if index >= leaves.len() {
        return None;
    }
    let (mut level, mut position, mut steps) = (leaves.to_vec(), index, Vec::new());
    while level.len() > 1 {
        let sibling = position ^ 1;
        if let Some(hash) = level.get(sibling) {
            let side = if sibling < position {
                SiblingSide::Left
            } else {
                SiblingSide::Right
            };
            steps.push(ProofStep {
                sibling: hex::encode(hash),
                side,
            });
        }
        level = next_level(&level);
        position /= 2;
    }
    Some(steps)
}

/// Whether `leaf` with `proof` reproduces `root`. A malformed sibling fails.
pub fn verify_proof(leaf: &Digest32, proof: &[ProofStep], root: &Digest32) -> bool {
    let mut running = *leaf;
    for step in proof {
        let Some(sibling) = decode_digest(&step.sibling) else {
            return false;
        };
        running = match step.side {
            SiblingSide::Left => node_hash(&sibling, &running),
            SiblingSide::Right => node_hash(&running, &sibling),
        };
    }
    &running == root
}

/// A 64-character hex string as a digest, or `None`.
pub fn decode_digest(hex_text: &str) -> Option<Digest32> {
    hex::decode(hex_text).ok()?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str) -> AccessLogEntity {
        AccessLogEntity {
            id: id.into(),
            accessor_id: "doctor".into(),
            accessor_role: "Doctor".into(),
            patient_id: Some("PAT-1".into()),
            resource_type: "patient".into(),
            resource_id: None,
            action: "view".into(),
            access_reason: Some("follow-up".into()),
            is_emergency_access: false,
            ip_address: None,
            user_agent: None,
            blockchain_tx_hash: None,
            accessed_at: chrono::DateTime::from_timestamp(1_790_000_000, 123_000).unwrap(),
            facility_id: None,
            authority_type: None,
            authority_id: None,
        }
    }

    fn leaves(count: usize) -> Vec<Digest32> {
        (0..count)
            .map(|i| leaf_hash(&row(&format!("LOG-{i}"))))
            .collect()
    }

    #[test]
    fn every_leaf_proves_into_the_root_for_odd_and_even_batches() {
        for count in [1, 2, 3, 5, 8, 13] {
            let leaves = leaves(count);
            let root = merkle_root(&leaves).unwrap();
            for (index, leaf) in leaves.iter().enumerate() {
                let proof = inclusion_proof(&leaves, index).unwrap();
                assert!(verify_proof(leaf, &proof, &root), "leaf {index} of {count}");
            }
        }
    }

    #[test]
    fn an_edited_row_no_longer_proves_into_the_root() {
        let leaves = leaves(4);
        let root = merkle_root(&leaves).unwrap();
        let proof = inclusion_proof(&leaves, 2).unwrap();
        let mut edited = row("LOG-2");
        edited.action = "emergency".into();
        assert!(!verify_proof(&leaf_hash(&edited), &proof, &root));
    }

    #[test]
    fn the_encoding_separates_absent_from_empty_and_leaves_from_nodes() {
        let mut empty_reason = row("LOG-1");
        empty_reason.access_reason = Some(String::new());
        let mut no_reason = row("LOG-1");
        no_reason.access_reason = None;
        assert_ne!(leaf_hash(&empty_reason), leaf_hash(&no_reason));
        // A later chain transaction hash is not part of the row's identity.
        let mut stamped = row("LOG-1");
        stamped.blockchain_tx_hash = Some("0xabc".into());
        assert_eq!(leaf_hash(&stamped), leaf_hash(&row("LOG-1")));
        let pair = leaves(2);
        assert_ne!(merkle_root(&pair).unwrap(), leaf_hash(&row("LOG-0")));
    }

    #[test]
    fn empty_batches_and_out_of_range_proofs_are_refused() {
        assert!(merkle_root(&[]).is_none());
        assert!(inclusion_proof(&leaves(3), 3).is_none());
    }
}
