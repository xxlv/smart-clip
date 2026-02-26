# Yomemo.ai Sync Integration Plan

This document outlines the plan to integrate `yomemo.ai` automatic synchronization into the `smart-clip` application.

## 1. Overview

The integration will enable `smart-clip` to sync data with the `yomemo.ai` service. This will be achieved by implementing a client in the Rust backend (Tauri) that conforms to the specified `yomemo.ai` cryptographic and API protocols.

## 2. Project Structure Changes

All new backend logic will be housed within the `src-tauri/src` directory.

-   **`src-tauri/src/yomemo/`**: A new module to contain all logic related to `yomemo.ai` integration.
    -   **`src-tauri/src/yomemo/mod.rs`**: Module declaration.
    -   **`src-tauri/src/yomemo/config.rs`**: Structs and functions for managing `yomemo.ai` configuration (API key, PEM file path).
    -   **`src-tauri/src/yomemo/crypto.rs`**: Implementation of the encryption/decryption logic as per `YOMEMO-CRYPTO-ALGORITHM.md`.
    -   **`src-tauri/src/yomemo/client.rs`**: A client for making API requests to `yomemo.ai`, using the logic from `crypto.rs` to sign and encrypt data.
    -   **`src-tauri/src/yomemo/sync.rs`**: The core synchronization logic (e.g., checking for updates, pushing new data).

The main application file will be updated to integrate this module:
-   **`src-tauri/src/lib.rs`**: Initializes the `yomemo` module and exposes Tauri commands.

## 2.5 Handle Design for Data Isolation

To ensure that data from `smart-clip` does not conflict with other applications using the same `yomemo.ai` account, a strict handle naming convention will be enforced.

All handles use the prefix `smart-clip-` and hyphens as separators (not colons):

**`smart-clip-ws-<workspace_id>`**

-   **Prefix (`smart-clip-`):** Static namespace isolating all data from this application.
-   **Workspace mapping (one workspace = one handle):**
    -   Workspace with id `1` → handle `smart-clip-ws-1`
    -   Workspace with id `2` → handle `smart-clip-ws-2`
-   **Content:** JSON array of clips for that workspace.

This approach guarantees data isolation and simplifies data management.

## 3. Rust Dependencies (`Cargo.toml`)

The following crates will be added to `src-tauri/Cargo.toml` to support the implementation:

-   `rsa`: For RSA-OAEP encryption/decryption and PKCS#1v15 signing/verification.
-   `aes-gcm`: For AES-GCM encryption/decryption.
-   `sha2`: For SHA-256 hashing.
-   `rand`: For generating the random AES key and nonce.
-   `serde` & `serde_json`: For JSON serialization/deserialization.
-   `base64`: For Base64 encoding/decoding.
-   `reqwest`: For making HTTP requests to the `yomemo.ai` API.
-   `tokio`: For asynchronous operations, especially for `reqwest`.
-   `thiserror`: For structured error handling.

## 4. Implementation Steps

### Step 4.1: Configuration Management (`config.rs`)
-   Define a `YomemoConfig` struct to hold the API key and PEM private key.
-   Implement a function to load this configuration, for instance from a local file or from the frontend. For security, these credentials should not be hardcoded. We will need a new Tauri command for the frontend to pass this configuration.

### Step 4.2: Cryptography (`crypto.rs`)
-   Implement the `pack_data` / `encrypt` function:
    1.  Generate a 32-byte AES key and a 12-byte nonce.
    2.  Encrypt the plaintext data using `aes-gcm`.
    3.  Encrypt the AES key using `rsa::RsaPrivateKey::encrypt` with `rsa::Oaep`. The hashing function for OAEP will be SHA-256.
    4.  Sign the Base64-encoded `(nonce + ciphertext + tag)` using `rsa::RsaPrivateKey::sign` with `rsa::pkcs1v15::SigningKey` and the `sha2::Sha256` hash.
    5.  Construct the final JSON payload and Base64-encode it.
-   Implement the `unpack_and_decrypt` / `decrypt` function:
    1.  Base64-decode and parse the JSON payload.
    2.  Decrypt the AES key from `pkg.key` using `rsa::RsaPrivateKey::decrypt`.
    3.  Decode the `pkg.data` and extract the nonce, ciphertext, and tag.
    4.  Decrypt the ciphertext using `aes-gcm`.

### Step 4.3: API Client (`client.rs`)
-   Create a `YomemoClient` struct that holds the configuration and an HTTP client (`reqwest::Client`).
-   Implement methods for interacting with the `yomemo.ai` API (e.g., `get_data`, `update_data`).
-   These methods will use the `crypto.rs` functions to handle request/response body encryption and decryption.

### Step 4.4: Sync Logic & Tauri Commands (`sync.rs` & `lib.rs`)
-   Define the core `synchronize` function that orchestrates the sync process.
-   Tauri commands exposed to the frontend:
    -   `configure_yomemo({ apiKey, pemPath })`: Receive and persist credentials to `config.json`.
    -   `trigger_yomemo_sync()`: Manually trigger sync.
    -   `get_yomemo_me()`: Fetch user info from `/me` (avatar, name, email, Pro).
    -   `get_yomemo_auto_sync()` / `set_yomemo_auto_sync(enabled)`: Auto-sync toggle (sync every 5 min when enabled).
    -   `get_yomemo_config()`: Return current YoMemo config for the frontend.

## 5. Frontend Integration

-   **Settings:** API Key and PEM file path input; call `invoke('configure_yomemo', { apiKey, pemPath })`.
-   **Sync:** Manual trigger via `invoke('trigger_yomemo_sync')`; auto-sync checkbox bound to `get_yomemo_auto_sync` / `set_yomemo_auto_sync` (interval: 5 min).
-   **Header avatar:** When YoMemo is configured, show avatar next to gear icon; hover tooltip with name, email, Pro status. Pro users get gold ring (`header-avatar-pro`).
-   **Avatar 429 handling:** Use `onError` fallback and `referrerPolicy="no-referrer"` for robustness.

## 6. API Notes (Implemented)

-   **`/me` endpoint**: Returns user info. Supports both `{ data: {...} }` and direct `{...}` response.
    -   Raw API fields: `api_key`, `avatar_url`, `email`, `name`, `plan`, `plan_type`, `is_pro`.
    -   Pro status: derived from `is_pro` or `plan`/`plan_type === "pro"`.
    -   Frontend receives: `id` (from api_key), `email`, `name`, `avatar` (from avatar_url), `pro`.
-   **`idempotent_key`**: First sync omits; API returns it. Subsequent syncs use stored key from `yomemo_workspace_keys` for upsert. See API Reference: `POST /api/v1/memory`.
-   **Request body**: `handle`, `ciphertext`, `description`, `idempotent_key`, `metadata` — ref: [onyx yomemoProvider.ts](../onyx/src/services/accountSync/yomemoProvider.ts)

## 7. Config (`config.json`)

-   `yomemo`: `{ api_key, pem_path }` — persisted YoMemo credentials.
-   `yomemo_workspace_keys`: `{ workspace_id: idempotent_key }` — per-workspace idempotent keys returned by API.
-   `yomemo_auto_sync`: `boolean` — enable/disable auto-sync (every 5 min).

---
This plan provides a high-level roadmap. This approach is based on the provided algorithm document and standard Rust practices for building such a feature in a Tauri application.
