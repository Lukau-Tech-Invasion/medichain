//! What makes a password acceptable when it is set.
//!
//! Sign-in never sends the password (the browser derives a proof). Setting one
//! does, once, so this module can refuse a weak one before the server derives
//! the proof itself (`medichain_crypto::auth_proof`) and forgets the password.
//!
//! The rules follow the OWASP Authentication Cheat Sheet as summarised in the
//! owner's library (`knowledge-base/sources/external/web-application-security-owasp.md`):
//! length does the work, composition rules are rejected, and a password found
//! in a breach corpus is refused however long it is.
//!
//! * 15 to 128 characters. 15 is the cheat sheet's floor for an account without
//!   MFA, and two-factor is optional for most accounts here.
//! * Not a common password, including its usual decorations (`Password2026!`,
//!   `P@ssw0rd`), and not mostly a keyboard run or repetition.
//! * Not built from the person's own login ID or name.
//! * Not in Pwned Passwords, checked by k-anonymity: only the first five hex
//!   characters of the SHA-1 leave the server (`PASSWORD_BREACH_CHECK`).

use sha1::{Digest, Sha1};

pub const MIN_CHARS: usize = 15;
pub const MAX_CHARS: usize = 128;

/// Why a password was refused. `code` is stable for clients; `message` is shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejection {
    pub code: &'static str,
    pub message: &'static str,
}

const TOO_SHORT: Rejection = Rejection {
    code: "PASSWORD_TOO_SHORT",
    message: "Use at least 15 characters. A few unrelated words make a strong, memorable password.",
};
const TOO_LONG: Rejection = Rejection {
    code: "PASSWORD_TOO_LONG",
    message: "Use at most 128 characters.",
};
const COMMON: Rejection = Rejection {
    code: "PASSWORD_TOO_COMMON",
    message: "That password is too common or too predictable. Choose something less guessable.",
};
const PERSONAL: Rejection = Rejection {
    code: "PASSWORD_CONTAINS_IDENTITY",
    message: "Do not use your name, username or employee ID in your password.",
};
const BREACHED: Rejection = Rejection {
    code: "PASSWORD_BREACHED",
    message: "That password has appeared in a data breach elsewhere. Choose a different one.",
};

/// Base words that, with digits and symbols around them, are guessed first.
const COMMON_WORDS: &[&str] = &[
    "password",
    "passwort",
    "passcode",
    "qwerty",
    "qwertyuiop",
    "asdfgh",
    "zxcvbn",
    "letmein",
    "welcome",
    "admin",
    "administrator",
    "iloveyou",
    "monkey",
    "dragon",
    "football",
    "soccer",
    "rugby",
    "cricket",
    "baseball",
    "sunshine",
    "princess",
    "shadow",
    "master",
    "superman",
    "batman",
    "trustno",
    "starwars",
    "whatever",
    "freedom",
    "secret",
    "login",
    "changeme",
    "default",
    "test",
    "tester",
    "testing",
    "guest",
    "user",
    "hello",
    "abc",
    "abcdef",
    "abcdefgh",
    "medichain",
    "medical",
    "doctor",
    "nurse",
    "hospital",
    "clinic",
    "health",
    "patient",
    "pharmacy",
    "springbok",
    "springboks",
    "bafana",
    "mzansi",
    "southafrica",
    "johannesburg",
    "joburg",
    "capetown",
    "durban",
    "soweto",
    "pretoria",
    "amandla",
    "ubuntu",
    "jesus",
    "god",
    "love",
    "family",
    "summer",
    "winter",
    "spring",
    "autumn",
    "january",
    "february",
    "december",
    "monday",
    "friday",
    "computer",
    "internet",
    "samsung",
    "iphone",
];

/// Refuse a password that fails any local rule. Pure; no I/O.
pub fn check_local(password: &str, login_id: &str, name: &str) -> Result<(), Rejection> {
    let chars = password.chars().count();
    if chars < MIN_CHARS {
        return Err(TOO_SHORT);
    }
    if chars > MAX_CHARS {
        return Err(TOO_LONG);
    }
    if contains_identity(password, login_id, name) {
        return Err(PERSONAL);
    }
    if is_common(password) || is_mostly_predictable(password) {
        return Err(COMMON);
    }
    Ok(())
}

/// The password with its usual disguises removed: lower case, the common
/// look-alike digits and symbols read as letters, everything else dropped.
fn skeleton(password: &str) -> String {
    password
        .to_lowercase()
        .chars()
        .filter_map(|c| match c {
            '0' => Some('o'),
            '1' | '!' | '|' => Some('i'),
            '3' => Some('e'),
            '4' | '@' => Some('a'),
            '5' | '$' => Some('s'),
            '7' => Some('t'),
            c if c.is_alphabetic() => Some(c),
            _ => None,
        })
        .collect()
}

/// A common word dressed up: its skeleton is that word, possibly repeated, or
/// the word plus at most three letters (the `i` an `!` reads as, a plural `s`).
fn is_common(password: &str) -> bool {
    let shape = skeleton(password);
    let letters: String = password
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphabetic())
        .collect();
    COMMON_WORDS.iter().any(|word| {
        [shape.as_str(), letters.as_str()].iter().any(|candidate| {
            !candidate.is_empty()
                && (candidate.trim_end_matches(*word).is_empty()
                    || (candidate.starts_with(*word) && candidate.len() <= word.len() + 3))
        })
    })
}

/// Mostly a keyboard run, a counting run or one repeated character.
fn is_mostly_predictable(password: &str) -> bool {
    let chars: Vec<char> = password.to_lowercase().chars().collect();
    let mut predictable = 0usize;
    for pair in chars.windows(2) {
        let (a, b) = (pair[0] as i64, pair[1] as i64);
        if (b - a).abs() <= 1 {
            predictable += 1;
        }
    }
    let distinct = {
        let mut seen: Vec<char> = chars.clone();
        seen.sort_unstable();
        seen.dedup();
        seen.len()
    };
    distinct < 6 || predictable * 2 >= chars.len().saturating_sub(1)
}

/// The login ID, or any part of the name of four letters or more, inside the
/// password (case-insensitively).
fn contains_identity(password: &str, login_id: &str, name: &str) -> bool {
    let haystack = password.to_lowercase();
    let login = login_id.trim().to_lowercase();
    let login_parts = login.split(|c: char| !c.is_alphanumeric());
    let name_parts = name.split_whitespace().map(str::to_lowercase);
    std::iter::once(login.clone())
        .chain(login_parts.map(str::to_string))
        .chain(name_parts)
        .filter(|part| part.chars().count() >= 4)
        .any(|part| haystack.contains(&part))
}

/// Whether the Pwned Passwords range check runs (`PASSWORD_BREACH_CHECK`).
///
/// `pwned` (the default outside demo mode) or `off` (the default in demo mode,
/// and the only sane setting for an air-gapped host).
pub fn breach_check_enabled() -> bool {
    match std::env::var("PASSWORD_BREACH_CHECK").ok().as_deref() {
        Some("pwned") => true,
        Some("off") => false,
        _ => !crate::support::is_demo_mode(),
    }
}

/// The SHA-1 of the password, upper-case hex, split into the five characters
/// sent and the thirty-five kept.
fn sha1_split(password: &str) -> (String, String) {
    let digest = Sha1::digest(password.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02X}")).collect();
    let (prefix, suffix) = hex.split_at(5);
    (prefix.to_string(), suffix.to_string())
}

/// Whether a Pwned Passwords range response lists `suffix` with a real count.
/// Padding rows (count 0, from `Add-Padding`) are not matches.
fn range_lists(body: &str, suffix: &str) -> bool {
    body.lines().any(|line| {
        let mut parts = line.trim().splitn(2, ':');
        let (Some(found), Some(count)) = (parts.next(), parts.next()) else {
            return false;
        };
        found.eq_ignore_ascii_case(suffix) && count.trim().parse::<u64>().is_ok_and(|n| n > 0)
    })
}

/// Refuse a password found in Pwned Passwords.
///
/// When the service cannot be reached the password is accepted on the local
/// rules alone and the gap is logged: refusing every activation during an
/// outage would lock out new staff, and the local rules still hold.
pub async fn check_breached(password: &str) -> Result<(), Rejection> {
    if !breach_check_enabled() {
        return Ok(());
    }
    let (prefix, suffix) = sha1_split(password);
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            log::warn!("Password breach check unavailable (client): {error}");
            return Ok(());
        }
    };
    let response = client
        .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
        .header("Add-Padding", "true")
        .header("User-Agent", "MediChain-password-check")
        .send()
        .await;
    match response {
        Ok(ok) if ok.status().is_success() => match ok.text().await {
            Ok(body) if range_lists(&body, &suffix) => Err(BREACHED),
            Ok(_) => Ok(()),
            Err(error) => {
                log::warn!("Password breach check unavailable (body): {error}");
                Ok(())
            }
        },
        Ok(other) => {
            log::warn!(
                "Password breach check unavailable (HTTP {})",
                other.status()
            );
            Ok(())
        }
        Err(error) => {
            log::warn!("Password breach check unavailable: {error}");
            Ok(())
        }
    }
}

/// Every rule, local first so a weak password never reaches the network.
pub async fn check(password: &str, login_id: &str, name: &str) -> Result<(), Rejection> {
    check_local(password, login_id, name)?;
    check_breached(password).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(password: &str) -> Option<&'static str> {
        check_local(password, "bt.doctor", "Thandiwe Ndlovu")
            .err()
            .map(|r| r.code)
    }

    #[test]
    fn length_does_the_work() {
        assert_eq!(refused("Kx9#mQ2!vL7p"), Some("PASSWORD_TOO_SHORT"));
        assert_eq!(
            refused(&"river lamp ".repeat(13)),
            Some("PASSWORD_TOO_LONG")
        );
        assert_eq!(refused("violet kettle moves north"), None);
    }

    #[test]
    fn no_composition_rules() {
        // All lower case, no digits, no symbols: long and unpredictable is enough.
        assert_eq!(refused("marula tree under winter stars"), None);
    }

    #[test]
    fn a_common_password_in_disguise_is_refused() {
        for weak in [
            "Password2026!!!!",
            "P@ssw0rdP@ssw0rd",
            "passwordpassword",
            "Welcome123456789",
            "Springboks2026!!",
            "Medichain-123456",
        ] {
            assert_eq!(refused(weak), Some("PASSWORD_TOO_COMMON"), "{weak}");
        }
    }

    #[test]
    fn runs_and_repetition_are_refused() {
        for weak in [
            "123456789012345",
            "abcdefghijklmnop",
            "aaaaaaaaaaaaaaaa",
            "qazqazqazqazqazq",
        ] {
            assert_eq!(refused(weak), Some("PASSWORD_TOO_COMMON"), "{weak}");
        }
    }

    #[test]
    fn the_persons_own_identity_is_refused() {
        assert_eq!(
            refused("my bt.doctor account key"),
            Some("PASSWORD_CONTAINS_IDENTITY")
        );
        assert_eq!(
            refused("NDLOVU loves the ocean"),
            Some("PASSWORD_CONTAINS_IDENTITY")
        );
        assert_eq!(
            refused("thandiwe at the river 9"),
            Some("PASSWORD_CONTAINS_IDENTITY")
        );
    }

    #[test]
    fn only_a_five_character_prefix_would_leave_the_server() {
        let (prefix, suffix) = sha1_split("password");
        assert_eq!(prefix, "5BAA6");
        assert_eq!(suffix, "1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    }

    #[test]
    fn a_listed_suffix_matches_and_padding_does_not() {
        let suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
        let body = format!("0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n{suffix}:10434004\r\n");
        assert!(range_lists(&body, suffix));
        let padded = format!("{suffix}:0\r\n");
        assert!(!range_lists(&padded, suffix));
        assert!(!range_lists("ABCDEF:3", suffix));
    }
}
