use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct YomemoConfig {
    pub api_key: String,
    pub pem_path: String,
}
