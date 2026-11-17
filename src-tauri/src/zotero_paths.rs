use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

const DATA_DIR_PREFERENCE: &str = "extensions.zotero.dataDir";
const BASE_ATTACHMENT_PREFERENCE: &str = "extensions.zotero.baseAttachmentPath";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ZoteroPreferences {
    data_dir: Option<PathBuf>,
    root_dir: Option<PathBuf>,
}

static DISCOVERED: OnceLock<ZoteroPreferences> = OnceLock::new();

/// Resolve the Zotero data directory. Explicit settings win, then Zotero's
/// profile preferences, then the standard `~/Zotero` location.
pub fn data_dir() -> Option<PathBuf> {
    configured_path("ZOTERO_DATA_DIR")
        .or_else(|| DISCOVERED.get_or_init(discover).data_dir.clone())
        .or_else(default_data_dir)
}

/// Resolve the linked-attachment base directory. This value has no reliable
/// fallback because it is only written when the user configures linked files.
pub fn root_dir() -> Option<PathBuf> {
    configured_path("ZOTERO_ROOT_DIR")
        .or_else(|| DISCOVERED.get_or_init(discover).root_dir.clone())
}

fn configured_path(name: &str) -> Option<PathBuf> {
    crate::environment::get(name)
        .map(|value| expand_home(value.trim()))
        .filter(|path| !path.as_os_str().is_empty())
}

fn default_data_dir() -> Option<PathBuf> {
    home_dir().map(|home| home.join("Zotero"))
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        roots.push(home.join("Library").join("Application Support").join("Zotero"));
        roots.push(home.join(".zotero").join("zotero"));
        roots.push(home.join(".mozilla").join("zotero"));
    }
    if let Some(appdata) = env::var_os("APPDATA") {
        let appdata = PathBuf::from(appdata);
        roots.push(appdata.join("Zotero").join("Zotero"));
        roots.push(appdata.join("Zotero"));
    }
    deduplicate(roots)
}

fn discover() -> ZoteroPreferences {
    discover_from_roots(&candidate_roots())
}

fn discover_from_roots(roots: &[PathBuf]) -> ZoteroPreferences {
    for root in roots {
        for profile_dir in profile_directories(root) {
            if let Some(preferences) = read_preferences(&profile_dir.join("prefs.js")) {
                return preferences;
            }
        }
    }
    ZoteroPreferences::default()
}

fn profile_directories(root: &Path) -> Vec<PathBuf> {
    let mut profiles = fs::read_to_string(root.join("profiles.ini"))
        .ok()
        .map(|text| profile_paths_from_ini(root, &text))
        .unwrap_or_default();
    profiles.extend(profile_directories_by_age(&root.join("Profiles")));
    deduplicate(profiles)
}

fn profile_paths_from_ini(root: &Path, source: &str) -> Vec<PathBuf> {
    let mut profiles = Vec::new();
    for section in source.split('[').skip(1) {
        let mut lines = section.lines();
        let Some(heading) = lines.next() else {
            continue;
        };
        if !heading.trim_start().starts_with("Profile") {
            continue;
        }
        let mut path = None;
        let mut relative = true;
        let mut default = false;
        for line in lines {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            match key.trim() {
                "Path" => path = Some(value.trim().to_string()),
                "IsRelative" => relative = value.trim() != "0",
                "Default" => default = value.trim() == "1",
                _ => {}
            }
        }
        if let Some(path) = path.filter(|path| !path.is_empty()) {
            let path = PathBuf::from(path);
            profiles.push((!default, if relative { root.join(path) } else { path }));
        }
    }
    profiles.sort_by_key(|(not_default, _)| *not_default);
    profiles.into_iter().map(|(_, path)| path).collect()
}

fn profile_directories_by_age(profiles: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(profiles) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let prefs = path.join("prefs.js");
        if prefs.is_file() {
            let modified = prefs
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok();
            found.push((modified, path));
        }
    }
    found.sort_by(|(left_time, left_path), (right_time, right_path)| {
        right_time
            .cmp(left_time)
            .then_with(|| left_path.cmp(right_path))
    });
    found.into_iter().map(|(_, path)| path).collect()
}

fn read_preferences(path: &Path) -> Option<ZoteroPreferences> {
    let source = fs::read_to_string(path).ok()?;
    Some(parse_preferences(&source))
}

fn parse_preferences(source: &str) -> ZoteroPreferences {
    ZoteroPreferences {
        data_dir: preference_path(source, DATA_DIR_PREFERENCE),
        root_dir: preference_path(source, BASE_ATTACHMENT_PREFERENCE),
    }
}

fn preference_path(source: &str, key: &str) -> Option<PathBuf> {
    let prefix = format!("user_pref(\"{key}\"");
    source.lines().find_map(|line| {
        let rest = line.trim().strip_prefix(&prefix)?.trim_start();
        let rest = rest.strip_prefix(',')?.trim_start();
        let literal = json_string_literal(rest)?;
        let value: String = serde_json::from_str(literal).ok()?;
        let value = value.trim();
        (!value.is_empty() && value != "false").then(|| expand_home(value))
    })
}

fn json_string_literal(value: &str) -> Option<&str> {
    if !value.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    for (index, character) in value.char_indices().skip(1) {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == '"' {
            return Some(&value[..=index]);
        }
    }
    None
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(relative) = value.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(relative);
        }
    }
    PathBuf::from(value)
}

fn deduplicate<T: PartialEq>(values: Vec<T>) -> Vec<T> {
    let mut unique = Vec::new();
    for value in values {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_zotero_paths_and_json_escapes() {
        let source = r#"
            user_pref("extensions.zotero.baseAttachmentPath", "/tmp/linked files");
            user_pref("extensions.zotero.dataDir", "C:\\Users\\Reader\\Zotero");
        "#;
        let preferences = parse_preferences(source);
        assert_eq!(
            preferences.data_dir,
            Some(PathBuf::from(r"C:\Users\Reader\Zotero"))
        );
        assert_eq!(
            preferences.root_dir,
            Some(PathBuf::from("/tmp/linked files"))
        );
    }

    #[test]
    fn uses_the_default_profile_from_profiles_ini() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("Profiles/default")).unwrap();
        fs::create_dir_all(root.join("Profiles/other")).unwrap();
        fs::write(
            root.join("profiles.ini"),
            "[Profile0]\nName=other\nIsRelative=1\nPath=Profiles/other\n\n[Profile1]\nName=default\nIsRelative=1\nPath=Profiles/default\nDefault=1\n",
        )
        .unwrap();
        fs::write(
            root.join("Profiles/default/prefs.js"),
            "user_pref(\"extensions.zotero.dataDir\", \"/tmp/default-zotero\");\nuser_pref(\"extensions.zotero.baseAttachmentPath\", \"/tmp/default-linked\");\n",
        )
        .unwrap();
        fs::write(
            root.join("Profiles/other/prefs.js"),
            "user_pref(\"extensions.zotero.dataDir\", \"/tmp/other-zotero\");\n",
        )
        .unwrap();

        let preferences = discover_from_roots(&[root.to_path_buf()]);
        assert_eq!(
            preferences.data_dir,
            Some(PathBuf::from("/tmp/default-zotero"))
        );
        assert_eq!(
            preferences.root_dir,
            Some(PathBuf::from("/tmp/default-linked"))
        );
    }

    #[test]
    fn ignores_empty_preferences() {
        let preferences = parse_preferences(
            "user_pref(\"extensions.zotero.dataDir\", \"\");\nuser_pref(\"extensions.zotero.baseAttachmentPath\", \"false\");\n",
        );
        assert_eq!(preferences, ZoteroPreferences::default());
    }
}
