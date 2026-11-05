use crate::db::SharedDb;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub db: SharedDb,
    pub data_dir: PathBuf,
    pub http: reqwest::Client,
    pub zotero_base: String,
    pub jobs: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl AppState {
    pub fn zotero(&self) -> crate::zotero::ZoteroClient {
        crate::zotero::ZoteroClient::new(self.http.clone(), &self.zotero_base)
    }
}
