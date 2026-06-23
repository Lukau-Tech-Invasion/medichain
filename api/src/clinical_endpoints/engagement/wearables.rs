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
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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
        let _ = data
            .repositories
            .wearable_device_records
            .create(entity)
            .await;
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
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Repository list_all() (was: data.wearable_devices HashMap)
    let all_records = data
        .repositories
        .wearable_device_records
        .list_all()
        .await
        .unwrap_or_default();
    let user_devices: Vec<crate::clinical::WearableDevice> = all_records
        .into_iter()
        .filter_map(|rec| {
            let d: crate::clinical::WearableDevice = serde_json::from_value(rec.data).ok()?;
            if d.patient_id == current_user_id {
                Some(d)
            } else {
                None
            }
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "devices": user_devices,
        "count": user_devices.len()
    }))
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
            success: false,
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
    #[allow(dead_code)]
    pub metadata: Option<serde_json::Value>,
}

/// Submit a wearable reading
#[post("/api/wearables/readings")]
pub async fn submit_wearable_reading(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<SubmitWearableReadingRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
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
                    success: false,
                    error: "You do not own this device".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }
        }
        None => {
            return HttpResponse::NotFound().json(ErrorResponse {
                success: false,
                error: "Device not found".to_string(),
                code: "NOT_FOUND".to_string(),
            });
        }
    }

    let reading_id = format!("READ-{}", uuid::Uuid::new_v4());
    let (is_abnormal, alert_message) = check_reading_for_abnormality(&req.data_type, req.value);

    let reading = crate::clinical::WearableReading {
        reading_id: reading_id.clone(),
        device_id: req.device_id.clone(),
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
        flag_reason: alert_message.clone(),
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
        let _ = data
            .repositories
            .wearable_reading_records
            .create(entity)
            .await;
    }

    // If abnormal, create an alert
    if is_abnormal {
        let alert_id = format!("WALT-{}", uuid::Uuid::new_v4());
        let alert = crate::clinical::WearableAlert {
            alert_id: alert_id.clone(),
            rule_id: "AD-HOC".to_string(),
            patient_id: current_user_id.clone(),
            reading_id: reading_id.clone(),
            data_type: reading.data_type.clone(),
            trigger_value: req.value,
            threshold: 0.0, // Should be fetched from rule
            severity: crate::clinical::AlertSeverity::Urgent,
            message: alert_message
                .unwrap_or_else(|| format!("Abnormal {:?} reading detected", reading.data_type)),
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
        let _ = data
            .repositories
            .wearable_alert_records
            .create(entity)
            .await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "reading_id": reading_id,
        "is_abnormal": is_abnormal,
        "message": if is_abnormal { "Abnormal reading detected and logged." } else { "Reading submitted successfully." }
    }))
}

/// Helper: Check reading for abnormality
fn check_reading_for_abnormality(data_type: &str, value: f64) -> (bool, Option<String>) {
    match data_type {
        "heart_rate" => {
            if value > 120.0 {
                (true, Some("High heart rate detected".to_string()))
            } else if value < 40.0 {
                (true, Some("Low heart rate detected".to_string()))
            } else {
                (false, None)
            }
        }
        "blood_glucose" => {
            if value > 180.0 {
                (
                    true,
                    Some("Hyperglycemia (high blood sugar) detected".to_string()),
                )
            } else if value < 70.0 {
                (
                    true,
                    Some("Hypoglycemia (low blood sugar) detected".to_string()),
                )
            } else {
                (false, None)
            }
        }
        "spo2" => {
            if value < 92.0 {
                (true, Some("Low blood oxygen levels detected".to_string()))
            } else {
                (false, None)
            }
        }
        _ => (false, None),
    }
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
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Repository list_all() (was: data.wearable_readings HashMap)
    let all_records = data
        .repositories
        .wearable_reading_records
        .list_all()
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
    readings.sort_by(|a, b| b.recorded_at.cmp(&a.recorded_at));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "readings": readings,
        "count": readings.len()
    }))
}

/// Create alert rule request
#[derive(Debug, Deserialize)]
pub struct CreateAlertRuleRequest {
    #[allow(dead_code)]
    pub device_id: String,
    pub data_type: String,
    pub threshold_low: Option<f64>,
    pub threshold_high: Option<f64>,
    pub severity: String,
}

/// Create a wearable alert rule
#[post("/api/wearables/alerts/rules")]
pub async fn create_wearable_alert_rule(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
    req: web::Json<CreateAlertRuleRequest>,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
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
        threshold_type: crate::clinical::ThresholdType::Above,
        threshold_value: req.threshold_high.unwrap_or(0.0),
        secondary_threshold: req.threshold_low,
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
        let _ = data.repositories.wearable_alert_rules.create(entity).await;
    }

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "rule_id": rule_id,
        "message": "Alert rule created successfully"
    }))
}

/// Get wearable alerts
#[get("/api/wearables/alerts")]
pub async fn get_wearable_alerts(
    data: web::Data<crate::AppState>,
    http_req: HttpRequest,
) -> impl Responder {
    let current_user_id = match http_req.headers().get("X-User-Id") {
        Some(id) => id.to_str().unwrap_or("").to_string(),
        None => {
            return HttpResponse::Unauthorized().json(ErrorResponse {
                success: false,
                error: "Missing X-User-Id header".to_string(),
                code: "UNAUTHORIZED".to_string(),
            })
        }
    };

    // Repository list_all() (was: data.wearable_alerts HashMap)
    let all_records = data
        .repositories
        .wearable_alert_records
        .list_all()
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
    user_alerts.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "alerts": user_alerts,
        "count": user_alerts.len()
    }))
}
