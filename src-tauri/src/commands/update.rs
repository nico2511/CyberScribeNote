//! Détection d'une release GitHub plus récente (pas d'installation automatique).
//!
//! `GET /repos/nico2511/CyberScribeNote/releases/latest` — brouillons et préversions
//! ignorés. Le zip `CyberScribeNote-win.zip` est seulement proposé au téléchargement.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::config::{load_config, persist_config, LastUpdateCheck};

const LATEST_URL: &str = "https://api.github.com/repos/nico2511/CyberScribeNote/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/nico2511/CyberScribeNote/releases";
const RELEASE_URL_PREFIX: &str = "https://github.com/nico2511/CyberScribeNote/releases/";
const DOWNLOAD_PREFIX: &str = "https://github.com/nico2511/CyberScribeNote/releases/download/";
const ZIP_NAME: &str = "CyberScribeNote-win.zip";
const SNOOZE_DAYS: i64 = 7;
const OFFLINE_MSG: &str = "Vérification impossible (hors ligne ou GitHub indisponible).";

fn embedded_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    /// `true` si le tag porte un identifiant de préversion (`-rc.1`, `-beta`…).
    pre: bool,
}

fn parse_version(raw: &str) -> Option<SemVer> {
    let trimmed = raw.trim();
    let stripped = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if stripped.is_empty() {
        return None;
    }
    let (core, pre_part) = match stripped.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (stripped, None),
    };
    let core = core.split_once('+').map(|(c, _)| c).unwrap_or(core);
    let pre = pre_part.map(|p| p.split_once('+').map(|(p, _)| p).unwrap_or(p));
    let has_pre = pre.is_some_and(|p| !p.is_empty());
    let mut nums = core.split('.');
    let major = nums.next()?.parse::<u64>().ok()?;
    let minor = match nums.next() {
        Some(s) => s.parse::<u64>().ok()?,
        None => 0,
    };
    let patch = match nums.next() {
        Some(s) => s.parse::<u64>().ok()?,
        None => 0,
    };
    if nums.next().is_some() {
        return None;
    }
    Some(SemVer {
        major,
        minor,
        patch,
        pre: has_pre,
    })
}

fn display_version(tag: &str) -> String {
    let trimmed = tag.trim();
    trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed)
        .to_string()
}

/// `true` seulement si `tag` est une release stable strictement plus récente.
fn release_is_update(current_raw: &str, tag: &str, draft: bool, prerelease: bool) -> bool {
    if draft || prerelease {
        return false;
    }
    let Some(current) = parse_version(current_raw) else {
        return false;
    };
    let Some(latest) = parse_version(tag) else {
        return false;
    };
    if latest.pre {
        return false;
    }
    (latest.major, latest.minor, latest.patch) > (current.major, current.minor, current.patch)
}

fn tag_is_stable(tag: &str, draft: bool, prerelease: bool) -> bool {
    if draft || prerelease {
        return false;
    }
    parse_version(tag).is_some_and(|v| !v.pre)
}

fn tag_for_url(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 64
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn url_is_safe_https(url: &str) -> bool {
    !url.is_empty()
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && !url.contains("..")
        && !url.contains('\\')
}

fn sanitize_release_url(url: &str, tag: &str) -> String {
    let url = url.trim();
    if url.starts_with(RELEASE_URL_PREFIX) && url_is_safe_https(url) {
        return url.to_string();
    }
    if tag_for_url(tag) {
        format!("{RELEASES_PAGE}/tag/{tag}")
    } else {
        RELEASES_PAGE.to_string()
    }
}

fn sanitize_download(url: &str) -> Option<String> {
    let url = url.trim();
    if url.starts_with(DOWNLOAD_PREFIX) && url_is_safe_https(url) {
        Some(url.to_string())
    } else {
        None
    }
}

fn excerpt(body: &str) -> Option<String> {
    let collapsed = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return None;
    }
    const MAX: usize = 180;
    if trimmed.chars().count() <= MAX {
        return Some(trimmed.to_string());
    }
    let cut: String = trimmed.chars().take(MAX).collect();
    let cut = cut
        .rsplit_once(' ')
        .map(|(head, _)| head)
        .unwrap_or(cut.as_str());
    let cut = cut.trim_end_matches(|c: char| matches!(c, ' ' | ',' | ';' | ':'));
    Some(format!("{cut}…"))
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    #[serde(default)]
    browser_download_url: String,
}

fn find_zip(assets: &[GhAsset]) -> Option<String> {
    assets
        .iter()
        .find(|asset| asset.name == ZIP_NAME)
        .and_then(|asset| sanitize_download(&asset.browser_download_url))
}

/// Interprète le JSON de `releases/latest` sans appel réseau.
fn evaluate_github_release(
    json: &str,
    current: &str,
    checked_at: &str,
) -> Result<LastUpdateCheck, String> {
    let release: GhRelease =
        serde_json::from_str(json).map_err(|_| "Réponse GitHub illisible.".to_string())?;
    let stable = tag_is_stable(&release.tag_name, release.draft, release.prerelease);
    let update_available = release_is_update(
        current,
        &release.tag_name,
        release.draft,
        release.prerelease,
    );
    let name = {
        let raw = release.name.trim();
        if raw.is_empty() {
            release.tag_name.clone()
        } else if raw.chars().count() > 120 {
            let mut short: String = raw.chars().take(120).collect();
            short.push('…');
            short
        } else {
            raw.to_string()
        }
    };
    Ok(LastUpdateCheck {
        current: current.to_string(),
        latest: display_version(&release.tag_name),
        update_available,
        release_url: sanitize_release_url(&release.html_url, &release.tag_name),
        download_url: if stable {
            find_zip(&release.assets)
        } else {
            None
        },
        name,
        body: release.body.as_deref().and_then(excerpt),
        checked_at: checked_at.to_string(),
    })
}

fn no_published_release(current: &str, checked_at: &str) -> LastUpdateCheck {
    LastUpdateCheck {
        current: current.to_string(),
        latest: current.to_string(),
        update_available: false,
        release_url: RELEASES_PAGE.to_string(),
        download_url: None,
        name: String::new(),
        body: None,
        checked_at: checked_at.to_string(),
    }
}

fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(4))
        .user_agent(format!(
            "CyberScribeNote/{} (https://github.com/nico2511/CyberScribeNote)",
            embedded_version()
        ))
        .redirect(reqwest::redirect::Policy::limited(3))
        .https_only(true)
        .build()
        .map_err(|_| OFFLINE_MSG.to_string())
}

async fn fetch_latest(current: &str) -> Result<LastUpdateCheck, String> {
    let checked_at = Utc::now().to_rfc3339();
    let client = github_client()?;
    let response = client
        .get(LATEST_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| OFFLINE_MSG.to_string())?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Ok(no_published_release(current, &checked_at));
    }
    if !status.is_success() {
        return Err(OFFLINE_MSG.to_string());
    }
    let body = response.text().await.map_err(|_| OFFLINE_MSG.to_string())?;
    evaluate_github_release(&body, current, &checked_at)
}

fn remember(info: &LastUpdateCheck) {
    let mut cfg = load_config();
    cfg.last_update_check = Some(info.clone());
    if let Err(err) = persist_config(&cfg) {
        eprintln!("check_app_update: {err}");
    }
}

#[tauri::command]
pub async fn check_app_update() -> Result<LastUpdateCheck, String> {
    let info = fetch_latest(embedded_version()).await?;
    remember(&info);
    Ok(info)
}

/// Masque l'avis de démarrage pour cette version pendant 7 jours (config locale).
#[tauri::command]
pub fn snooze_app_update(version: String) -> Result<(), String> {
    let version = display_version(version.trim());
    if version.is_empty() || version.len() > 64 || parse_version(&version).is_none() {
        return Err("Version invalide.".into());
    }
    let until: DateTime<Utc> = Utc::now() + chrono::Duration::days(SNOOZE_DAYS);
    let mut cfg = load_config();
    cfg.update_snooze_until = Some(until.to_rfc3339());
    cfg.update_snooze_version = Some(version);
    persist_config(&cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-09-26T12:00:00Z";

    fn release_json(tag: &str, draft: bool, prerelease: bool, body: &str, assets: &str) -> String {
        format!(
            r#"{{
                "tag_name": "{tag}",
                "name": "{tag}",
                "body": {body},
                "html_url": "https://github.com/nico2511/CyberScribeNote/releases/tag/{tag}",
                "draft": {draft},
                "prerelease": {prerelease},
                "assets": {assets}
            }}"#,
            body = serde_json::to_string(body).unwrap(),
            draft = draft,
            prerelease = prerelease,
        )
    }

    fn zip_assets(tag: &str) -> String {
        format!(
            r#"[
                {{
                    "name": "voice_worker.exe",
                    "browser_download_url": "https://github.com/nico2511/CyberScribeNote/releases/download/{tag}/voice_worker.exe"
                }},
                {{
                    "name": "CyberScribeNote-win.zip",
                    "browser_download_url": "https://github.com/nico2511/CyberScribeNote/releases/download/{tag}/CyberScribeNote-win.zip"
                }}
            ]"#
        )
    }

    #[test]
    fn equal_versions_are_not_an_update() {
        assert!(!release_is_update("0.5.8", "v0.5.8", false, false));
        assert!(!release_is_update("v0.5.8", "0.5.8", false, false));
        assert!(!release_is_update("0.5.8", "v0.5.8+win", false, false));
        let info = evaluate_github_release(
            &release_json("v0.5.8", false, false, "Déjà là.", &zip_assets("v0.5.8")),
            "0.5.8",
            NOW,
        )
        .unwrap();
        assert!(!info.update_available);
        assert_eq!(info.current, "0.5.8");
        assert_eq!(info.latest, "0.5.8");
        assert_eq!(
            info.download_url.as_deref(),
            Some("https://github.com/nico2511/CyberScribeNote/releases/download/v0.5.8/CyberScribeNote-win.zip")
        );
    }

    #[test]
    fn patch_minor_and_major_are_updates() {
        assert!(release_is_update("0.5.8", "v0.5.9", false, false));
        assert!(release_is_update("0.5.8", "v0.6.0", false, false));
        assert!(release_is_update("0.5.8", "v1.0.0", false, false));
        assert!(release_is_update("1.2", "v1.2.1", false, false));
        assert!(!release_is_update("0.5.8", "v0.5.7", false, false));
        let info = evaluate_github_release(
            &release_json(
                "v0.5.9",
                false,
                false,
                "Correctif du vault.\n\nDétails plus loin.",
                &zip_assets("v0.5.9"),
            ),
            "0.5.8",
            NOW,
        )
        .unwrap();
        assert!(info.update_available);
        assert_eq!(info.latest, "0.5.9");
        assert_eq!(
            info.body.as_deref(),
            Some("Correctif du vault. Détails plus loin.")
        );
        assert!(info
            .download_url
            .as_deref()
            .unwrap()
            .ends_with("/CyberScribeNote-win.zip"));
        assert!(info.release_url.contains("/releases/tag/v0.5.9"));
    }

    #[test]
    fn prerelease_and_draft_are_ignored() {
        assert!(!release_is_update("0.5.8", "v0.5.9", false, true));
        assert!(!release_is_update("0.5.8", "v0.5.9", true, false));
        assert!(!release_is_update("0.5.8", "v0.5.9-rc.1", false, false));
        assert!(!release_is_update("0.5.8", "v0.5.9-beta", true, true));

        let pre = evaluate_github_release(
            &release_json(
                "v0.6.0-rc.1",
                false,
                true,
                "bêta",
                &zip_assets("v0.6.0-rc.1"),
            ),
            "0.5.8",
            NOW,
        )
        .unwrap();
        assert!(!pre.update_available);
        assert_eq!(pre.latest, "0.6.0-rc.1");
        assert!(pre.download_url.is_none());

        let draft = evaluate_github_release(
            &release_json("v0.9.0", true, false, "brouillon", &zip_assets("v0.9.0")),
            "0.5.8",
            NOW,
        )
        .unwrap();
        assert!(!draft.update_available);
        assert!(draft.download_url.is_none());
    }

    #[test]
    fn missing_zip_and_untrusted_urls_are_dropped() {
        let assets = r#"[
            {
                "name": "CyberScribeNote-win.zip",
                "browser_download_url": "https://evil.example/CyberScribeNote-win.zip"
            }
        ]"#;
        let mut json = release_json("v0.5.9", false, false, "", assets);
        json = json.replace(
            "https://github.com/nico2511/CyberScribeNote/releases/tag/v0.5.9",
            "https://evil.example/phish",
        );
        let info = evaluate_github_release(&json, "0.5.8", NOW).unwrap();
        assert!(info.update_available);
        assert!(info.download_url.is_none());
        assert_eq!(
            info.release_url,
            "https://github.com/nico2511/CyberScribeNote/releases/tag/v0.5.9"
        );
        assert!(info.body.is_none());
    }

    #[test]
    fn body_excerpt_is_short() {
        let long = "mot ".repeat(80);
        let info = evaluate_github_release(
            &release_json("v1.0.0", false, false, &long, "[]"),
            "0.5.8",
            NOW,
        )
        .unwrap();
        let body = info.body.unwrap();
        assert!(body.chars().count() <= 181);
        assert!(body.ends_with('…'));
    }

    #[test]
    fn invalid_json_is_an_error() {
        assert!(evaluate_github_release("[]", "0.5.8", NOW).is_err());
        assert!(evaluate_github_release("{", "0.5.8", NOW).is_err());
    }

    #[test]
    fn unparsable_tag_is_not_an_update() {
        assert!(!release_is_update("0.5.8", "nightly", false, false));
        assert!(!release_is_update("0.5.8", "v1.2.3.4", false, false));
        let info = evaluate_github_release(
            &release_json("nightly", false, false, "x", "[]"),
            "0.5.8",
            NOW,
        )
        .unwrap();
        assert!(!info.update_available);
        assert_eq!(info.latest, "nightly");
    }
}
