// Mirrors peko-runtime's `validate_agent_name`
// (peko-runtime/peko-rs/core/src/common/identifiers.rs:49-76).
//   - 1-64 chars
//   - ASCII alphanumeric, "-", or "_"
//   - no leading/trailing "-"
//   - no path separators
//   - no ".." segment (path-traversal defense, runtime PR #241)
//
// The regex itself rejects "." (so ".." is incidentally rejected).
// The explicit `..` and leading/trailing "-" checks document intent
// and survive a future regex loosening.
export const PRINCIPAL_NAME_MAX = 64;
const PRINCIPAL_NAME_RE = /^[A-Za-z0-9_-]+$/;

export function isValidPrincipalName(raw: string): boolean {
  const name = raw.trim();
  if (name.length === 0 || name.length > PRINCIPAL_NAME_MAX) return false;
  if (name === ".." || name === ".") return false;
  if (name.includes("..")) return false;
  if (name.startsWith("-") || name.endsWith("-")) return false;
  return PRINCIPAL_NAME_RE.test(name);
}
