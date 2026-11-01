//! PekoHub's two origins: the API (`api.pekohub.ai`) and the website
//! (`pekohub.ai`). Share links name the website; every call goes to the
//! API. Self-hosted hubs serve both from one origin, so only the official
//! hosts are mapped.

/// Website hosts whose API lives on `api.pekohub.ai`.
const OFFICIAL_WEB_HOSTS: &[&str] = &["pekohub.ai", "www.pekohub.ai", "pekohub.org"];

/// The API base for a hub address a user typed or a link carried.
pub fn hub_api_base(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    match reqwest::Url::parse(trimmed) {
        Ok(parsed) => match parsed.host_str() {
            Some(host) if OFFICIAL_WEB_HOSTS.contains(&host) => {
                format!("{}://api.pekohub.ai", parsed.scheme())
            }
            _ => parsed.origin().ascii_serialization(),
        },
        Err(_) => trimmed.to_string(),
    }
}

/// The website for a hub's API base (for links people open).
pub fn hub_web_origin(api: &str) -> String {
    let base = hub_api_base(api);
    match base.strip_prefix("https://api.pekohub.ai") {
        Some("") => "https://pekohub.ai".to_string(),
        _ => base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_web_hosts_map_to_the_api() {
        for web in [
            "https://pekohub.ai",
            "https://pekohub.ai/peko/a/b",
            "https://pekohub.org/",
            "https://www.pekohub.ai",
        ] {
            assert_eq!(hub_api_base(web), "https://api.pekohub.ai", "{web}");
        }
        assert_eq!(
            hub_api_base("https://api.pekohub.ai/"),
            "https://api.pekohub.ai"
        );
        // Self-hosted hubs keep their origin.
        assert_eq!(
            hub_api_base("http://localhost:3000/x"),
            "http://localhost:3000"
        );
        assert_eq!(hub_api_base("https://pekohub.aix"), "https://pekohub.aix");
    }

    #[test]
    fn the_website_for_an_api() {
        assert_eq!(
            hub_web_origin("https://api.pekohub.ai"),
            "https://pekohub.ai"
        );
        assert_eq!(hub_web_origin("https://pekohub.ai"), "https://pekohub.ai");
        assert_eq!(
            hub_web_origin("http://localhost:3000"),
            "http://localhost:3000"
        );
    }
}
