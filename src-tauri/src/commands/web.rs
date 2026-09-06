use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub url: String,
    pub title: String,
    pub description: String,
    pub site_name: Option<String>,
    /// Extrait de contenu (README, article…) pour enrichir la note.
    #[serde(default)]
    pub excerpt: Option<String>,
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn attr_content(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let key = format!("{attr}=");
    let idx = lower.find(&key)?;
    let rest = &tag[idx + key.len()..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let end = rest[1..].find(quote)? + 1;
    Some(decode_entities(rest[1..end].trim()))
}

fn meta_by_name(html: &str, name: &str) -> Option<String> {
    let needle = name.to_lowercase();
    for chunk in html.split("<meta").skip(1) {
        let tag_end = chunk.find('>').unwrap_or(chunk.len().min(400));
        let tag = &chunk[..tag_end];
        let lower = tag.to_lowercase();
        let matches_name = lower.contains(&format!("name=\"{needle}\""))
            || lower.contains(&format!("name='{needle}'"))
            || lower.contains(&format!("property=\"{needle}\""))
            || lower.contains(&format!("property='{needle}'"))
            || lower.contains(&format!("property=\"og:{needle}\""))
            || lower.contains(&format!("property='og:{needle}'"));
        let matches_prop = lower.contains(&format!("property=\"{needle}\""))
            || lower.contains(&format!("property='{needle}'"));
        if matches_name || matches_prop {
            if let Some(c) = attr_content(tag, "content") {
                if !c.is_empty() {
                    return Some(c);
                }
            }
        }
    }
    None
}

fn extract_title(html: &str) -> Option<String> {
    if let Some(t) = meta_by_name(html, "og:title") {
        return Some(t);
    }
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let after = &html[start..];
    let gt = after.find('>')? + 1;
    let close = after.to_lowercase().find("</title>")?;
    if close <= gt {
        return None;
    }
    let raw = after[gt..close].trim();
    if raw.is_empty() {
        None
    } else {
        Some(decode_entities(raw))
    }
}

fn extract_description(html: &str) -> Option<String> {
    meta_by_name(html, "og:description")
        .or_else(|| meta_by_name(html, "description"))
        .map(|s| {
            let t = s.trim();
            if t.len() > 600 {
                format!("{}…", &t[..597])
            } else {
                t.to_string()
            }
        })
}

fn extract_site_name(html: &str) -> Option<String> {
    meta_by_name(html, "og:site_name")
}

fn looks_like_url(url: &str) -> bool {
    let u = url.trim().to_lowercase();
    u.starts_with("http://") || u.starts_with("https://")
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    decode_entities(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_excerpt(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let cut: String = t.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}…")
}

/// github.com/owner/repo(/...) → (owner, repo)
fn parse_github_repo(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let rest = u
        .strip_prefix("https://github.com/")
        .or_else(|| u.strip_prefix("http://github.com/"))?;
    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.trim_end_matches(".git").to_string();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    // Ignore github.com/settings etc.
    const RESERVED: &[&str] = &[
        "settings", "marketplace", "topics", "explore", "notifications", "login", "orgs",
    ];
    if RESERVED.contains(&owner.as_str()) {
        return None;
    }
    Some((owner, repo))
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Option<String> {
    let response = client
        .get(url)
        .header("Accept", "text/plain, text/markdown, text/html;q=0.8, */*;q=0.5")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    let slice = if bytes.len() > 400_000 {
        &bytes[..400_000]
    } else {
        &bytes[..]
    };
    Some(String::from_utf8_lossy(slice).to_string())
}

async fn fetch_github_readme(client: &reqwest::Client, owner: &str, repo: &str) -> Option<String> {
    let candidates = [
        format!("https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md"),
        format!("https://raw.githubusercontent.com/{owner}/{repo}/main/README.md"),
        format!("https://raw.githubusercontent.com/{owner}/{repo}/master/README.md"),
        format!("https://raw.githubusercontent.com/{owner}/{repo}/HEAD/Readme.md"),
        format!("https://raw.githubusercontent.com/{owner}/{repo}/HEAD/readme.md"),
    ];
    for url in candidates {
        if let Some(body) = fetch_text(client, &url).await {
            let trimmed = body.trim();
            if trimmed.len() > 40 {
                return Some(truncate_excerpt(trimmed, 4500));
            }
        }
    }
    None
}

fn extract_html_article(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    // Prefer GitHub readme container, then article, then main
    for marker in [
        "id=\"readme\"",
        "class=\"markdown-body",
        "<article",
        "<main",
    ] {
        if let Some(start) = lower.find(marker) {
            let slice = &html[start..];
            let end = slice
                .find("</article>")
                .or_else(|| slice.find("</main>"))
                .or_else(|| slice.find("</div>"))
                .unwrap_or(slice.len().min(80_000));
            let text = strip_tags(&slice[..end]);
            if text.len() > 80 {
                return Some(truncate_excerpt(&text, 4500));
            }
        }
    }
    None
}

#[tauri::command]
pub async fn fetch_page_meta(url: String) -> Result<PageMeta, String> {
    let url = url.trim().to_string();
    if !looks_like_url(&url) {
        return Err("URL invalide (http/https requis).".into());
    }
    if url.len() > 2000 {
        return Err("URL trop longue.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("CyberScribeNote/0.3 (+local note assistant)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut excerpt: Option<String> = None;
    let mut title: String;
    let mut description: String;
    let mut site_name: Option<String>;

    if let Some((owner, repo)) = parse_github_repo(&url) {
        site_name = Some("GitHub".into());
        title = format!("{owner}/{repo}");
        description = String::new();
        excerpt = fetch_github_readme(&client, &owner, &repo).await;
        if excerpt.is_none() {
            // Fallback HTML page
            if let Some(html) = fetch_text(&client, &url).await {
                title = extract_title(&html).unwrap_or(title);
                description = extract_description(&html).unwrap_or_default();
                site_name = extract_site_name(&html).or(site_name);
                excerpt = extract_html_article(&html);
            }
        } else if description.is_empty() {
            // First non-empty paragraph of README as description
            if let Some(ex) = &excerpt {
                description = ex
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" ");
                description = truncate_excerpt(&description, 400);
            }
        }
    } else {
        let response = client
            .get(&url)
            .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
            .send()
            .await
            .map_err(|e| format!("Impossible de joindre l'URL : {e}"))?;

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Lecture impossible : {e}"))?;
        let slice = if bytes.len() > 512_000 {
            &bytes[..512_000]
        } else {
            &bytes[..]
        };
        let html = String::from_utf8_lossy(slice);

        title = extract_title(&html).unwrap_or_else(|| {
            url.trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or("Lien")
                .to_string()
        });
        description = extract_description(&html).unwrap_or_default();
        site_name = extract_site_name(&html);
        excerpt = extract_html_article(&html);
    }

    Ok(PageMeta {
        url,
        title: title.trim().to_string(),
        description,
        site_name,
        excerpt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_title_and_og() {
        let html = r#"
        <html><head>
        <title>Raw Title</title>
        <meta property="og:title" content="OG Title &amp; Co" />
        <meta name="description" content="A short desc" />
        <meta property="og:site_name" content="Example" />
        </head></html>
        "#;
        assert_eq!(extract_title(html).as_deref(), Some("OG Title & Co"));
        assert_eq!(extract_description(html).as_deref(), Some("A short desc"));
        assert_eq!(extract_site_name(html).as_deref(), Some("Example"));
    }

    #[test]
    fn parses_github_repo_urls() {
        assert_eq!(
            parse_github_repo("https://github.com/nico2511/CyberScribeNote"),
            Some(("nico2511".into(), "CyberScribeNote".into()))
        );
        assert_eq!(
            parse_github_repo("https://github.com/nico2511/CyberScribeNote/tree/main"),
            Some(("nico2511".into(), "CyberScribeNote".into()))
        );
        assert_eq!(parse_github_repo("https://github.com/settings"), None);
    }
}
