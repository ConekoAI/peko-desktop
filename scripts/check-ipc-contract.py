#!/usr/bin/env python3
"""Check the desktop's IPC requests against the runtime's contract fixture.

peko-runtime keeps two fixtures under `peko-rs/core/src/ipc/fixtures/`:

- `desktop_requests.json` — one sample of every request this app sends;
  a runtime test decodes each as `RequestPacket`. This script checks
  that every `json!({"type": ...})` request built in
  `src-tauri/src/ipc/mod.rs` has an entry with the same field names, and
  that the fixture lists nothing the desktop no longer sends.
- `desktop_stream_responses.json` — the stream packets this app parses;
  a runtime test pins their exact shape. This script checks that the
  parser in `ipc/mod.rs` handles each packet type and reads each field.

Together they keep the wire in step.

Usage: scripts/check-ipc-contract.py [path/to/peko-runtime]
(defaults to $PEKO_RUNTIME_DIR, then ../peko-runtime)
"""

import json
import os
import re
import sys
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent.parent
IPC_SOURCE = DESKTOP / "src-tauri/src/ipc/mod.rs"
FIXTURE = "peko-rs/core/src/ipc/fixtures/desktop_requests.json"
STREAM_FIXTURE = "peko-rs/core/src/ipc/fixtures/desktop_stream_responses.json"


def desktop_source() -> str:
    source = IPC_SOURCE.read_text()
    # Code inside the unit-test module does not run in the app.
    return source[: source.rfind("#[cfg(test)]")]


def desktop_requests() -> dict[str, set[str]]:
    source = desktop_source()
    requests: dict[str, set[str]] = {}
    for match in re.finditer(r'json!\(\{\s*"type":\s*"([a-z_]+)"(.*?)\}\);', source, re.S):
        fields = set(re.findall(r'^\s*"([a-z_]+)":', match.group(2), re.M))
        requests.setdefault(match.group(1), set()).update(fields | {"type"})
    return requests


def main() -> int:
    runtime = Path(
        sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PEKO_RUNTIME_DIR", DESKTOP.parent / "peko-runtime")
    )
    fixture_path = runtime / FIXTURE
    if not fixture_path.is_file():
        print(f"❌ runtime contract fixture not found: {fixture_path}", file=sys.stderr)
        return 2
    fixture = {entry["type"]: set(entry) for entry in json.loads(fixture_path.read_text())}
    sent = desktop_requests()

    problems = []
    for ty in sorted(sent.keys() - fixture.keys()):
        problems.append(f"`{ty}` is sent but has no fixture entry")
    for ty in sorted(fixture.keys() - sent.keys()):
        problems.append(f"`{ty}` is in the fixture but no longer sent")
    for ty in sorted(sent.keys() & fixture.keys()):
        if sent[ty] != fixture[ty]:
            only_desktop = sorted(sent[ty] - fixture[ty])
            only_fixture = sorted(fixture[ty] - sent[ty])
            problems.append(f"`{ty}` fields differ: desktop-only {only_desktop}, fixture-only {only_fixture}")

    stream_path = runtime / STREAM_FIXTURE
    if not stream_path.is_file():
        print(f"❌ runtime stream fixture not found: {stream_path}", file=sys.stderr)
        return 2
    source = desktop_source()
    stream = json.loads(stream_path.read_text())
    for packet in stream:
        ty = packet["type"]
        if f'"{ty}"' not in source:
            problems.append(f"stream packet `{ty}` is not handled by the desktop parser")
        for field in sorted(set(packet) - {"type", "request_id"}):
            if f'"{field}"' not in source:
                problems.append(f"stream packet `{ty}` field `{field}` is never read")

    if problems:
        print("❌ desktop IPC does not match the runtime contract fixtures:")
        for problem in problems:
            print(f"   - {problem}")
        print("   Update peko-runtime's peko-rs/core/src/ipc/fixtures/ together with src-tauri/src/ipc/mod.rs.")
        return 1
    print(f"✓ {len(sent)} desktop IPC requests and {len(stream)} stream packets match {runtime}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
