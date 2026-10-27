#!/usr/bin/env python3
"""Check the desktop's IPC requests against the runtime's contract fixture.

peko-runtime keeps `peko-rs/core/src/ipc/fixtures/desktop_requests.json`:
one sample of every request this app sends, which a runtime unit test
decodes as `RequestPacket`. This script checks the other half: every
`json!({"type": ...})` request built in `src-tauri/src/ipc/mod.rs` has a
fixture entry with the same field names, and the fixture lists nothing
the desktop no longer sends. Together the two keep the wire in step.

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


def desktop_requests() -> dict[str, set[str]]:
    source = IPC_SOURCE.read_text()
    # Requests built inside the unit-test module are not sent.
    source = source[: source.rfind("#[cfg(test)]")]
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

    if problems:
        print("❌ desktop IPC requests do not match the runtime contract fixture:")
        for problem in problems:
            print(f"   - {problem}")
        print(f"   Update {FIXTURE} in peko-runtime together with src-tauri/src/ipc/mod.rs.")
        return 1
    print(f"✓ {len(sent)} desktop IPC requests match {fixture_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
