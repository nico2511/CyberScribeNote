use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveSuggestion {
    pub suggest: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub proposed: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Unwrap only a whole-document ```markdown wrapper, never the first inner code fence.
pub fn unwrap_outer_markdown_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.is_empty() {
        return trimmed.to_string();
    }
    let lang = lines[0]
        .trim()
        .trim_start_matches('`')
        .trim()
        .to_lowercase();
    let is_wrapper = lang.is_empty()
        || lang == "markdown"
        || lang == "md"
        || lang == "text"
        || lang == "txt"
        || lang == "plaintext";
    if !is_wrapper {
        return trimmed.to_string();
    }
    let last_nonempty = lines.iter().rposition(|l| !l.trim().is_empty());
    let Some(end) = last_nonempty else {
        return trimmed.to_string();
    };
    if end < 1 || !lines[end].trim().starts_with("```") {
        return trimmed.to_string();
    }
    let mut next = lines[1..end].join("\n").trim().to_string();
    if fence_unclosed(&next) {
        next.push_str("\n```");
    }
    next
}

fn fence_unclosed(md: &str) -> bool {
    let mut open = false;
    for line in md.lines() {
        if line.trim().starts_with("```") {
            open = !open;
        }
    }
    open
}

pub fn sanitize_ai_response(raw: &str, action: &str, original: &str) -> String {
    let mut text = unwrap_outer_markdown_fence(raw);

    let lower = text.to_lowercase();
    for marker in [
        "voici le texte corrigé",
        "voici le texte reformulé",
        "voici la traduction",
        "je vais essayer",
        "texte corrigé :",
        "texte reformulé :",
    ] {
        if let Some(idx) = lower.find(marker) {
            let tail = text[idx..].splitn(2, ':').nth(1).unwrap_or("").trim();
            if tail.len() > 8 {
                text = tail.to_string();
                break;
            }
        }
    }

    if action != "custom" {
        text = text
            .trim()
            .trim_matches('"')
            .trim_matches('«')
            .trim_matches('»')
            .to_string();
    }

    if action == "correct" {
        let orig_words = original.split_whitespace().count();
        let out_words = text.split_whitespace().count();
        if orig_words > 0 && out_words > orig_words + orig_words / 2 + 3 {
            return original.to_string();
        }
    }

    if text.is_empty() {
        original.to_string()
    } else {
        text
    }
}

/** Heuristique anti-dérive : une « correction » doit ressembler à l'original. */
pub fn is_faithful_enough(original: &str, proposed: &str) -> bool {
    let o = original.trim();
    let p = proposed.trim();
    if o.is_empty() || p.is_empty() {
        return false;
    }
    let o_words: Vec<&str> = o.split_whitespace().collect();
    let p_words: Vec<&str> = p.split_whitespace().collect();
    if p_words.len() > o_words.len() + 2 {
        return false;
    }
    if (p.len() as f32) > (o.len() as f32) * 1.4 + 8.0 {
        return false;
    }
    let p_lower: Vec<String> = p_words.iter().map(|w| w.to_lowercase()).collect();
    let mut matched = 0usize;
    for w in &o_words {
        let nw = w.to_lowercase();
        if p_lower.iter().any(|pw| pw == &nw) {
            matched += 1;
            continue;
        }
        let prefix: String = nw.chars().take(2).collect();
        if prefix.len() >= 2
            && p_lower.iter().any(|pw| {
                pw.starts_with(&prefix) && (pw.len() as i32 - nw.len() as i32).abs() <= 3
            })
        {
            matched += 1;
        }
    }
    if o_words.is_empty() {
        return false;
    }
    (matched as f32) / (o_words.len() as f32) >= 0.45
}

pub fn parse_proactive_response(raw: &str) -> ProactiveSuggestion {
    let trimmed = raw.trim();
    let json_body = if trimmed.starts_with("```") {
        trimmed
            .lines()
            .skip(1)
            .take_while(|line| !line.trim().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            trimmed[start..=end].to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    if let Ok(parsed) = serde_json::from_str::<ProactiveSuggestion>(&json_body) {
        if parsed.suggest {
            let has_proposed = parsed
                .proposed
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_some();
            if has_proposed {
                return parsed;
            }
        }
        return ProactiveSuggestion {
            suggest: false,
            label: None,
            proposed: None,
            reason: None,
        };
    }

    ProactiveSuggestion {
        suggest: false,
        label: None,
        proposed: None,
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_keeps_yaml_fence_as_content() {
        let raw = "```yaml\nservices:\n  web:\n    image: nginx\n```\n\n# Suite";
        assert_eq!(unwrap_outer_markdown_fence(raw), raw);
    }

    #[test]
    fn unwrap_outer_markdown_preserves_inner_code() {
        let raw = "```markdown\n# Docker\n\n```yaml\nservices:\n  web:\n```\n```";
        let out = unwrap_outer_markdown_fence(raw);
        assert!(out.contains("# Docker"));
        assert!(out.contains("```yaml"));
        assert!(out.contains("image") || out.contains("services:"));
    }

    #[test]
    fn custom_sanitize_does_not_chop_inner_fences() {
        let raw = "```markdown\n# Stacks\n\n- [web](#web)\n\n```yaml\nservices:\n  web:\n    image: nginx\n```\n```";
        let out = sanitize_ai_response(raw, "custom", "services web nginx");
        assert!(out.contains("```yaml"));
        assert!(out.contains("# Stacks"));
        assert!(out.contains("- [web](#web)"));
    }
}
