//! Sign an arbitrary message with a dev seed, for end-to-end auth verification.
//!
//! Exists so the browser/HTTP campaign can produce genuine sr25519 signatures
//! instead of stubbing them out -- a proof the server accepts a fake signature
//! would prove nothing about the server.
//!
//! Usage: cargo run --example sign_message -- "//Alice" "<message>"
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: sign_message <seed> <message>");
        std::process::exit(2);
    }
    use sp_core::crypto::Ss58Codec;
    use sp_core::Pair;
    let pair = sp_core::sr25519::Pair::from_string(&args[1], None).expect("valid seed");
    let signature = pair.sign(args[2].as_bytes());
    println!("{}", hex::encode(signature.0));
    eprintln!("wallet: {}", pair.public().to_ss58check());
}
