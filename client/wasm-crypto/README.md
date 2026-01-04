# MediChain WASM Crypto Module

Rust + WebAssembly cryptographic library for browser-based medical data encryption.

## 🔐 Features

- **ChaCha20-Poly1305** authenticated encryption for medical records
- **SHA-256** hashing for data integrity and national ID privacy
- **QR Code Generation** for emergency access cards
- **Secure Random** number generation using browser crypto API

## 🚀 Building

### Prerequisites

```bash
# Install wasm-pack
cargo install wasm-pack
```

### Build for npm

```bash
wasm-pack build --target web --out-dir pkg
```

### Build for bundler (webpack, vite, etc.)

```bash
wasm-pack build --target bundler --out-dir pkg
```

## 📦 Usage in JavaScript/TypeScript

```typescript
import init, { 
  encrypt_medical_data, 
  decrypt_medical_data, 
  generate_emergency_qr,
  hash_national_id,
  generate_health_id
} from 'medichain-wasm-crypto';

// Initialize WASM module
await init();

// Encrypt sensitive medical data
const patientData = JSON.stringify({
  name: "John Doe",
  blood_type: "O+",
  allergies: ["Penicillin"]
});

const encrypted = encrypt_medical_data(patientData, "secure_password");
console.log("Encrypted:", encrypted);

// Decrypt
const decrypted = decrypt_medical_data(encrypted, "secure_password");
console.log("Decrypted:", JSON.parse(decrypted));

// Generate QR code for emergency card
const qrResult = generate_emergency_qr("MCHI-2026-AB12-CD34", "abc123def456");
const qr = JSON.parse(qrResult);
document.getElementById('qr-image').src = `data:image/png;base64,${qr.image_base64}`;

// Hash national ID for privacy
const idHash = hash_national_id("NIN-12345678901", "nigeria");
console.log("ID Hash:", idHash);

// Generate new MediChain Health ID
const healthId = generate_health_id();
console.log("Generated:", healthId); // MCHI-2026-XXXX-XXXX
```

## 🔒 Security Notes

1. **Key Derivation**: Uses SHA-256 with salt for WASM size optimization. Production systems should upgrade to Argon2id.

2. **Encryption**: ChaCha20-Poly1305 is an AEAD cipher providing both confidentiality and authenticity.

3. **National ID Hashing**: Uses domain separation to prevent rainbow table attacks.

4. **Random Numbers**: Uses browser's `crypto.getRandomValues()` via `getrandom` crate.

## 📊 Bundle Size

| Build Type | Size (gzipped) |
|------------|----------------|
| Release    | ~150 KB        |
| Debug      | ~800 KB        |

## 🧪 Testing

```bash
# Run Rust tests
cargo test

# Run WASM tests in browser
wasm-pack test --headless --chrome
```

## 📄 License

MIT © 2025 Trustware
