//! Your account's devices (runtime ADR-111), and where you have read up
//! to (runtime ADR-108).
//!
//! Your computers and phones are one list, signed by the devices on it. A
//! device joins it with a code shown on a device already on it. This
//! computer shows that code here, drawn as a QR code for a phone to scan
//! and as text to type on another computer; the code's secret part never
//! leaves this computer except through the screen.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

/// A device on your account's list.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    /// Its key, as a `did:key` (a computer's runtime id).
    pub id: String,
    /// `computer` or `phone`.
    pub kind: String,
    pub name: Option<String>,
    /// A phone's id at PekoHub.
    pub hub_device_id: Option<String>,
    /// RFC 3339.
    pub added_at: String,
    /// The device that added it.
    pub added_by: String,
    /// Whether it is this computer.
    pub this: bool,
    /// RFC 3339: when a phone last asked this computer for something.
    pub last_seen: Option<String>,
}

/// Something about your account that waits for you.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityItem {
    pub id: String,
    /// `owner_change`, `key_change`, or `devices_reset`.
    pub kind: String,
    pub summary: String,
    pub reason: String,
    /// The peko an owner change is about.
    pub peko: Option<String>,
    /// RFC 3339.
    pub created_at: String,
    /// Runtime ADR-112: the code of what it asks you to trust.
    pub code: Option<String>,
    /// Runtime ADR-112: a key change's code for the key trusted until now.
    pub pinned_code: Option<String>,
}

/// Your account's devices, as this computer holds them.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevices {
    /// `user:hub:<id>`; absent when this computer is not signed in.
    pub account: Option<String>,
    /// This computer's runtime id.
    pub runtime: String,
    /// Whether this computer is on the list.
    pub on_list: bool,
    pub devices: Vec<AccountDevice>,
    pub security: Vec<SecurityItem>,
    /// Runtime ADR-112: your account's code, once this computer holds its list.
    pub code: Option<String>,
}

/// An identity's code (runtime ADR-112), as this computer holds it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityCode {
    pub of: String,
    pub name: Option<String>,
    /// Absent when this computer has not met it.
    pub code: Option<String>,
}

/// A code that adds a device.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinCodeShown {
    /// The code to type, `ABCD-EFGH-JKMN`.
    pub code: String,
    /// The same code as an SVG picture, for a phone to scan.
    pub svg: String,
    /// RFC 3339: the code stops working then.
    pub expires_at: String,
}

/// What the window is told when this computer is not signed in to
/// PekoHub, which every device reaches it through.
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
            // The tag is for programs; the sentence is for people.
            match message.strip_prefix('[').and_then(|m| m.split_once("] ")) {
                Some((_, rest)) => rest.to_string(),
                None => message.to_string(),
            }
        }
    })
}

fn text(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn devices_from(value: &serde_json::Value) -> Result<AccountDevices, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let rows = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    Ok(AccountDevices {
        code: text(value, "code"),
        account: text(value, "account"),
        runtime: text(value, "runtime").unwrap_or_default(),
        on_list: value
            .get("on_list")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        devices: rows("devices")
            .iter()
            .filter_map(|row| {
                Some(AccountDevice {
                    id: text(row, "id")?,
                    kind: text(row, "kind").unwrap_or_else(|| "computer".into()),
                    name: text(row, "name"),
                    hub_device_id: text(row, "hub_device_id"),
                    added_at: text(row, "added_at").unwrap_or_default(),
                    added_by: text(row, "added_by").unwrap_or_default(),
                    this: row.get("this").and_then(|v| v.as_bool()).unwrap_or(false),
                    last_seen: text(row, "last_seen"),
                })
            })
            .collect(),
        security: rows("security")
            .iter()
            .filter_map(|row| {
                Some(SecurityItem {
                    id: text(row, "id")?,
                    kind: text(row, "kind").unwrap_or_default(),
                    summary: text(row, "summary").unwrap_or_default(),
                    reason: text(row, "reason").unwrap_or_default(),
                    peko: text(row, "peko"),
                    created_at: text(row, "created_at").unwrap_or_default(),
                    code: text(row, "code"),
                    pinned_code: text(row, "pinned_code"),
                })
            })
            .collect(),
    })
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

fn code_from(value: &serde_json::Value) -> Result<JoinCodeShown, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let (Some(code), Some(qr), Some(expires_at)) = (
        text(value, "code"),
        text(value, "qr"),
        text(value, "expires_at"),
    ) else {
        return Err("unexpected answer to a request for a code".to_string());
    };
    Ok(JoinCodeShown {
        code,
        svg: qr_svg(&qr)?,
        expires_at,
    })
}

async fn client() -> Result<crate::ipc::IpcClient, String> {
    crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))
}

/// Your account's devices, and what waits about it.
#[tauri::command]
pub async fn account_devices() -> Result<AccountDevices, String> {
    let value = client()
        .await?
        .device_list()
        .await
        .map_err(|e| format!("device_list failed: {e}"))?;
    devices_from(&value)
}

/// Show a code that adds a device. It works once, for ten minutes. Fails
/// with [`NOT_SIGNED_IN`] when this computer is not signed in to PekoHub.
#[tauri::command]
pub async fn device_add() -> Result<JoinCodeShown, String> {
    let value = client()
        .await?
        .device_add()
        .await
        .map_err(|e| format!("device_add failed: {e}"))?;
    code_from(&value)
}

/// Join this computer to your account's devices with a code shown on one
/// of them; returns the devices once it is on them.
#[tauri::command]
pub async fn device_join(code: String) -> Result<AccountDevices, String> {
    let c = client().await?;
    let value = c
        .device_join(code.trim())
        .await
        .map_err(|e| format!("device_join failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    let value = c
        .device_list()
        .await
        .map_err(|e| format!("device_list failed: {e}"))?;
    devices_from(&value)
}

/// Remove a device from your account; returns the devices left.
#[tauri::command]
pub async fn device_remove(device_id: String) -> Result<AccountDevices, String> {
    let c = client().await?;
    let value = c
        .device_remove(device_id.trim())
        .await
        .map_err(|e| format!("device_remove failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    let value = c
        .device_list()
        .await
        .map_err(|e| format!("device_list failed: {e}"))?;
    devices_from(&value)
}

/// The code of `of` (runtime ADR-112): `account`, `peko:hub:<id>`,
/// `user:hub:<id>`, or one of your pekos by name.
#[tauri::command]
pub async fn identity_code(of: String) -> Result<IdentityCode, String> {
    let value = client()
        .await?
        .identity_code(of.trim())
        .await
        .map_err(|e| format!("identity_code failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    Ok(IdentityCode {
        of: text(&value, "of").unwrap_or(of),
        name: text(&value, "name"),
        code: text(&value, "code"),
    })
}

/// Decide something about your account that waits; returns what happened.
#[tauri::command]
pub async fn security_decide(id: String, approve: bool) -> Result<String, String> {
    let value = client()
        .await?
        .security_decide(id.trim(), approve)
        .await
        .map_err(|e| format!("security_decide failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    Ok(text(&value, "message").unwrap_or_default())
}

/// Where you have read up to in one conversation (runtime ADR-108 D5).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadState {
    pub channel: String,
    /// `dm` or `group`.
    pub kind: String,
    /// A DM's other member: `principal` (a peko), `user` or `visitor`.
    pub peer_kind: Option<String>,
    /// A peko on this computer, by its local id (`prin_…`).
    pub peer_local_id: Option<String>,
    /// A peko or person on PekoHub, by their ID there.
    pub peer_hub_id: Option<String>,
    /// Posts after your read mark that you did not write.
    pub unread: u64,
    /// Whether you have a read mark here at all.
    pub marked: bool,
}

fn read_state_from(value: &serde_json::Value) -> Result<Vec<ReadState>, String> {
    if let Some(message) = refusal_of(value) {
        return Err(message);
    }
    let text = |row: &serde_json::Value, key: &str| {
        row.get(key).and_then(|v| v.as_str()).map(str::to_string)
    };
    Ok(value
        .get("channels")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let peer = row.get("peer").filter(|p| p.is_object());
            Some(ReadState {
                channel: text(row, "channel")?,
                kind: text(row, "kind").unwrap_or_else(|| "group".into()),
                peer_kind: peer.and_then(|p| text(p, "kind")),
                peer_local_id: peer.and_then(|p| text(p, "local_id")),
                peer_hub_id: peer.and_then(|p| text(p, "hub_id")),
                unread: row.get("unread").and_then(|v| v.as_u64()).unwrap_or(0),
                marked: row.get("read").is_some_and(|v| v.is_string()),
            })
        })
        .collect())
}

/// Where you have read up to in each of your conversations.
#[tauri::command]
pub async fn read_state() -> Result<Vec<ReadState>, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_read_state()
        .await
        .map_err(|e| format!("channel_read_state failed: {e}"))?;
    read_state_from(&value)
}

/// You have seen `channel` up to `at` (an ISO time). Your phone and your
/// other computers are told. Returns whether the mark moved.
#[tauri::command]
pub async fn mark_read(channel: String, at: String) -> Result<bool, String> {
    let client = crate::ipc::IpcClient::new()
        .await
        .map_err(|e| format!("IpcClient::new failed: {e}"))?;
    let value = client
        .channel_mark_read(channel.trim(), at.trim())
        .await
        .map_err(|e| format!("channel_mark_read failed: {e}"))?;
    if let Some(message) = refusal_of(&value) {
        return Err(message);
    }
    Ok(value
        .get("moved")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_accounts_devices() {
        let value = serde_json::json!({"type": "device_list_result", "request_id": 1,
            "account": "user:hub:alice", "runtime": "did:key:zDesk", "on_list": true,
            "devices": [
                {"id": "did:key:zDesk", "kind": "computer", "name": "Desk",
                 "added_at": "2026-11-18T00:00:00+00:00", "added_by": "did:key:zDesk", "this": true},
                {"id": "did:key:zPhone", "kind": "phone", "name": "Mira's iPhone", "hub_device_id": "dev_a1",
                 "added_at": "2026-11-18T00:01:00+00:00", "added_by": "did:key:zDesk", "this": false,
                 "last_seen": "2026-11-18T00:34:00Z"},
                {"name": "no id"},
            ],
            "security": [{"id": "apr_keychange0123", "kind": "key_change",
                          "summary": "PekoHub says ada has a new identity. Use it?", "reason": "",
                          "created_at": "2026-11-18T00:02:00+00:00",
                          "code": "11111 22222 33333 44444 55555 66666",
                          "pinned_code": "99999 88888 77777 66666 55555 44444"}],
            "code": "62659 39535 75152 38949 74100 79799"});
        let devices = devices_from(&value).unwrap();
        assert!(devices.on_list);
        assert_eq!(devices.devices.len(), 2);
        assert!(devices.devices[0].this);
        assert_eq!(devices.devices[1].hub_device_id.as_deref(), Some("dev_a1"));
        assert_eq!(devices.security[0].kind, "key_change");
        // The window gets camelCase.
        let json = serde_json::to_value(&devices).unwrap();
        assert_eq!(json["onList"], true);
        assert_eq!(json["devices"][1]["hubDeviceId"], "dev_a1");
        assert_eq!(
            json["security"][0]["createdAt"],
            "2026-11-18T00:02:00+00:00"
        );
        // Runtime ADR-112: the codes reach the window.
        assert_eq!(json["code"], "62659 39535 75152 38949 74100 79799");
        assert_eq!(
            json["security"][0]["pinnedCode"],
            "99999 88888 77777 66666 55555 44444"
        );
    }

    #[test]
    fn draws_the_join_code() {
        let qr = "peko://join?v=1&hub=https%3A%2F%2Fapi.pekohub.ai&code=K7DXKQ7RMTPZ";
        let value = serde_json::json!({"type": "device_code_shown", "request_id": 1,
            "code": "K7DX-KQ7R-MTPZ", "qr": qr, "expires_at": "2026-11-18T00:40:16+00:00"});
        let shown = code_from(&value).unwrap();
        assert!(shown.svg.starts_with("<?xml") || shown.svg.starts_with("<svg"));
        assert!(shown.svg.contains("#000000") && shown.svg.contains("#ffffff"));
        assert_eq!(shown.code, "K7DX-KQ7R-MTPZ");
        let json = serde_json::to_value(&shown).unwrap();
        assert!(json.get("expiresAt").is_some() && json.get("qr").is_none());
    }

    #[test]
    fn reads_the_read_state() {
        let value = serde_json::json!({"type": "channel_read_state_result", "request_id": 1, "channels": [
            {"channel": "dm_aa", "kind": "dm", "unread": 2, "read": "msg_1",
             "peer": {"address": "principal:local:prin_kit", "local_id": "prin_kit",
                      "hub_id": "c1e709c9", "kind": "principal", "registration": "private", "name": "kit"}},
            {"channel": "dm_bb", "kind": "dm", "unread": 0,
             "peer": {"address": "user:hub:noah-id", "hub_id": "noah-id", "kind": "user", "registration": "private"}},
            {"channel": "chan_cc", "kind": "group", "unread": 5},
        ]});
        let rows = read_state_from(&value).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].peer_local_id.as_deref(), Some("prin_kit"));
        assert_eq!((rows[0].unread, rows[0].marked), (2, true));
        assert_eq!(rows[1].peer_kind.as_deref(), Some("user"));
        assert_eq!(rows[1].peer_hub_id.as_deref(), Some("noah-id"));
        assert!(!rows[1].marked);
        assert_eq!(
            (rows[2].kind.as_str(), rows[2].peer_kind.clone()),
            ("group", None)
        );
        let json = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(json["peerLocalId"], "prin_kit");
    }

    #[test]
    fn says_when_this_computer_is_not_signed_in() {
        let value = serde_json::json!({"type": "error", "request_id": 1,
            "message": "[not_registered] Sign this computer in to PekoHub first; a phone reaches it through PekoHub."});
        assert_eq!(code_from(&value).unwrap_err(), NOT_SIGNED_IN);
        let other = serde_json::json!({"type": "error", "message": "[not_on_list] This computer is not on your account's devices yet"});
        assert_eq!(
            devices_from(&other).unwrap_err(),
            "This computer is not on your account's devices yet"
        );
    }
}
