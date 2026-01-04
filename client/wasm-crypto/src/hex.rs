//! Minimal hex encoding for WASM size optimization
//! Avoids adding the full `hex` crate dependency

const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

/// Encode bytes to lowercase hex string
pub fn encode(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut hex = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        hex.push(HEX_CHARS[(byte >> 4) as usize] as char);
        hex.push(HEX_CHARS[(byte & 0xf) as usize] as char);
    }

    hex
}

/// Decode hex string to bytes
pub fn decode(hex: &str) -> Result<Vec<u8>, &'static str> {
    if hex.len() % 2 != 0 {
        return Err("Invalid hex length");
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let hex_bytes = hex.as_bytes();

    for chunk in hex_bytes.chunks(2) {
        let high = hex_char_to_nibble(chunk[0])?;
        let low = hex_char_to_nibble(chunk[1])?;
        bytes.push((high << 4) | low);
    }

    Ok(bytes)
}

fn hex_char_to_nibble(c: u8) -> Result<u8, &'static str> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err("Invalid hex character"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode() {
        assert_eq!(encode([0x00, 0xff, 0x0a]), "00ff0a");
        assert_eq!(encode([]), "");
    }

    #[test]
    fn test_decode() {
        assert_eq!(decode("00ff0a").unwrap(), vec![0x00, 0xff, 0x0a]);
        assert_eq!(decode("").unwrap(), vec![]);
    }

    #[test]
    fn test_roundtrip() {
        let original = vec![1, 2, 3, 255, 0, 128];
        let hex = encode(&original);
        let decoded = decode(&hex).unwrap();
        assert_eq!(original, decoded);
    }
}
