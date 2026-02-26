use aes_gcm::{
    aead::{Aead, OsRng},
    AeadCore, Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rsa::{
    pkcs1v15,
    pkcs8::DecodePrivateKey,
    sha2::Sha256,
    signature::{SignatureEncoding, Signer, Verifier},
    Oaep, RsaPrivateKey, RsaPublicKey,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("File I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("RSA key parsing failed: {0}")]
    RsaKey(#[from] rsa::pkcs8::Error),
    #[error("RSA operation failed: {0}")]
    Rsa(#[from] rsa::Error),
    #[error("AES operation failed: {0}")]
    Aes(String),
    #[error("Base64 decoding failed: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("JSON operation failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Signature error: {0}")]
    Signature(#[from] rsa::signature::Error),
    #[error("Invalid signature")]
    InvalidSignature,
    #[error("Invalid data format: {0}")]
    InvalidFormat(String),
}

#[derive(Serialize)]
struct EncryptPkg {
    data: String,
    key: String,
    signature: String,
}

#[derive(Deserialize)]
struct DecryptPkg {
    data: String,
    key: String,
    #[serde(default)]
    signature: String,
}

/// Returns the RSA-OAEP padding scheme using SHA256 for both the main hash and MGF1.
fn get_oaep_padding() -> Oaep {
    Oaep::new::<Sha256>()
}

/// Encrypts data according to the Yomemo Crypto Algorithm.
/// Requires the private key to create the signature; the public key is derived from it.
pub fn encrypt(plaintext: &str, private_key_path: &str) -> Result<String, CryptoError> {
    // Read the private key from the given path
    let private_key_pem = std::fs::read_to_string(private_key_path)?;

    // 1. Parse private key and derive public key
    let private_key = RsaPrivateKey::from_pkcs8_pem(&private_key_pem)?;
    let public_key = RsaPublicKey::from(&private_key);

    // 2. Generate AES key and nonce
    let aes_key = Aes256Gcm::generate_key(&mut OsRng);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 12 bytes

    // 3. Encrypt data with AES-GCM
    let cipher = Aes256Gcm::new(&aes_key);
    let ciphertext_with_tag = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| CryptoError::Aes(e.to_string()))?;

    // 4. Combine nonce + ciphertext + tag and base64 encode
    let mut combined_aes_output = nonce.to_vec();
    combined_aes_output.extend_from_slice(&ciphertext_with_tag);
    let data_b64 = BASE64.encode(&combined_aes_output);

    // 5. Encrypt AES key with RSA-OAEP
    let padding = get_oaep_padding();
    let encrypted_aes_key = public_key.encrypt(&mut OsRng, padding, &aes_key)?;
    let key_b64 = BASE64.encode(&encrypted_aes_key);

    // 6. Sign the base64-encoded data using RSA-PKCS1v15-SHA256
    let signing_key = pkcs1v15::SigningKey::<Sha256>::new(private_key);
    let signature = signing_key.sign(data_b64.as_bytes());
    let signature_b64 = BASE64.encode(signature.to_bytes());

    // 7. Create final package, serialize to JSON, and Base64 encode
    let pkg = EncryptPkg {
        data: data_b64,
        key: key_b64,
        signature: signature_b64,
    };
    let json_pkg = serde_json::to_string(&pkg)?;

    Ok(BASE64.encode(json_pkg))
}

/// Decrypts data according to the Yomemo Crypto Algorithm.
pub fn decrypt(encrypted_pkg_b64: &str, private_key_path: &str) -> Result<String, CryptoError> {
    // Read the private key from the given path
    let private_key_pem = std::fs::read_to_string(private_key_path)?;

    // 1. Base64 decode and parse JSON package
    let json_pkg = BASE64.decode(encrypted_pkg_b64)?;
    let pkg: DecryptPkg = serde_json::from_slice(&json_pkg)?;

    // 2. Parse private key
    let private_key = RsaPrivateKey::from_pkcs8_pem(&private_key_pem)?;

    // 3. Verify signature if present
    if !pkg.signature.is_empty() {
        let public_key = RsaPublicKey::from(&private_key);
        let verifying_key = pkcs1v15::VerifyingKey::<Sha256>::new(public_key);
        let signature_bytes = BASE64.decode(&pkg.signature)?;
        let signature = pkcs1v15::Signature::try_from(signature_bytes.as_slice())
            .map_err(|e| CryptoError::InvalidFormat(e.to_string()))?;

        verifying_key
            .verify(pkg.data.as_bytes(), &signature)
            .map_err(|_| CryptoError::InvalidSignature)?;
    }

    // 4. Decrypt AES key with RSA-OAEP
    let padding = get_oaep_padding();
    let encrypted_aes_key = BASE64.decode(&pkg.key)?;
    let aes_key_bytes = private_key.decrypt(padding, &encrypted_aes_key)?;

    // 5. Decrypt data with AES-GCM
    let combined_aes_output = BASE64.decode(&pkg.data)?;
    // The nonce is defined as 12 bytes in the encryption spec and in AES-GCM standard usage.
    const NONCE_LEN: usize = 12;
    if combined_aes_output.len() < NONCE_LEN {
        return Err(CryptoError::InvalidFormat(
            "Data is too short for a nonce".to_string(),
        ));
    }
    let (nonce_bytes, ciphertext_with_tag) = combined_aes_output.split_at(NONCE_LEN);

    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher =
        Aes256Gcm::new_from_slice(&aes_key_bytes).map_err(|e| CryptoError::Aes(e.to_string()))?;

    let plaintext_bytes = cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|e| CryptoError::Aes(e.to_string()))?;

    String::from_utf8(plaintext_bytes)
        .map_err(|e| CryptoError::InvalidFormat(format!("Invalid UTF-8: {}", e)))
}
