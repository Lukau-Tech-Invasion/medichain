use super::*;

// ============================================================================
// PHASE 24: WEARABLE DEVICE INTEGRATION
// ============================================================================

/// Register wearable device request
#[derive(Debug, Deserialize)]
pub struct RegisterWearableRequest {
    pub device_type: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub data_types: Option<Vec<String>>,
}

/// Register a wearable device
#[post("/api/wearables/devices")]
pub async fn register_wearable_device(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<RegisterWearableRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let device_type = match req.device_type.as_str() {
        "smartwatch" => crate::clinical::WearableDeviceType::Smartwatch,
        "fitness_band" => crate::clinical::WearableDeviceType::FitnessBand,
        "cgm" => crate::clinical::WearableDeviceType::CGM,
        "blood_pressure" => crate::clinical::WearableDeviceType::BloodPressureMonitor,
        "pulse_oximeter" => crate::clinical::WearableDeviceType::PulseOximeter,
        "smart_scale" => crate::clinical::WearableDeviceType::SmartScale,
        "ecg" => crate::clinical::WearableDeviceType::ECGMonitor,
        "glucose_meter" => crate::clinical::WearableDeviceType::GlucoseMeter,
        _ => crate::clinical::WearableDeviceType::Other,
    };

    let data_types = req
        .data_types
        .clone()
        .map(|types| {
            types
                .iter()
                .filter_map(|t| match t.as_str() {
                    "heart_rate" => Some(crate::clinical::WearableDataType::HeartRate),
                    "blood_pressure" => Some(crate::clinical::WearableDataType::BloodPressure),
                    "blood_glucose" => Some(crate::clinical::WearableDataType::BloodGlucose),
                    "spo2" => Some(crate::clinical::WearableDataType::SpO2),
                    "steps" => Some(crate::clinical::WearableDataType::Steps),
                    "distance" => Some(crate::clinical::WearableDataType::Distance),
                    "calories" => Some(crate::clinical::WearableDataType::Calories),
                    "weight" => Some(crate::clinical::WearableDataType::Weight),
                    "temperature" => Some(crate::clinical::WearableDataType::Temperature),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_else(|| vec![crate::clinical::WearableDataType::HeartRate]);

    let device = crate::clinical::WearableDevice {
        device_id: format!("WRB-{}", uuid::Uuid::new_v4()),
        patient_id: current_user_id.clone(),
        device_type,
        manufacturer: req.manufacturer.clone(),
        model: req.model.clone(),
        serial_number: req.serial_number.clone(),
        firmware_version: None,
        connection_status: crate::clinical::ConnectionStatus::Connected,
        last_sync: None,
        paired_at: chrono::Utc::now().timestamp(),
        active: true,
        data_types,
        sync_frequency_hours: 1,
        battery_level: None,
    };

    let device_id = device.device_id.clone();
    {
        // Persist via repository
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: device_id.clone(),
            owner_id: device.patient_id.clone(),
            data: serde_json::to_value(&device).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data
            .repositories
            .wearable_device_records
            .create(entity)
            .await
        {
            log::error!("wearable_device_records persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The alert rule could not be saved; please retry.".to_string(),
                code: "WEARABLE_DEVICE_RECORD_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "device_id": device_id,
        "message": "Wearable device registered successfully"
    }))
}

/// Get wearable devices
#[get("/api/wearables/devices")]
pub async fn get_wearable_devices(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Scoped in the query rather than by filtering a deployment-wide read:
    // `owner_id` is the device's `patient_id`, so this is the same set the
    // in-Rust filter produced, without pulling every other patient's devices
    // into memory first.
    let user_devices: Vec<crate::clinical::WearableDevice> = data
        .repositories
        .wearable_device_records
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|rec| serde_json::from_value(rec.data).ok())
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "devices": user_devices,
        "count": user_devices.len()
    }))
}

/// Disconnect a wearable this patient registered.
///
/// # Why this exists
///
/// A patient could connect a device and never disconnect it. `POST
/// /api/wearables/devices` registered one, `GET` listed them, and there was no
/// route to stop one — the patient app's "Disconnect all" button had no handler
/// because there was nothing for it to call. A device streaming someone's heart
/// rate that they cannot switch off is the same problem as a phone they cannot
/// revoke, and the wearable half was missed.
///
/// Deactivates rather than deletes. Readings already taken were taken, and the
/// record of which device produced them is part of reading them correctly; the
/// repository's `delete` would take that away. `is_active: false` stops the
/// device without rewriting history.
///
/// Scoped to the caller's own devices. A patient disconnecting another
/// patient's wearable would be a denial of care, not a privacy control.
#[post("/api/wearables/devices/{device_id}/disconnect")]
pub async fn disconnect_wearable_device(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };
    let device_id = path.into_inner();

    // `wearable_device_records`, not `wearable_devices`.
    //
    // Registration persists the device as a JSON record in
    // `wearable_device_records`, and `GET /api/wearables/devices` reads it back
    // from there. The typed `wearable_devices` repository exists alongside it
    // and holds nothing this endpoint ever registered -- reading it 404s on a
    // device the patient can see in their own list, which is how the first cut
    // of this handler behaved.
    let mut record = match data
        .repositories
        .wearable_device_records
        .get_by_id(&device_id)
        .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Wearable device not found".to_string(),
                code: "WEARABLE_DEVICE_NOT_FOUND".to_string(),
            })
        }
        Err(error) => {
            log::error!("wearable device lookup failed for {device_id}: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The wearable device could not be read; please retry.".to_string(),
                code: "WEARABLE_STORE_UNAVAILABLE".to_string(),
            });
        }
    };

    // `owner_id` is the registering account. A patient disconnecting another
    // patient's wearable would be a denial of care, not a privacy control.
    if record.owner_id != current_user_id {
        return HttpResponse::Forbidden().json(ErrorResponse {
            error: "That device belongs to another account".to_string(),
            code: "WEARABLE_DEVICE_OWNER_MISMATCH".to_string(),
        });
    }

    // Deactivate in place. The stored shape is the `WearableDevice` the list
    // renders, so these are the two fields that screen reads.
    if let Some(object) = record.data.as_object_mut() {
        object.insert("active".to_string(), serde_json::Value::Bool(false));
        object.insert(
            "connection_status".to_string(),
            serde_json::Value::String("Disconnected".to_string()),
        );
    }
    record.updated_at = chrono::Utc::now();

    // `create` is insert-or-replace by id on this repository; there is no
    // separate `update`. Documented on the trait as "Insert or replace a record
    // by `id`", which is what a deactivation needs.
    match data
        .repositories
        .wearable_device_records
        .create(record)
        .await
    {
        Ok(record) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "device_id": record.id,
            "is_active": false,
            "connection_status": "Disconnected",
        })),
        Err(error) => {
            // Reporting a disconnect that did not happen leaves a patient
            // believing a device stopped streaming when it did not.
            log::error!("wearable disconnect failed for {device_id}: {error}");
            HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The device could not be disconnected; please retry.".to_string(),
                code: "WEARABLE_DISCONNECT_FAILED".to_string(),
            })
        }
    }
}

/// Get supported wearables (reference data)
#[get("/api/wearables/supported")]
pub async fn get_supported_wearables(
    _data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    // Only authenticated users can see supported wearables
    if http_req.headers().get("X-User-Id").is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            error: "Missing X-User-Id header".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let supported = vec![
        serde_json::json!({
            "manufacturer": "Apple",
            "models": ["Apple Watch Series 9", "Apple Watch Ultra 2", "Apple Watch SE"],
            "data_types": ["heart_rate", "spo2", "ecg", "steps", "sleep"]
        }),
        serde_json::json!({
            "manufacturer": "Fitbit",
            "models": ["Charge 6", "Sense 2", "Versa 4", "Inspire 3"],
            "data_types": ["heart_rate", "steps", "sleep", "skin_temperature"]
        }),
        serde_json::json!({
            "manufacturer": "Garmin",
            "models": ["Venu 3", "Forerunner 265", "Fenix 7", "Lily"],
            "data_types": ["heart_rate", "spo2", "steps", "stress", "body_battery"]
        }),
        serde_json::json!({
            "manufacturer": "Samsung",
            "models": ["Galaxy Watch6", "Galaxy Watch6 Classic"],
            "data_types": ["heart_rate", "blood_pressure", "ecg", "steps", "sleep"]
        }),
        serde_json::json!({
            "manufacturer": "Oura",
            "models": ["Heritage", "Horizon"],
            "data_types": ["heart_rate", "sleep", "readiness", "temperature"]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "supported_manufacturers": supported
    }))
}

/// Submit wearable reading request
#[derive(Debug, Deserialize)]
pub struct SubmitWearableReadingRequest {
    pub device_id: String,
    pub data_type: String,
    pub value: f64,
    pub unit: String,
    pub timestamp: Option<i64>,
    // No `metadata`: `clinical::WearableReading` has nowhere to keep it. A
    // client that sends one is not refused -- serde ignores unknown fields.
}

/// Submit a wearable reading
#[post("/api/wearables/readings")]
pub async fn submit_wearable_reading(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitWearableReadingRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Verify device ownership
    let stored_device = data
        .repositories
        .wearable_device_records
        .get_by_id(&req.device_id)
        .await
        .ok()
        .flatten();
    match stored_device {
        Some(rec) => {
            let d: crate::clinical::WearableDevice =
                serde_json::from_value(rec.data).unwrap_or_default();
            if d.patient_id != current_user_id {
                return HttpResponse::Forbidden().json(ErrorResponse {
                    error: "You do not own this device".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                error: "Device not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    }

    let reading_id = format!("READ-{}", uuid::Uuid::new_v4());

    // Parsed ONCE, and everything downstream works from the enum.
    //
    // There used to be two vocabularies in this function: the reading was
    // parsed from `"HeartRate"`/`"SpO2"` while the abnormality check matched
    // `"heart_rate"`/`"spo2"`. Whichever spelling a client sent, one of the two
    // matched nothing -- so either the reading stored as `Other("heart_rate")`
    // or no alert could ever fire. Strings do not travel past this line.
    let data_type = parse_wearable_data_type(&req.data_type);
    let builtin = check_reading_for_abnormality(&data_type, req.value);
    let is_abnormal = builtin.is_some();

    let reading = crate::clinical::WearableReading {
        reading_id: reading_id.clone(),
        device_id: req.device_id.clone(),
        patient_id: current_user_id.clone(),
        data_type: data_type.clone(),
        value: req.value,
        unit: req.unit.clone(),
        secondary_value: None,
        recorded_at: req
            .timestamp
            .unwrap_or_else(|| chrono::Utc::now().timestamp()),
        synced_at: chrono::Utc::now().timestamp(),
        context: None,
        quality: crate::clinical::DataQuality::High,
        flagged: is_abnormal,
        flag_reason: builtin.as_ref().map(|(_, reason)| reason.clone()),
    };

    {
        // Persist reading via repository
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: reading_id.clone(),
            owner_id: reading.patient_id.clone(),
            data: serde_json::to_value(&reading).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data
            .repositories
            .wearable_reading_records
            .create(entity)
            .await
        {
            log::error!("wearable_reading_records persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The alert rule could not be saved; please retry.".to_string(),
                code: "WEARABLE_READING_RECORD_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    // The patient's own rules first; the built-in safety net only if none fired.
    let triggered = evaluate_alert_rules(&data, &current_user_id, &data_type, req.value).await;

    if triggered.is_some() || is_abnormal {
        let alert_id = format!("WALT-{}", uuid::Uuid::new_v4());
        // A rule that fired supplies its own id, threshold and severity. With
        // no rule, the alert says so: `BUILT-IN` is a real answer to "under
        // what rule?", where `AD-HOC` with a threshold of 0.0 was not.
        let (rule_id, threshold, severity, message) = match triggered {
            Some(t) => (t.rule_id, t.threshold, t.severity, t.message),
            // The built-in threshold that was actually crossed, not a
            // placeholder. `0.0` used to go here with a comment admitting it
            // should have come from a rule, so the alert asserted that a
            // threshold of zero had been passed; `f64::NAN` would have been
            // worse still, because `serde_json` cannot represent it and the
            // surrounding `unwrap_or_default()` would have stored the whole
            // alert as null.
            None => {
                let (threshold, reason) = builtin
                    .clone()
                    .expect("is_abnormal is true only when builtin is Some");
                (
                    "BUILT-IN".to_string(),
                    threshold,
                    crate::clinical::AlertSeverity::Urgent,
                    reason,
                )
            }
        };
        let alert = crate::clinical::WearableAlert {
            alert_id: alert_id.clone(),
            rule_id,
            patient_id: current_user_id.clone(),
            reading_id: reading_id.clone(),
            data_type: reading.data_type.clone(),
            trigger_value: req.value,
            threshold,
            severity,
            message,
            created_at: chrono::Utc::now().timestamp(),
            acknowledged: false,
            acknowledged_by: None,
            acknowledged_at: None,
            action_taken: None,
        };

        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: alert_id,
            owner_id: alert.patient_id.clone(),
            data: serde_json::to_value(&alert).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data
            .repositories
            .wearable_alert_records
            .create(entity)
            .await
        {
            log::error!("wearable_alert_records persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The alert rule could not be saved; please retry.".to_string(),
                code: "WEARABLE_ALERT_RECORD_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading_id,
        "is_abnormal": is_abnormal,
        "message": if is_abnormal { "Abnormal reading detected and logged." } else { "Reading submitted successfully." }
    }))
}

/// Helper: Check reading for abnormality
/// Resolve the data type a client named.
///
/// `Other` carries the original string rather than discarding it: an unknown
/// wearable metric is a real thing to record, and losing its name would make
/// the reading unreadable. It is the only variant that keeps a string.
fn parse_wearable_data_type(raw: &str) -> crate::clinical::WearableDataType {
    use crate::clinical::WearableDataType as T;
    // Case- and separator-insensitive, because three different clients spell
    // these three different ways and none of them is wrong.
    let key: String = raw
        .chars()
        .filter(|c| !matches!(c, '-' | '_' | ' '))
        .flat_map(char::to_lowercase)
        .collect();
    match key.as_str() {
        "heartrate" => T::HeartRate,
        "bloodpressure" => T::BloodPressure,
        "bloodglucose" => T::BloodGlucose,
        "spo2" | "oxygensaturation" => T::SpO2,
        "weight" => T::Weight,
        "steps" => T::Steps,
        "distance" => T::Distance,
        "calories" => T::Calories,
        "sleep" => T::Sleep,
        "ecg" => T::ECG,
        "temperature" => T::Temperature,
        "respiratoryrate" => T::RespiratoryRate,
        "stress" => T::Stress,
        _ => T::Other(raw.to_string()),
    }
}

/// The built-in safety net, applied when the patient has set no rule.
///
/// These are not the patient's thresholds -- they are the values at which a
/// reading is worth flagging regardless of what anybody configured, so that a
/// patient who has never opened the alerts screen is still told about a blood
/// glucose of 30. A rule the patient DID set takes precedence; see
/// `evaluate_alert_rules`.
fn check_reading_for_abnormality(
    data_type: &crate::clinical::WearableDataType,
    value: f64,
) -> Option<(f64, String)> {
    use crate::clinical::WearableDataType as T;
    match data_type {
        T::HeartRate if value > 120.0 => Some((120.0, "High heart rate detected".to_string())),
        T::HeartRate if value < 40.0 => Some((40.0, "Low heart rate detected".to_string())),
        T::BloodGlucose if value > 180.0 => Some((
            180.0,
            "Hyperglycemia (high blood sugar) detected".to_string(),
        )),
        T::BloodGlucose if value < 70.0 => {
            Some((70.0, "Hypoglycemia (low blood sugar) detected".to_string()))
        }
        T::SpO2 if value < 92.0 => Some((92.0, "Low blood oxygen levels detected".to_string())),
        _ => None,
    }
}

/// What a reading triggered, and under whose rule.
///
/// `rule_id`, `threshold` and `severity` all come from the rule that fired.
/// They used to be the literal `"AD-HOC"`, `0.0` with a `// Should be fetched
/// from rule` comment, and a hardcoded `Urgent` -- so an alert told the
/// clinician that a threshold of zero had been crossed under a rule with no id,
/// at a severity nobody chose.
pub(crate) struct TriggeredAlert {
    pub rule_id: String,
    pub threshold: f64,
    pub severity: crate::clinical::AlertSeverity,
    pub message: String,
}

/// Does this rule fire on this value?
///
/// `ChangeRate` and `AbsenceOfData` are deliberately never triggered here: both
/// need history this function does not have, and firing them off a single
/// reading would be an alert about something nobody measured.
fn rule_fires(rule: &crate::clinical::WearableAlertRule, value: f64) -> bool {
    use crate::clinical::ThresholdType as K;
    match rule.threshold_type {
        K::Above => value > rule.threshold_value,
        K::Below => value < rule.threshold_value,
        K::OutsideRange => match rule.secondary_threshold {
            Some(low) => value > rule.threshold_value || value < low,
            None => value > rule.threshold_value,
        },
        K::ChangeRate | K::AbsenceOfData => false,
    }
}

/// The patient's own alert rules for this metric, most severe first.
///
/// These were stored and never read by anything: a patient could configure
/// "tell me when my heart rate goes above 150 and treat it as Critical", and
/// the rule sat in the table while every alert fired at `Urgent` off a built-in
/// threshold. Inactive rules are skipped -- switching one off has to mean
/// something.
async fn evaluate_alert_rules(
    data: &web::Data<crate::AppState>,
    owner_id: &str,
    data_type: &crate::clinical::WearableDataType,
    value: f64,
) -> Option<TriggeredAlert> {
    let records = data
        .repositories
        .wearable_alert_rules
        .get_by_owner(owner_id)
        .await
        .unwrap_or_default();

    let mut fired: Vec<crate::clinical::WearableAlertRule> = records
        .into_iter()
        .filter_map(|record| {
            serde_json::from_value::<crate::clinical::WearableAlertRule>(record.data).ok()
        })
        .filter(|rule| rule.active && &rule.data_type == data_type && rule_fires(rule, value))
        .collect();

    // Most severe wins. Two rules can cover the same reading, and the patient
    // who set a Critical one is not served by being told Info.
    fired.sort_by_key(|rule| std::cmp::Reverse(severity_rank(&rule.severity)));
    let rule = fired.into_iter().next()?;

    Some(TriggeredAlert {
        message: format!(
            "{:?} of {} crossed your alert threshold of {}",
            rule.data_type, value, rule.threshold_value
        ),
        rule_id: rule.rule_id,
        threshold: rule.threshold_value,
        severity: rule.severity,
    })
}

/// Order severities so the worst sorts first.
fn severity_rank(severity: &crate::clinical::AlertSeverity) -> u8 {
    use crate::clinical::AlertSeverity as S;
    match severity {
        S::Critical => 3,
        S::Urgent => 2,
        S::Warning => 1,
        S::Info => 0,
    }
}

/// The alert rules this caller has set.
///
/// `POST` has stored them since the feature was built and nothing could read
/// them back: a patient could not see, check or correct a rule once it was
/// saved, and no code consulted them when a reading arrived.
#[get("/api/wearables/alert-rules")]
pub async fn list_wearable_alert_rules(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let records = data
        .repositories
        .wearable_alert_rules
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default();
    let rules: Vec<crate::clinical::WearableAlertRule> = records
        .into_iter()
        .filter_map(|record| {
            serde_json::from_value::<crate::clinical::WearableAlertRule>(record.data).ok()
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "count": rules.len(),
        "rules": rules,
    }))
}

/// Get wearable readings
#[get("/api/wearables/readings/{device_id}")]
pub async fn get_wearable_readings(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> impl Responder {
    let device_id = path.into_inner();
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Owner-scoped in the query; the device narrowing stays in Rust because a
    // JSON-record store indexes by owner, not by device.
    let all_records = data
        .repositories
        .wearable_reading_records
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default();
    let mut readings: Vec<crate::clinical::WearableReading> = all_records
        .into_iter()
        .filter_map(|rec| {
            let r: crate::clinical::WearableReading = serde_json::from_value(rec.data).ok()?;
            if r.device_id == device_id && r.patient_id == current_user_id {
                Some(r)
            } else {
                None
            }
        })
        .collect();

    // Filter by data type if provided
    if let Some(data_type_str) = query.get("data_type") {
        let dt = match data_type_str.as_str() {
            "HeartRate" => crate::clinical::WearableDataType::HeartRate,
            "BloodPressure" => crate::clinical::WearableDataType::BloodPressure,
            "BloodGlucose" => crate::clinical::WearableDataType::BloodGlucose,
            "SpO2" => crate::clinical::WearableDataType::SpO2,
            "Weight" => crate::clinical::WearableDataType::Weight,
            "Steps" => crate::clinical::WearableDataType::Steps,
            _ => crate::clinical::WearableDataType::Other(data_type_str.clone()),
        };
        readings.retain(|r| r.data_type == dt);
    }

    // Sort by recorded_at descending
    readings.sort_by_key(|b| std::cmp::Reverse(b.recorded_at));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "readings": readings,
        "count": readings.len()
    }))
}

/// Create alert rule request
#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleRequest {
    // No `device_id`: a rule watches a patient's readings of one data type,
    // whichever device reports them -- the right scope for a clinical
    // threshold. A device sent by the form is ignored, and the create response
    // states the rule's actual coverage.
    pub data_type: String,
    pub threshold_low: Option<f64>,
    pub threshold_high: Option<f64>,
    pub severity: String,
}

/// Which bound a rule actually watches.
///
/// # Why this is not inline
///
/// `threshold_type` used to be hardcoded to `Above` and `threshold_value` was
/// `threshold_high.unwrap_or(0.0)`. So a patient asking to be told when their
/// heart rate fell **below 50** had a rule stored as "above 0.0", which is true
/// of every reading a wearable will ever send — the alert they set to catch a
/// dangerous drop would instead fire continuously and be muted.
///
/// `unwrap_or(0.0)` is the specific mistake: an absent upper bound is not an
/// upper bound of zero. A rule with neither bound is refused rather than
/// defaulted, because there is no safe reading of "alert me when nothing".
struct AlertBounds {
    threshold_type: crate::clinical::ThresholdType,
    value: f64,
    secondary: Option<f64>,
}

fn alert_bounds(low: Option<f64>, high: Option<f64>) -> Result<AlertBounds, &'static str> {
    match (low, high) {
        // Both: alert outside the band. `value` carries the high bound and
        // `secondary` the low one, matching how `WearableAlertRule` documents
        // its own pair.
        (Some(low), Some(high)) if low < high => Ok(AlertBounds {
            threshold_type: crate::clinical::ThresholdType::OutsideRange,
            value: high,
            secondary: Some(low),
        }),
        (Some(_), Some(_)) => Err("The low threshold must be below the high threshold"),
        (None, Some(high)) => Ok(AlertBounds {
            threshold_type: crate::clinical::ThresholdType::Above,
            value: high,
            secondary: None,
        }),
        (Some(low), None) => Ok(AlertBounds {
            threshold_type: crate::clinical::ThresholdType::Below,
            value: low,
            secondary: None,
        }),
        (None, None) => Err("An alert rule needs a low threshold, a high threshold, or both"),
    }
}

/// Create a wearable alert rule
#[post("/api/wearables/alerts/rules")]
pub async fn create_wearable_alert_rule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAlertRuleRequest>,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    let bounds = match alert_bounds(req.threshold_low, req.threshold_high) {
        Ok(value) => value,
        Err(message) => {
            return HttpResponse::BadRequest().json(ErrorResponse {
                error: message.to_string(),
                code: "WEARABLE_ALERT_RULE_REJECTED".to_string(),
            })
        }
    };

    let rule_id = format!("RULE-{}", uuid::Uuid::new_v4());
    let alert_rule = crate::clinical::WearableAlertRule {
        rule_id: rule_id.clone(),
        patient_id: current_user_id.clone(),
        data_type: match req.data_type.as_str() {
            "HeartRate" => crate::clinical::WearableDataType::HeartRate,
            "BloodPressure" => crate::clinical::WearableDataType::BloodPressure,
            "BloodGlucose" => crate::clinical::WearableDataType::BloodGlucose,
            "SpO2" => crate::clinical::WearableDataType::SpO2,
            "Weight" => crate::clinical::WearableDataType::Weight,
            "Steps" => crate::clinical::WearableDataType::Steps,
            _ => crate::clinical::WearableDataType::Other(req.data_type.clone()),
        },
        threshold_type: bounds.threshold_type,
        threshold_value: bounds.value,
        secondary_threshold: bounds.secondary,
        severity: match req.severity.as_str() {
            "Critical" => crate::clinical::AlertSeverity::Critical,
            "Urgent" => crate::clinical::AlertSeverity::Urgent,
            "Warning" => crate::clinical::AlertSeverity::Warning,
            _ => crate::clinical::AlertSeverity::Info,
        },
        notify_patient: true,
        notify_provider: true,
        provider_id: None,
        active: true,
        created_at: chrono::Utc::now().timestamp(),
    };

    {
        // Persist rule via repository
        let now_dt = chrono::Utc::now();
        let entity = crate::repositories::traits::JsonRecordEntity {
            id: rule_id.clone(),
            owner_id: current_user_id.clone(),
            data: serde_json::to_value(&alert_rule).unwrap_or_default(),
            created_at: now_dt,
            updated_at: now_dt,
        };
        // This repository is the record's persistence. Discarding the result
        // returned success for something that was never stored.
        if let Err(error) = data.repositories.wearable_alert_rules.create(entity).await {
            log::error!("wearable_alert_rules persistence failed: {error}");
            return HttpResponse::ServiceUnavailable().json(ErrorResponse {
                error: "The alert rule could not be saved; please retry.".to_string(),
                code: "WEARABLE_ALERT_RULE_PERSISTENCE_FAILED".to_string(),
            });
        }
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "rule_id": rule_id,
        // The scope the rule actually has, said out loud. The form asks which
        // device; `WearableAlertRule` has no device field, so the rule watches
        // every device reporting this measurement. A clinician who picked one
        // strap needs to know the alert is not limited to it.
        "applies_to": "all_devices_reporting_this_data_type",
        "message": "Alert rule created successfully"
    }))
}

/// Get wearable alerts
#[get("/api/wearables/alerts")]
pub async fn get_wearable_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match crate::support::require_registered_caller(&data, &http_req) {
        Ok(u) => u.wallet_address,
        Err(resp) => return resp,
    };

    // Owner-scoped in the query — see `get_wearable_devices`.
    let all_records = data
        .repositories
        .wearable_alert_records
        .get_by_owner(&current_user_id)
        .await
        .unwrap_or_default();
    let mut user_alerts: Vec<crate::clinical::WearableAlert> = {
        all_records
            .into_iter()
            .filter_map(|r| {
                let a: crate::clinical::WearableAlert = serde_json::from_value(r.data).ok()?;
                if a.patient_id == current_user_id {
                    Some(a)
                } else {
                    None
                }
            })
            .collect()
    };

    // Sort by created_at descending
    user_alerts.sort_by_key(|b| std::cmp::Reverse(b.created_at));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": user_alerts,
        "count": user_alerts.len()
    }))
}

/// What a wearable alert rule actually watches.
///
/// # Why this exists
///
/// `threshold_type` was hardcoded to `Above` and `threshold_value` was
/// `threshold_high.unwrap_or(0.0)`. A patient asking to be alerted when their
/// heart rate fell **below 50** got a rule meaning "above 0.0" — true of every
/// reading a wearable will ever produce. The alert set to catch a dangerous
/// drop would fire on everything, and the patient would mute it.
///
/// These assert the direction, because the direction is the whole rule.
#[cfg(test)]
mod alert_bounds_tests {
    use super::alert_bounds;
    use crate::clinical::ThresholdType;

    #[test]
    fn a_low_bound_alone_watches_below_it() {
        let bounds = alert_bounds(Some(50.0), None).unwrap();
        assert!(matches!(bounds.threshold_type, ThresholdType::Below));
        assert_eq!(bounds.value, 50.0);
        assert_eq!(bounds.secondary, None);
    }

    #[test]
    fn a_high_bound_alone_watches_above_it() {
        let bounds = alert_bounds(None, Some(120.0)).unwrap();
        assert!(matches!(bounds.threshold_type, ThresholdType::Above));
        assert_eq!(bounds.value, 120.0);
    }

    #[test]
    fn both_bounds_watch_outside_the_band() {
        let bounds = alert_bounds(Some(50.0), Some(120.0)).unwrap();
        assert!(matches!(bounds.threshold_type, ThresholdType::OutsideRange));
        assert_eq!(bounds.value, 120.0);
        assert_eq!(bounds.secondary, Some(50.0));
    }

    /// An absent bound is not a bound of zero. Refusing is the only safe
    /// reading of "alert me when nothing".
    #[test]
    fn a_rule_with_no_bound_is_refused() {
        assert!(alert_bounds(None, None).is_err());
    }

    /// An inverted band would be outside itself for every possible reading.
    #[test]
    fn an_inverted_band_is_refused() {
        assert!(alert_bounds(Some(120.0), Some(50.0)).is_err());
    }
}
