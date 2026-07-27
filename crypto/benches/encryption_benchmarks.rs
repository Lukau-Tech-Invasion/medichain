//! Hot-path benchmarks for `medichain-crypto` (Phase 12.1).
//!
//! `cargo flamegraph` and `samply` (its cross-platform alternative) both need
//! an OS-level sampling backend this environment doesn't have (`perf`/`dtrace`
//! for the former, the Windows ADK's `xperf` for the latter — see
//! IMPLEMENTATION_PLAN.md 12.1 for what was actually tried). `criterion` needs
//! none of that: it measures wall-clock time of a specific call directly, which
//! is exactly what "identify hot paths" means for this crate — every patient
//! record, IPFS document, and MFA secret goes through `encrypt`/`decrypt`.
//!
//! Run: `cargo bench -p medichain-crypto`

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use medichain_crypto::{sha256, EncryptionKey};

/// Payload sizes chosen to bracket real record shapes: a single vital-signs
/// reading (~100 B), a full patient profile blob (~5 KB, matches the
/// `profile_extras_encrypted` column added in Round 7), and a scanned
/// document / lab report page (~500 KB, the IPFS upload path).
const PAYLOAD_SIZES: &[(&str, usize)] = &[
    ("vital_signs_100B", 100),
    ("patient_profile_5KB", 5 * 1024),
    ("document_page_500KB", 500 * 1024),
];

fn bench_encrypt(c: &mut Criterion) {
    let key = EncryptionKey::generate().expect("key generation");
    let mut group = c.benchmark_group("encrypt");
    for (label, size) in PAYLOAD_SIZES {
        let plaintext = vec![0x42u8; *size];
        group.throughput(criterion::Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(label), &plaintext, |b, pt| {
            b.iter(|| medichain_crypto::encrypt(black_box(&key), black_box(pt)).unwrap());
        });
    }
    group.finish();
}

fn bench_decrypt(c: &mut Criterion) {
    let key = EncryptionKey::generate().expect("key generation");
    let mut group = c.benchmark_group("decrypt");
    for (label, size) in PAYLOAD_SIZES {
        let plaintext = vec![0x42u8; *size];
        let encrypted = medichain_crypto::encrypt(&key, &plaintext).expect("encrypt for setup");
        group.throughput(criterion::Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(label), &encrypted, |b, ct| {
            b.iter(|| medichain_crypto::decrypt(black_box(&key), black_box(ct)).unwrap());
        });
    }
    group.finish();
}

/// Argon2id key derivation (`derive_from_password`) is deliberately slow —
/// this benchmark exists to record its actual cost, not to find a way to
/// speed it up (speeding up a memory-hard KDF on purpose would weaken it).
fn bench_key_derivation(c: &mut Criterion) {
    let salt = medichain_crypto::generate_salt().expect("salt generation");
    c.bench_function("derive_from_password_argon2id", |b| {
        b.iter(|| {
            EncryptionKey::derive_from_password(black_box(b"correct horse battery staple"), &salt)
                .unwrap()
        });
    });
}

fn bench_sha256(c: &mut Criterion) {
    let mut group = c.benchmark_group("sha256");
    for (label, size) in PAYLOAD_SIZES {
        let data = vec![0x24u8; *size];
        group.throughput(criterion::Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(label), &data, |b, d| {
            b.iter(|| sha256(black_box(d)));
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_encrypt,
    bench_decrypt,
    bench_key_derivation,
    bench_sha256
);
criterion_main!(benches);
