use crate::yomemo::{config::YomemoConfig, crypto};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const YOMEMO_API_BASE_URL: &str = "https://api.yomemo.ai/api/v1";

#[derive(Error, Debug)]
pub enum ClientError {
    #[error("Request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Crypto operation failed: {0}")]
    Crypto(#[from] crypto::CryptoError),
    #[error("API error (status {status}): {message}")]
    Api { message: String, status: u16 },
    #[error("JSON operation failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Failed to decode /me response: {raw_preview}")]
    MeDecode { raw_preview: String },
}

/// Request body for POST /memory. Matches onyx: handle, ciphertext, description, idempotent_key, metadata.
#[derive(Serialize)]
struct UpdateMemoryRequest {
    handle: String,
    #[serde(rename = "ciphertext")]
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotent_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(Deserialize, Debug)]
struct ApiResponse<T> {
    data: T,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct MemoryCreateResponse {
    #[serde(default)]
    idempotent_key: Option<String>,
    #[serde(default)]
    memory_id: Option<String>,
    #[serde(default)]
    action: String,
}

#[derive(Deserialize, Debug)]
struct MemoryResponse {
    handle: String,
    content: String, // This will be the encrypted content
    owner: String,
    created_at: String,
    updated_at: String,
}

/// Raw /me API response. API returns: api_key, avatar_url, email, created_at, max_memory_mb, plan, etc.
#[derive(Deserialize, Debug)]
struct MeResponseRaw {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    avatar_url: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    plan: String,
    #[serde(default)]
    plan_type: String,
    #[serde(default)]
    is_pro: bool,
}

/// User info from YoMemo /me API.
#[derive(Debug, Clone)]
pub struct MeResponse {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar: String,
    /// Pro status; derived from plan, plan_type, or is_pro
    pub pro: bool,
}

impl From<MeResponseRaw> for MeResponse {
    fn from(r: MeResponseRaw) -> Self {
        let pro = r.is_pro
            || r.plan.to_lowercase() == "pro"
            || r.plan_type.to_lowercase() == "pro";
        Self {
            id: r.api_key,
            email: r.email,
            name: r.name,
            avatar: r.avatar_url,
            pro,
        }
    }
}

pub struct YomemoClient {
    config: YomemoConfig,
    http_client: reqwest::Client,
}

impl YomemoClient {
    pub fn new(config: YomemoConfig) -> Self {
        Self {
            config,
            http_client: reqwest::Client::new(),
        }
    }

    /// Fetches user information to validate the API key.
    pub async fn me(&self) -> Result<MeResponse, ClientError> {
        let url = format!("{}/me", YOMEMO_API_BASE_URL);
        let resp = self
            .http_client
            .get(&url)
            .header("X-Memo-API-Key", &self.config.api_key)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(ClientError::Api {
                message: resp.text().await.unwrap_or_default(),
                status: status.as_u16(),
            });
        }

        let text = resp.text().await?;
        // Try { data: {...} } first, then direct {...}
        if let Ok(wrapped) = serde_json::from_str::<ApiResponse<MeResponseRaw>>(&text) {
            return Ok(wrapped.data.into());
        }
        if let Ok(direct) = serde_json::from_str::<MeResponseRaw>(&text) {
            return Ok(direct.into());
        }
        let preview: String = text.chars().take(300).collect();
        Err(ClientError::MeDecode {
            raw_preview: preview,
        })
    }

    /// Fetches and decrypts a memory by its handle.
    pub async fn get_memory(&self, handle: &str) -> Result<String, ClientError> {
        let url = format!("{}/memory?handle={}", YOMEMO_API_BASE_URL, handle);
        let resp = self
            .http_client
            .get(&url)
            .header("X-Memo-API-Key", &self.config.api_key)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            return Err(ClientError::Api {
                message: resp.text().await.unwrap_or_default(),
                status: status.as_u16(),
            });
        }

        let body: ApiResponse<MemoryResponse> = resp.json().await?;
        let decrypted_content = crypto::decrypt(&body.data.content, &self.config.pem_path)?;

        Ok(decrypted_content)
    }

    /// Creates or updates a memory with the given handle and content.
    /// First call: omit idempotent_key → API creates and returns it.
    /// Subsequent: pass stored idempotent_key for upsert.
    /// API ref: https://doc.yomemo.ai/api/reference/
    /// Returns idempotent_key from response (for persistence).
    pub async fn update_memory(
        &self,
        handle: String,
        content: String,
        idempotent_key: Option<String>,
    ) -> Result<Option<String>, ClientError> {
        // 1. Encrypt the content
        let encrypted_content = crypto::encrypt(&content, &self.config.pem_path)?;

        // Debug: print request for troubleshooting "Failed to ensure handle"
        // API ref: https://doc.yomemo.ai/api/reference/
        eprintln!(
            "[YoMemo] POST {}/memory | handle={:?} idempotent_key={:?} ciphertext_len={} body_keys=[handle,ciphertext,idempotent_key]",
            YOMEMO_API_BASE_URL,
            handle,
            idempotent_key,
            encrypted_content.len()
        );

        // 2. Prepare the request body (ref: onyx yomemoProvider.ts)
        let request_body = UpdateMemoryRequest {
            handle: handle.clone(),
            content: encrypted_content,
            description: Some(format!("Smart Clip {}", handle)),
            idempotent_key,
            metadata: Some(std::collections::HashMap::from([(
                "from".to_string(),
                "smart-clip".to_string(),
            )])),
        };
        let body_json = serde_json::to_string(&request_body)?;

        // 3. Make the POST request
        let url = format!("{}/memory", YOMEMO_API_BASE_URL);
        let resp = self
            .http_client
            .post(&url)
            .header("X-Memo-API-Key", &self.config.api_key)
            .header("Content-Type", "application/json")
            .body(body_json)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            eprintln!("[YoMemo] API error {}: {}", status, text);
            return Err(ClientError::Api {
                message: text,
                status: status.as_u16(),
            });
        }
        let idempotent_key_returned = serde_json::from_str::<MemoryCreateResponse>(&text)
            .ok()
            .and_then(|r| r.idempotent_key);
        Ok(idempotent_key_returned)
    }
}
