//! Deployment-supplied dispensing policy; contains no built-in drug schedule.

use serde::Deserialize;
use std::path::PathBuf;

const POLICY_PATH_ENV: &str = "DISPENSING_POLICY_PATH";
const MAX_POLICY_BYTES: u64 = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DispensingPolicy {
    version: String,
    verification_ttl_seconds: i64,
    rules: Vec<DispensingPolicyRule>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct DispensingPolicyRule {
    id: String,
    medication_code: Option<String>,
    category: Option<String>,
    medication_name: Option<String>,
    requires_secondary_verification: bool,
}

pub struct PolicySubject<'a> {
    pub medication_code: Option<&'a str>,
    pub category: Option<&'a str>,
    pub medication_name: &'a str,
    pub force_secondary_verification: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct PolicyDecision {
    pub required: bool,
    pub version: Option<String>,
    pub rule_id: Option<String>,
    pub ttl_seconds: Option<i64>,
}

fn normalized(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn field_matches(rule: Option<&str>, subject: Option<&str>) -> bool {
    match (rule, subject) {
        (Some(expected), Some(actual)) => normalized(expected) == normalized(actual),
        (Some(_), None) => false,
        (None, _) => true,
    }
}

fn rule_matches(rule: &DispensingPolicyRule, subject: &PolicySubject<'_>) -> bool {
    let has_selector =
        rule.medication_code.is_some() || rule.category.is_some() || rule.medication_name.is_some();
    has_selector
        && field_matches(rule.medication_code.as_deref(), subject.medication_code)
        && field_matches(rule.category.as_deref(), subject.category)
        && field_matches(
            rule.medication_name.as_deref(),
            Some(subject.medication_name),
        )
}

fn validate(policy: &DispensingPolicy) -> Result<(), String> {
    if policy.version.trim().is_empty() || policy.verification_ttl_seconds <= 0 {
        return Err("policy version and positive verification TTL are required".into());
    }
    if policy.rules.len() > 1_000 {
        return Err("dispensing policy exceeds 1000 rules".into());
    }
    for rule in &policy.rules {
        if rule.id.trim().is_empty()
            || (rule.medication_code.is_none()
                && rule.category.is_none()
                && rule.medication_name.is_none())
        {
            return Err("every dispensing policy rule needs an id and selector".into());
        }
    }
    Ok(())
}

fn read_policy(path: PathBuf) -> Result<DispensingPolicy, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("read dispensing policy metadata: {error}"))?;
    if metadata.len() > MAX_POLICY_BYTES {
        return Err("dispensing policy exceeds 64 KiB".into());
    }
    let bytes = std::fs::read(&path).map_err(|error| format!("read dispensing policy: {error}"))?;
    let policy: DispensingPolicy = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse dispensing policy: {error}"))?;
    validate(&policy)?;
    Ok(policy)
}

pub fn decide(subject: PolicySubject<'_>) -> Result<PolicyDecision, String> {
    let Some(path) = std::env::var_os(POLICY_PATH_ENV).map(PathBuf::from) else {
        if subject.force_secondary_verification {
            return Err("forced verification requires DISPENSING_POLICY_PATH".into());
        }
        return Ok(PolicyDecision {
            required: false,
            version: None,
            rule_id: None,
            ttl_seconds: None,
        });
    };
    let policy = read_policy(path)?;
    let matched = policy
        .rules
        .iter()
        .find(|rule| rule_matches(rule, &subject));
    let required_rule = matched.filter(|rule| rule.requires_secondary_verification);
    if subject.force_secondary_verification && required_rule.is_none() {
        return Err("no approved policy rule authorizes forced verification".into());
    }
    Ok(PolicyDecision {
        required: required_rule.is_some(),
        version: required_rule.map(|_| policy.version),
        rule_id: required_rule.map(|rule| rule.id.clone()),
        ttl_seconds: required_rule.map(|_| policy.verification_ttl_seconds),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> DispensingPolicy {
        DispensingPolicy {
            version: "za-org-policy-1".into(),
            verification_ttl_seconds: 900,
            rules: vec![DispensingPolicyRule {
                id: "oncology-category".into(),
                medication_code: None,
                category: Some("oncology".into()),
                medication_name: None,
                requires_secondary_verification: true,
            }],
        }
    }

    #[test]
    fn approved_category_matches_without_a_built_in_drug_list() {
        let subject = PolicySubject {
            medication_code: None,
            category: Some("Oncology"),
            medication_name: "Deployment supplied medicine",
            force_secondary_verification: false,
        };
        let configured = policy();
        let matched = configured
            .rules
            .iter()
            .find(|rule| rule_matches(rule, &subject));
        assert_eq!(
            matched.map(|rule| rule.id.as_str()),
            Some("oncology-category")
        );
    }

    #[test]
    fn invalid_policy_is_rejected_instead_of_partially_applied() {
        let mut invalid = policy();
        invalid.verification_ttl_seconds = 0;
        assert!(validate(&invalid).is_err());
    }
}
