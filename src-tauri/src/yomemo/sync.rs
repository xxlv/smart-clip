use crate::yomemo::{
    client::{ClientError, MeResponse, YomemoClient},
    config::YomemoConfig,
};
use thiserror::Error;

pub const HANDLE_PREFIX: &str = "smart-clip";

#[derive(Error, Debug)]
pub enum SyncError {
    #[error("Client error: {0}")]
    Client(#[from] ClientError),
}

/// Handle for a workspace: `smart-clip-ws-<id>`. One workspace = one handle.
pub fn workspace_handle(workspace_id: i64) -> String {
    format!("{}-ws-{}", HANDLE_PREFIX, workspace_id)
}

/// Performs a test synchronization by fetching user info to validate the API key.
pub async fn synchronize(config: &YomemoConfig) -> Result<MeResponse, SyncError> {
    println!("Starting yomemo.ai API key validation...");

    let client = YomemoClient::new(config.clone());

    let me_info = client.me().await?;

    println!("SUCCESS: API key is valid for user: {}", me_info.email);

    Ok(me_info)
}

/// Syncs a workspace's content to YoMemo. Uses handle `smart-clip-ws-<id>`.
/// First call: no idempotent_key → API creates and returns it.
/// Subsequent: pass stored idempotent_key for upsert.
/// Returns idempotent_key from API (for persistence).
pub async fn sync_workspace(
    config: &YomemoConfig,
    workspace_id: i64,
    content_json: String,
    stored_idempotent_key: Option<String>,
) -> Result<Option<String>, SyncError> {
    let client = YomemoClient::new(config.clone());
    let handle = workspace_handle(workspace_id);
    client
        .update_memory(handle, content_json, stored_idempotent_key)
        .await
        .map_err(SyncError::from)
}
