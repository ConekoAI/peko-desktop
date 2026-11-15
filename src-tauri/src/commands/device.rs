//! Phones paired with this computer (runtime ADR-108).
//!
//! A paired phone reads and posts as the person through this computer.
//! The owner pairs one by showing it a code on this screen, and removes
//! it here. The code carries a secret that never leaves the computer
//! except through the phone's camera, so it is drawn here and handed to
//! the window as a picture.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// A phone paired with this computer.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedPhone {
    pub device_id: String,
    /// What the phone calls itself ("Mira's iPhone").
    pub name: String,
    /// `ios` or `android`.
    pub platform: String,
    /// RFC 3339.
    pub paired_at: String,
    /// RFC 3339; absent until the phone first asks for something.
    pub last_seen: Option<String>,
}

/// A code for a phone to scan.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhonePairing {
    /// The code as an SVG picture.
    pub svg: String,
    /// RFC 3339: the code stops working then.
    pub expires_at: String,
}

/// What the window is told when this computer is not signed in to
/// PekoHub, which a phone reaches it through.
pub const NOT_SIGNED_IN: &str = "not_signed_in";

fn refusal_of(value: &serde_json::Value) -> Option<String> {
    (value.get("type").and_then(|t| t.as_str()) == Some("error")).then(|| {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("refused");
        if message.starts_with("[not_registered]") {
            NOT_SIGNED_IN.to_string()
        } else {
            message.to_string()
        }
    })
}

fn phones_from(value: &serde_json::Value) -> Result<Vec<PairedPhone>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let text = |row: &serde_json::Value, key: &str| {
        row.get(key).and_then(|v| v.as_str()).map(str::to_string)
    };
    Ok(value
        .get("devices")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|row| {
            Some(PairedPhone {
                device_id: text(row, "device_id")?,
                name: text(row, "name").unwrap_or_default(),
                platform: text(row, "platform").unwrap_or_default(),
                paired_at: text(row, "paired_at").unwrap_or_default(),
                last_seen: text(row, "last_seen"),
            })
        })
        .collect())
}

/// Draw `text` as a QR code. Dark on white whatever the app's theme, with
/// the quiet zone a camera needs.
fn qr_svg(text: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M)
        .map_err(|e| format!("could not draw the code: {e}"))?;
    Ok(code
        .render::<svg::Color<'_>>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

fn pairing_from(value: &serde_json::Value) -> Result<PhonePairing, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let text = |key: &str| value.get(key).and_then(|v| v.as_str());
    let (Some(qr), Some(expires_at)) = (text("qr"), text("expires_at")) else {
        return Err("unexpected answer to a pairing request".to_string());
    };
    Ok(PhonePairing {
        svg: qr_svg(qr)?,
        expires_at: expires_at.to_string(),
    })
}

/// The phones paired with this computer, oldest pairing first.
#[tauri::command]
pub async fn paired_phones() -> Result<Vec<PairedPhone>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .device_list()
        .await
        .map_err(|e| format!("device_list failed: {e}"))?;
    phones_from(&value)
}

/// Open a pairing and draw its code. The code works once, for ten
/// minutes. Fails with [`NOT_SIGNED_IN`] when this computer is not signed
/// in to PekoHub.
#[tauri::command]
pub async fn phone_pair_start() -> Result<PhonePairing, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .device_pair_start()
        .await
        .map_err(|e| format!("device_pair_start failed: {e}"))?;
    pairing_from(&value)
}

/// Remove a paired phone; returns the phones still paired.
#[tauri::command]
pub async fn paired_phone_remove(device_id: String) -> Result<Vec<PairedPhone>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .device_remove(device_id.trim())
        .await
        .map_err(|e| format!("device_remove failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    // `success: false` means it was already gone, which is what was asked.
    let value = client
        .device_list()
        .await
        .map_err(|e| format!("device_list failed: {e}"))?;
    phones_from(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_paired_phones() {
        let value = serde_json::json!({"type": "device_list_result", "request_id": 1, "devices": [
            {"device_id": "dev_a1", "name": "Mira's iPhone", "platform": "ios",
             "paired_at": "2026-11-15T00:30:26Z", "last_seen": "2026-11-15T00:34:00Z"},
            {"device_id": "dev_b2", "name": "Pixel", "platform": "android",
             "paired_at": "2026-11-15T00:40:44Z"},
            {"name": "no id"},
        ]});
        let phones = phones_from(&value).unwrap();
        assert_eq!(phones.len(), 2);
        assert_eq!(phones[0].name, "Mira's iPhone");
        assert_eq!(phones[0].last_seen.as_deref(), Some("2026-11-15T00:34:00Z"));
        assert_eq!(phones[1].last_seen, None);
        // The window gets camelCase.
        let json = serde_json::to_value(&phones[1]).unwrap();
        assert_eq!(json["deviceId"], "dev_b2");
        assert_eq!(json["pairedAt"], "2026-11-15T00:40:44Z");
    }

    #[test]
    fn draws_the_pairing_code() {
        let qr = "peko://pair?v=1&hub=https%3A%2F%2Fapi.pekohub.ai&runtime=did%3Akey%3Az6MktDmCnc9BYzT815iqojtbhWuv2n5fCoCTsUYpEb73HWin&id=pair_c42197e9c6c741cd&secret=eE4y_QHtm09LZwzffwjHyiGGF7PsPuOK_pPajiSM1gw";
        let value = serde_json::json!({"type": "device_pair_started", "request_id": 1,
            "code": "pair_c42197e9c6c741cd", "qr": qr,
            "expires_at": "2026-11-15T00:40:16+00:00"});
        let pairing = pairing_from(&value).unwrap();
        assert!(pairing.svg.starts_with("<?xml") || pairing.svg.starts_with("<svg"));
        assert!(pairing.svg.contains("#000000") && pairing.svg.contains("#ffffff"));
        // A picture of the code, never its text.
        assert!(!pairing.svg.contains("secret="));
        assert_eq!(pairing.expires_at, "2026-11-15T00:40:16+00:00");
        // And the picture says what was asked.
        let json = serde_json::to_value(&pairing).unwrap();
        assert!(json.get("expiresAt").is_some() && json.get("qr").is_none());
    }

    #[test]
    fn says_when_this_computer_is_not_signed_in() {
        let value = serde_json::json!({"type": "error", "request_id": 1,
            "message": "[not_registered] Sign this computer in to PekoHub first; a phone reaches it through PekoHub."});
        assert_eq!(pairing_from(&value).unwrap_err(), NOT_SIGNED_IN);
        let other = serde_json::json!({"type": "error", "message": "[permission_denied] local callers only"});
        assert_eq!(
            phones_from(&other).unwrap_err(),
            "[permission_denied] local callers only"
        );
    }
}
