import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import VersionMismatchBanner from "../components/VersionMismatchBanner";

describe("VersionMismatchBanner", () => {
  it("tells the owner of an older runtime to update the runtime", () => {
    render(
      <VersionMismatchBanner actual="0.1.1" expected="0.1.3" reason="older" onDismiss={() => {}} />,
    );
    const banner = screen.getByTestId("engine-version-mismatch-banner");
    expect(banner.textContent).toContain("needs 0.1.3 or later");
    expect(banner.textContent).toContain("peko update");
  });

  it("tells the owner of a newer line to update the app", () => {
    render(
      <VersionMismatchBanner actual="0.2.0" expected="0.1.3" reason="newer" onDismiss={() => {}} />,
    );
    const banner = screen.getByTestId("engine-version-mismatch-banner");
    expect(banner.textContent).toContain("Update Peko Desktop");
    expect(banner.textContent).not.toContain("peko update");
  });
});
