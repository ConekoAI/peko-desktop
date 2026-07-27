import { describe, it, expect } from "vitest";
import {
  isValidPrincipalName,
  PRINCIPAL_NAME_MAX,
} from "../lib/validatePrincipalName";

describe("isValidPrincipalName", () => {
  it.each([
    "a",
    "alice",
    "helper-1",
    "test_principal",
    "A1B2C3",
    "a".repeat(PRINCIPAL_NAME_MAX), // exact max
  ])("accepts %s", (n) => {
    expect(isValidPrincipalName(n)).toBe(true);
  });

  it.each([
    "",
    " ",
    "-leading",
    "trailing-",
    "has/slash",
    "has\\backslash",
    "has space",
    "has.dot",
    ".", // single dot
    "..", // double dot (path-traversal)
    "..foo",
    "foo..",
    "foo..bar",
    "a".repeat(PRINCIPAL_NAME_MAX + 1), // over max
  ])("rejects %s", (n) => {
    expect(isValidPrincipalName(n)).toBe(false);
  });
});
