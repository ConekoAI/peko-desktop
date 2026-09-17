import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The Registry page consumes the seed-flow hooks; mock them at that
// boundary so the test drives the pull/reload state directly.
const pullMutate = vi.fn();
const pullReset = vi.fn();
const reloadMutate = vi.fn();

interface PullState {
  isSuccess: boolean;
  data?: { name: string; version: string; digest: string };
}

const pullState: PullState = { isSuccess: false };
const reloadState = { isSuccess: false, isError: false, isPending: false };

vi.mock("../hooks/useRegistry", () => ({
  useRegistrySearch: () => ({
    data: {
      items: [
        {
          ref: "coding-assistant",
          name: "coding-assistant",
          version: "1.2.3",
          description: "A seed",
          author: "pekohub",
          downloads: 42,
          tags: [],
        },
      ],
      total: 1,
    },
    isLoading: false,
  }),
  useRegistryPull: () => ({
    mutate: pullMutate,
    reset: pullReset,
    isPending: false,
    isSuccess: pullState.isSuccess,
    isError: false,
    error: null,
    data: pullState.data,
    variables: "coding-assistant",
  }),
  usePrincipalReload: () => ({
    mutate: reloadMutate,
    isPending: reloadState.isPending,
    isSuccess: reloadState.isSuccess,
    isError: reloadState.isError,
    error: null,
  }),
}));

import Registry from "../pages/Registry";

const writeText = vi.fn();

describe("Registry seed install flow", () => {
  beforeEach(() => {
    pullMutate.mockReset();
    pullReset.mockReset();
    reloadMutate.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
    pullState.isSuccess = false;
    pullState.data = undefined;
    reloadState.isSuccess = false;
    reloadState.isError = false;
    reloadState.isPending = false;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("install button pulls the seed by ref", () => {
    render(<Registry />);
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(pullMutate).toHaveBeenCalledWith("coding-assistant");
  });

  it("shows the CLI grounding command after a successful pull", () => {
    pullState.isSuccess = true;
    pullState.data = {
      name: "coding-assistant",
      version: "1.2.3",
      digest: "sha256:abc123",
    };
    render(<Registry />);

    const panel = screen.getByTestId("seed-create-panel");
    expect(panel).toBeInTheDocument();
    // The pull result's name+version ride into the panel copy, and the
    // copyable command matches the hub's `/seeds` guidance.
    expect(panel.textContent).toContain("coding-assistant");
    expect(panel.textContent).toContain("v1.2.3");
    expect(
      screen.getByText("peko create my-peko -s coding-assistant.seed.toml"),
    ).toBeInTheDocument();
  });

  it("presents no in-app create button (create-from-seed is CLI-local)", () => {
    pullState.isSuccess = true;
    pullState.data = {
      name: "coding-assistant",
      version: "1.2.3",
      digest: "sha256:abc123",
    };
    render(<Registry />);
    expect(
      screen.queryByRole("button", { name: /^create$/i }),
    ).not.toBeInTheDocument();
  });

  it("copy button writes the grounding command to the clipboard", async () => {
    pullState.isSuccess = true;
    pullState.data = {
      name: "coding-assistant",
      version: "1.2.3",
      digest: "sha256:abc123",
    };
    render(<Registry />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "peko create my-peko -s coding-assistant.seed.toml",
      ),
    );
  });

  it("refresh button reloads the runtime's principal manager", () => {
    pullState.isSuccess = true;
    pullState.data = {
      name: "coding-assistant",
      version: "1.2.3",
      digest: "sha256:abc123",
    };
    render(<Registry />);
    fireEvent.click(screen.getByRole("button", { name: /refresh peko list/i }));
    expect(reloadMutate).toHaveBeenCalledTimes(1);
  });

  it("dismiss button resets the pull state (hides the panel)", () => {
    pullState.isSuccess = true;
    pullState.data = {
      name: "coding-assistant",
      version: "1.2.3",
      digest: "sha256:abc123",
    };
    render(<Registry />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(pullReset).toHaveBeenCalledTimes(1);
  });

  it("no panel renders before a successful pull", () => {
    render(<Registry />);
    expect(screen.queryByTestId("seed-create-panel")).not.toBeInTheDocument();
  });
});
