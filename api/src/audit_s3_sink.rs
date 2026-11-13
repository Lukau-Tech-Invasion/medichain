//! An Amazon S3 checkpoint sink: one object per sealed batch, written once.
//!
//! The filesystem sink proves only what the database's own host did not later
//! rewrite. This one writes each checkpoint to a bucket the API's host cannot
//! rewrite: the bucket is created with S3 Object Lock in compliance mode
//! (`infra/aws/`), so an object, once written, cannot be replaced or deleted
//! for the retention period, by anyone, including the account root.
//!
//! The same contract as every sink: never replace a different checkpoint, and
//! accept the same bytes again as a no-op. A `PutObject` carries
//! `If-None-Match: *`, so S3 refuses to write over an existing key with
//! `412 Precondition Failed`; the sink then reads the stored object and
//! compares it, answering "same" or `Conflict`. Object Lock requires an
//! integrity header on every upload, so the request carries
//! `x-amz-checksum-sha256` with `x-amz-sdk-checksum-algorithm: SHA256`.
//!
//! Requests are signed with AWS Signature Version 4, written here rather than
//! through the AWS SDK: two calls do not justify a second TLS stack and the
//! SDK's build requirements. The signing code is checked against the worked
//! examples in the S3 documentation ("Signature Calculations for the
//! Authorization Header: Transferring Payload in a Single Chunk").
//!
//! Credentials come from the environment (`AWS_ACCESS_KEY_ID`,
//! `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`) or, on EC2, from the
//! instance role through IMDSv2. The container talks to IMDS through the
//! instance, so the launch template sets the metadata hop limit to 2.

use async_trait::async_trait;
use base64::Engine;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::audit_seal::{CheckpointSink, SinkError, SinkKind};

type HmacSha256 = Hmac<Sha256>;

/// Environment variable naming the bucket.
pub const BUCKET_VAR: &str = "AUDIT_CHECKPOINT_S3_BUCKET";
/// Environment variable naming the bucket's region.
pub const REGION_VAR: &str = "AUDIT_CHECKPOINT_S3_REGION";
/// Optional key prefix inside the bucket.
pub const PREFIX_VAR: &str = "AUDIT_CHECKPOINT_S3_PREFIX";
/// Optional endpoint override, for a test server.
pub const ENDPOINT_VAR: &str = "AUDIT_CHECKPOINT_S3_ENDPOINT";

const IMDS: &str = "http://169.254.169.254";
/// Refresh role credentials this long before they expire.
const REFRESH_MARGIN_SECS: i64 = 300;
/// The longest a stored checkpoint can be; a batch file is a few kilobytes.
const MAX_CHECKPOINT_BYTES: usize = 1 << 20;

/// One set of AWS credentials.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    /// When temporary credentials stop working; `None` for long-lived keys.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Where credentials come from.
enum CredentialSource {
    Static(Credentials),
    InstanceRole(Mutex<Option<Credentials>>),
}

/// A sink writing `<prefix><batch_id>.json` objects to one bucket.
pub struct S3Sink {
    bucket: String,
    region: String,
    prefix: String,
    /// `https://<bucket>.s3.<region>.amazonaws.com`, or a test server.
    endpoint: String,
    /// The `Host` the signature covers.
    host: String,
    client: reqwest::Client,
    credentials: CredentialSource,
}

impl S3Sink {
    /// A sink from the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let value = |name: &str| lookup(name).filter(|text| !text.trim().is_empty());
        let bucket = value(BUCKET_VAR)
            .ok_or_else(|| format!("{BUCKET_VAR} is required with the s3 sink"))?;
        let region = value(REGION_VAR)
            .or_else(|| value("AWS_REGION"))
            .ok_or_else(|| format!("{REGION_VAR} (or AWS_REGION) is required with the s3 sink"))?;
        let prefix = value(PREFIX_VAR).unwrap_or_default();
        if !bucket
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
        {
            return Err(format!("{BUCKET_VAR} is not a valid bucket name"));
        }
        let credentials = match (value("AWS_ACCESS_KEY_ID"), value("AWS_SECRET_ACCESS_KEY")) {
            (Some(access_key_id), Some(secret_access_key)) => {
                CredentialSource::Static(Credentials {
                    access_key_id,
                    secret_access_key,
                    session_token: value("AWS_SESSION_TOKEN"),
                    expires_at: None,
                })
            }
            _ => CredentialSource::InstanceRole(Mutex::new(None)),
        };
        let (endpoint, host) = match value(ENDPOINT_VAR) {
            Some(endpoint) => {
                let host = reqwest::Url::parse(&endpoint)
                    .ok()
                    .and_then(|url| {
                        url.host_str().map(|h| match url.port() {
                            Some(port) => format!("{h}:{port}"),
                            None => h.to_string(),
                        })
                    })
                    .ok_or_else(|| format!("{ENDPOINT_VAR} is not a URL"))?;
                (endpoint.trim_end_matches('/').to_string(), host)
            }
            None => {
                let host = format!("{bucket}.s3.{region}.amazonaws.com");
                (format!("https://{host}"), host)
            }
        };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| format!("cannot build the S3 client: {error}"))?;
        Ok(Self {
            bucket,
            region,
            prefix,
            endpoint,
            host,
            client,
            credentials,
        })
    }

    /// The object key of a batch's checkpoint.
    fn key(&self, batch_id: i64) -> String {
        format!("{}{batch_id}.json", self.prefix)
    }

    /// Current credentials, refreshing instance-role ones before they expire.
    async fn credentials(&self) -> Result<Credentials, SinkError> {
        match &self.credentials {
            CredentialSource::Static(credentials) => Ok(credentials.clone()),
            CredentialSource::InstanceRole(cache) => {
                let mut held = cache.lock().await;
                let fresh = held.as_ref().is_some_and(|c| {
                    c.expires_at.is_none_or(|at| {
                        at - chrono::Duration::seconds(REFRESH_MARGIN_SECS) > Utc::now()
                    })
                });
                if !fresh {
                    *held = Some(instance_role_credentials(&self.client).await?);
                }
                held.clone()
                    .ok_or_else(|| SinkError::Io("no instance-role credentials".into()))
            }
        }
    }

    /// Send one signed request for `key`.
    async fn send(
        &self,
        method: reqwest::Method,
        key: &str,
        body: &[u8],
        extra: &[(&str, String)],
    ) -> Result<reqwest::Response, SinkError> {
        let credentials = self.credentials().await?;
        let now = Utc::now();
        let path = format!("/{}", uri_encode(key, false));
        let payload_hash = hex::encode(Sha256::digest(body));
        let mut headers: Vec<(String, String)> = vec![
            ("host".into(), self.host.clone()),
            ("x-amz-content-sha256".into(), payload_hash.clone()),
            (
                "x-amz-date".into(),
                now.format("%Y%m%dT%H%M%SZ").to_string(),
            ),
        ];
        if let Some(token) = &credentials.session_token {
            headers.push(("x-amz-security-token".into(), token.clone()));
        }
        for (name, value) in extra {
            headers.push((name.to_ascii_lowercase(), value.clone()));
        }
        let authorization = authorization(&Signing {
            method: method.as_str(),
            path: &path,
            query: "",
            headers: &headers,
            payload_hash: &payload_hash,
            region: &self.region,
            service: "s3",
            at: now,
            credentials: &credentials,
        });
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.endpoint))
            .header("authorization", authorization);
        for (name, value) in &headers {
            if name != "host" {
                request = request.header(name.as_str(), value.as_str());
            }
        }
        request
            .body(body.to_vec())
            .send()
            .await
            .map_err(|error| SinkError::Io(format!("S3 request failed: {error}")))
    }

    /// Compare the stored object with `body`.
    async fn same_or_conflict(&self, key: &str, body: &[u8]) -> Result<String, SinkError> {
        let response = self.send(reqwest::Method::GET, key, &[], &[]).await?;
        if !response.status().is_success() {
            return Err(SinkError::Io(format!(
                "reading back {key}: HTTP {}",
                response.status()
            )));
        }
        let stored = response
            .bytes()
            .await
            .map_err(|error| SinkError::Io(format!("reading back {key}: {error}")))?;
        if stored.len() > MAX_CHECKPOINT_BYTES {
            return Err(SinkError::Conflict(self.reference(key)));
        }
        if stored.as_ref() == body {
            Ok(self.reference(key))
        } else {
            Err(SinkError::Conflict(self.reference(key)))
        }
    }

    fn reference(&self, key: &str) -> String {
        format!("s3://{}/{key}", self.bucket)
    }
}

#[async_trait]
impl CheckpointSink for S3Sink {
    fn kind(&self) -> SinkKind {
        SinkKind::S3
    }

    async fn put(&self, batch_id: i64, body: &[u8]) -> Result<String, SinkError> {
        let key = self.key(batch_id);
        let checksum = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body));
        let extra = [
            ("content-type", "application/json".to_string()),
            ("if-none-match", "*".to_string()),
            ("x-amz-checksum-sha256", checksum),
            ("x-amz-sdk-checksum-algorithm", "SHA256".to_string()),
        ];
        // Two attempts: S3 answers 409 when a conditional write races another
        // request on the same key, and documents the PUT as safe to retry.
        for attempt in 0..2 {
            let response = self.send(reqwest::Method::PUT, &key, body, &extra).await?;
            match response.status().as_u16() {
                200 => return Ok(self.reference(&key)),
                412 => return self.same_or_conflict(&key, body).await,
                409 if attempt == 0 => continue,
                status => {
                    let detail = response.text().await.unwrap_or_default();
                    let detail: String = detail.chars().take(300).collect();
                    return Err(SinkError::Io(format!(
                        "writing {key}: HTTP {status} {detail}"
                    )));
                }
            }
        }
        Err(SinkError::Io(format!(
            "writing {key}: conflicting concurrent writes"
        )))
    }
}

/// Temporary credentials for the instance's role, through IMDSv2.
async fn instance_role_credentials(client: &reqwest::Client) -> Result<Credentials, SinkError> {
    let fail =
        |what: &str, detail: String| SinkError::Io(format!("instance metadata {what}: {detail}"));
    let token = client
        .put(format!("{IMDS}/latest/api/token"))
        .header("x-aws-ec2-metadata-token-ttl-seconds", "21600")
        .send()
        .await
        .map_err(|e| fail("token", e.to_string()))?
        .error_for_status()
        .map_err(|e| fail("token", e.to_string()))?
        .text()
        .await
        .map_err(|e| fail("token", e.to_string()))?;
    let get = |path: String| {
        client
            .get(format!("{IMDS}{path}"))
            .header("x-aws-ec2-metadata-token", token.clone())
            .send()
    };
    let role = get("/latest/meta-data/iam/security-credentials/".into())
        .await
        .map_err(|e| fail("role", e.to_string()))?
        .error_for_status()
        .map_err(|e| fail("role (is an instance role attached?)", e.to_string()))?
        .text()
        .await
        .map_err(|e| fail("role", e.to_string()))?;
    let role = role.lines().next().unwrap_or_default().trim().to_string();
    if role.is_empty() {
        return Err(fail("role", "no instance role is attached".into()));
    }
    let document: serde_json::Value =
        get(format!("/latest/meta-data/iam/security-credentials/{role}"))
            .await
            .map_err(|e| fail("credentials", e.to_string()))?
            .error_for_status()
            .map_err(|e| fail("credentials", e.to_string()))?
            .json()
            .await
            .map_err(|e| fail("credentials", e.to_string()))?;
    let field = |name: &str| {
        document
            .get(name)
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    Ok(Credentials {
        access_key_id: field("AccessKeyId")
            .ok_or_else(|| fail("credentials", "no AccessKeyId".into()))?,
        secret_access_key: field("SecretAccessKey")
            .ok_or_else(|| fail("credentials", "no SecretAccessKey".into()))?,
        session_token: field("Token"),
        expires_at: field("Expiration")
            .and_then(|at| DateTime::parse_from_rfc3339(&at).ok())
            .map(|at| at.with_timezone(&Utc)),
    })
}

/// URI-encode every byte except the unreserved characters, as SigV4 requires;
/// `/` is kept when `encode_slash` is false (object keys).
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        let unreserved = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if unreserved || (byte == b'/' && !encode_slash) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// What a SigV4 signature covers.
struct Signing<'a> {
    method: &'a str,
    path: &'a str,
    query: &'a str,
    /// Lowercase names; every one is signed.
    headers: &'a [(String, String)],
    payload_hash: &'a str,
    region: &'a str,
    service: &'a str,
    at: DateTime<Utc>,
    credentials: &'a Credentials,
}

/// The `Authorization` header value for a request.
fn authorization(signing: &Signing<'_>) -> String {
    let mut headers: Vec<(String, String)> = signing
        .headers
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    headers.sort();
    let canonical_headers: String = headers.iter().map(|(n, v)| format!("{n}:{v}\n")).collect();
    let signed_headers = headers
        .iter()
        .map(|(n, _)| n.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        signing.method,
        signing.path,
        signing.query,
        canonical_headers,
        signed_headers,
        signing.payload_hash
    );
    let date = signing.at.format("%Y%m%d").to_string();
    let scope = format!("{date}/{}/{}/aws4_request", signing.region, signing.service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{scope}\n{}",
        signing.at.format("%Y%m%dT%H%M%SZ"),
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let key = [
        date.as_str(),
        signing.region,
        signing.service,
        "aws4_request",
    ]
    .iter()
    .fold(
        format!("AWS4{}", signing.credentials.secret_access_key).into_bytes(),
        |key, part| hmac(&key, part.as_bytes()),
    );
    let signature = hex::encode(hmac(&key, string_to_sign.as_bytes()));
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope},SignedHeaders={signed_headers},Signature={signature}",
        signing.credentials.access_key_id
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn example_credentials() -> Credentials {
        Credentials {
            access_key_id: "AKIAIOSFODNN7EXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".into(),
            session_token: None,
            expires_at: None,
        }
    }

    fn at() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2013, 5, 24, 0, 0, 0).unwrap()
    }

    /// The S3 documentation's "Example: GET Object" signature.
    #[test]
    fn signs_the_documented_get_object_example() {
        let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let headers = vec![
            (
                "host".to_string(),
                "examplebucket.s3.amazonaws.com".to_string(),
            ),
            ("range".to_string(), "bytes=0-9".to_string()),
            ("x-amz-content-sha256".to_string(), empty.to_string()),
            ("x-amz-date".to_string(), "20130524T000000Z".to_string()),
        ];
        let credentials = example_credentials();
        let header = authorization(&Signing {
            method: "GET",
            path: "/test.txt",
            query: "",
            headers: &headers,
            payload_hash: empty,
            region: "us-east-1",
            service: "s3",
            at: at(),
            credentials: &credentials,
        });
        assert_eq!(
            header,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,\
             SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,\
             Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    /// The S3 documentation's "Example: PUT Object" signature, including the
    /// encoding of `$` in the key.
    #[test]
    fn signs_the_documented_put_object_example() {
        let body = b"Welcome to Amazon S3.";
        let hash = hex::encode(Sha256::digest(body));
        assert_eq!(
            hash,
            "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
        );
        let headers = vec![
            (
                "date".to_string(),
                "Fri, 24 May 2013 00:00:00 GMT".to_string(),
            ),
            (
                "host".to_string(),
                "examplebucket.s3.amazonaws.com".to_string(),
            ),
            ("x-amz-content-sha256".to_string(), hash.clone()),
            ("x-amz-date".to_string(), "20130524T000000Z".to_string()),
            (
                "x-amz-storage-class".to_string(),
                "REDUCED_REDUNDANCY".to_string(),
            ),
        ];
        let credentials = example_credentials();
        let path = format!("/{}", uri_encode("test$file.text", false));
        assert_eq!(path, "/test%24file.text");
        let header = authorization(&Signing {
            method: "PUT",
            path: &path,
            query: "",
            headers: &headers,
            payload_hash: &hash,
            region: "us-east-1",
            service: "s3",
            at: at(),
            credentials: &credentials,
        });
        assert!(
            header.ends_with(
                "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
            ),
            "{header}"
        );
    }

    #[test]
    fn keeps_slashes_in_keys_and_encodes_everything_reserved() {
        assert_eq!(uri_encode("audit/12 3.json", false), "audit/12%203.json");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
    }

    #[test]
    fn refuses_a_configuration_without_bucket_or_region() {
        let none = |_: &str| None;
        assert!(S3Sink::from_lookup(none).is_err());
        let bucket_only = |name: &str| (name == BUCKET_VAR).then(|| "audit-bucket".to_string());
        assert!(S3Sink::from_lookup(bucket_only).is_err());
        let bad = |name: &str| match name {
            BUCKET_VAR => Some("Not_A_Bucket".to_string()),
            REGION_VAR => Some("af-south-1".to_string()),
            _ => None,
        };
        assert!(S3Sink::from_lookup(bad).is_err());
    }

    /// Against a stand-in for S3: written once, the same bytes again are a
    /// no-op, different bytes under the same key are a conflict and change
    /// nothing, and every PUT carries the conditional and integrity headers.
    #[actix_web::test]
    async fn writes_once_accepts_a_repeat_and_refuses_a_rewrite() {
        use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex as StdMutex};

        type Store = Arc<StdMutex<HashMap<String, Vec<u8>>>>;
        let store: Store = Arc::new(StdMutex::new(HashMap::new()));
        let shared = store.clone();
        let server = HttpServer::new(move || {
            let store = shared.clone();
            App::new()
                .app_data(web::Data::new(store))
                .default_service(web::to(
                    |req: HttpRequest, body: web::Bytes, store: web::Data<Store>| async move {
                        let auth = req
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("");
                        if !auth.starts_with("AWS4-HMAC-SHA256 Credential=AKIDTEST/") {
                            return HttpResponse::Forbidden().finish();
                        }
                        let key = req.path().trim_start_matches('/').to_string();
                        let mut objects = store.lock().unwrap();
                        match req.method().as_str() {
                            "PUT" => {
                                let conditional =
                                    req.headers().get("if-none-match").is_some_and(|v| v == "*");
                                let checksum = req.headers().get("x-amz-checksum-sha256").is_some();
                                if !conditional || !checksum {
                                    return HttpResponse::BadRequest().finish();
                                }
                                if objects.contains_key(&key) {
                                    return HttpResponse::PreconditionFailed().finish();
                                }
                                objects.insert(key, body.to_vec());
                                HttpResponse::Ok().finish()
                            }
                            "GET" => match objects.get(&key) {
                                Some(stored) => HttpResponse::Ok().body(stored.clone()),
                                None => HttpResponse::NotFound().finish(),
                            },
                            _ => HttpResponse::MethodNotAllowed().finish(),
                        }
                    },
                ))
        })
        .bind(("127.0.0.1", 0))
        .unwrap();
        let address = server.addrs()[0];
        let running = server.run();
        let handle = running.handle();
        tokio::spawn(running);

        let endpoint = format!("http://{address}");
        let sink = S3Sink::from_lookup(|name| match name {
            BUCKET_VAR => Some("audit-test".into()),
            REGION_VAR => Some("af-south-1".into()),
            PREFIX_VAR => Some("checkpoints/".into()),
            ENDPOINT_VAR => Some(endpoint.clone()),
            "AWS_ACCESS_KEY_ID" => Some("AKIDTEST".into()),
            "AWS_SECRET_ACCESS_KEY" => Some("secret".into()),
            _ => None,
        })
        .unwrap();

        assert_eq!(
            sink.put(7, b"{\"batch\":7}").await.unwrap(),
            "s3://audit-test/checkpoints/7.json"
        );
        assert!(
            sink.put(7, b"{\"batch\":7}").await.is_ok(),
            "the same bytes again must be a no-op"
        );
        assert!(matches!(
            sink.put(7, b"{\"batch\":\"forged\"}").await,
            Err(SinkError::Conflict(_))
        ));
        assert_eq!(
            store.lock().unwrap().get("checkpoints/7.json").unwrap(),
            b"{\"batch\":7}"
        );
        handle.stop(true).await;
    }
}
