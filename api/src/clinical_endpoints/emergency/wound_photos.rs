//! Bind wound photographs to the patient's existing encrypted image documents.
use super::*;

/// Validate up to four encrypted PNG/JPEG references without exposing bytes or metadata.
/// References must be active documents owned by this patient; arbitrary hashes are refused.
pub(super) async fn validate_photos(
    data: &AppState,
    patient_id: &str,
    hashes: &[String],
) -> Result<(), HttpResponse> {
    let invalid = || {
        HttpResponse::BadRequest().json(serde_json::json!({
        "error": "Wound photos must be this patient's stored PNG or JPEG images, up to four of 1 MiB each",
        "code": "INVALID_WOUND_PHOTO"
    }))
    };
    if hashes.len() > 4 {
        return Err(invalid());
    }
    for hash in hashes {
        let record = data
            .repositories
            .medical_records
            .get_by_ipfs_hash(hash)
            .await
            .map_err(|_| invalid())?;
        if record.patient_id != patient_id || !record.is_active || record.record_type != "imaging" {
            return Err(invalid());
        }
        let metadata_hash = record.ipfs_metadata_hash.as_deref().ok_or_else(invalid)?;
        let image = data
            .ipfs_client
            .download_decrypted(hash, metadata_hash, &data.encryption_keyring)
            .await
            .map_err(|_| invalid())?;
        let detected = crate::attachment_scan::sniff_attachment_type(&image.content);
        let raster = matches!(detected, Some("image/png" | "image/jpeg"));
        if image.metadata.patient_id != patient_id
            || image.content.len() > 1024 * 1024
            || !raster
            || detected != Some(image.metadata.content_type.as_str())
        {
            return Err(invalid());
        }
    }
    Ok(())
}
