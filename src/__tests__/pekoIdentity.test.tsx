// How a peko looks: avatar or initials on a stable accent; actors
// resolve to names.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PekoAvatar from "../components/peko/PekoAvatar";
import { PEKO_ACCENTS, pekoAccent, pekoIdentity, pekoInitials } from "../lib/pekoIdentity";
import { resolveActor } from "../hooks/usePekoDirectory";
import type { PrincipalSummary } from "../lib/api";

describe("pekoIdentity", () => {
  it("keeps a peko's accent through a rename (it follows the local id)", () => {
    const before = pekoIdentity({ name: "alice", localId: "prin_1" });
    const after = pekoIdentity({ name: "alice-2", localId: "prin_1" });
    expect(after.accent).toBe(before.accent);
    expect(PEKO_ACCENTS).toContain(before.accent);
  });

  it("spreads accents across pekos", () => {
    const accents = new Set(
      Array.from({ length: 40 }, (_, i) => pekoAccent(`prin_${i}`)),
    );
    expect(accents.size).toBeGreaterThan(4);
  });

  it("derives initials from the name", () => {
    expect(pekoInitials("research-bot")).toBe("RB");
    expect(pekoInitials("alice")).toBe("A");
    expect(pekoInitials("")).toBe("?");
  });

  it("uses the chosen avatar, ignoring a blank one", () => {
    expect(pekoIdentity({ name: "a", avatar: "🦊" }).avatar).toBe("🦊");
    expect(pekoIdentity({ name: "a", avatar: "  " }).avatar).toBeNull();
  });
});

describe("PekoAvatar", () => {
  it("shows the avatar, else the initials, on the accent colours", () => {
    const { rerender } = render(<PekoAvatar peko={pekoIdentity({ name: "nova", avatar: "🦉" })} />);
    const face = screen.getByTestId("peko-avatar");
    expect(face).toHaveTextContent("🦉");
    expect(face.getAttribute("style")).toContain("var(--peko-");
    rerender(<PekoAvatar peko={pekoIdentity({ name: "nova bot" })} />);
    expect(screen.getByTestId("peko-avatar")).toHaveTextContent("NB");
  });
});

describe("resolveActor", () => {
  const pekos = [
    { name: "alice", localId: "prin_a", avatar: "🦊", runtimeId: "local" },
  ] as PrincipalSummary[];

  it("names pekos by local id in every actor form", () => {
    for (const actor of ["principal:prin_a", "principal:local:prin_a", "prin_a", "alice"]) {
      const who = resolveActor(actor, pekos);
      expect(who.label).toBe("alice");
      expect(who.peko?.avatar).toBe("🦊");
    }
  });

  it("calls the local user You and keeps unknown actors readable", () => {
    expect(resolveActor("user:local", pekos)).toMatchObject({ label: "You", isYou: true });
    expect(resolveActor("user:hub:9a2f", pekos).label).toBe("9a2f");
    expect(resolveActor("principal:hub:7f1c", pekos).label).toBe("principal:hub:7f1c");
  });
});
