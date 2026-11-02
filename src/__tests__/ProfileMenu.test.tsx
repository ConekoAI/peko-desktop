import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

// Mutable signals for the hooks ProfileMenu consumes. Each test
// reassigns these to control the component's view of PekoHub state.
const usePekohubBundleMock = vi.fn();
const usePekohubLogoutMock = vi.fn();
const runOAuthFlowMock = vi.fn();
const useSettingsMock = vi.fn();

vi.mock("../hooks/useRuntimes", () => ({
  usePekohubBundle: () => usePekohubBundleMock(),
  usePekohubLogout: () => usePekohubLogoutMock(),
  runOAuthFlow: (opts: unknown) => runOAuthFlowMock(opts),
}));

const runtimeHubDisconnectMock = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  // The spy resolves; a `{ reject }` answer is thrown here, the way Tauri's
  // `invoke` rejects (with the message string).
  runtimeHubDisconnect: async (hub: string, discard: boolean) => {
    const answer = await runtimeHubDisconnectMock(hub, discard);
    if (answer && "reject" in answer) throw answer.reject;
    return answer;
  },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

// Mock useNavigate so the test doesn't need a real router.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

import ProfileMenu from "../components/ProfileMenu";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function defaultSettings() {
  return {
    data: [
      { key: "pekohub.base_url", value: "https://pekohub.org" },
      { key: "pekohub.oauth_scope", value: "runtimes:read" },
    ],
  };
}

function defaultBundle() {
  return { isPending: false, data: null };
}

beforeEach(() => {
  usePekohubBundleMock.mockReturnValue(defaultBundle());
  usePekohubLogoutMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  runOAuthFlowMock.mockReset();
  navigateMock.mockReset();
  useSettingsMock.mockReturnValue(defaultSettings());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProfileMenu", () => {
  it("renders skeleton in loading state", () => {
    usePekohubBundleMock.mockReturnValue({ isPending: true, data: null });
    const wrapper = makeWrapper();
    const { container } = render(<ProfileMenu />, { wrapper });
    const btn = screen.getByRole("button", { name: /PekoHub account menu/i });
    expect(btn).toBeDisabled();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("signed-out: avatar carries Sign-in title", () => {
    usePekohubBundleMock.mockReturnValue({ isPending: false, data: null });
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });
    const btn = screen.getByRole("button", { name: /PekoHub account menu/i });
    expect(btn).toHaveAttribute("title", "Sign in to PekoHub");
    expect(btn).not.toBeDisabled();
  });

  it("signed-out: clicking the avatar opens dropdown with Sign-in button", () => {
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    expect(screen.queryByTestId("pekohub-signin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    expect(screen.getByTestId("pekohub-signin")).toBeInTheDocument();
    expect(screen.queryByTestId("pekohub-signout")).toBeNull();
    expect(screen.getByText("PekoHub · not signed in")).toBeInTheDocument();
  });

  it("clicking Sign in calls runOAuthFlow with the configured baseUrl/scope", async () => {
    runOAuthFlowMock.mockResolvedValue({ registered: true, account: "acct" });
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("pekohub-signin"));
      // Allow the awaited runOAuthFlow to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runOAuthFlowMock).toHaveBeenCalledTimes(1);
    // The configured website address (`pekohub.org`) reaches the API host.
    expect(runOAuthFlowMock).toHaveBeenCalledWith({
      baseUrl: "https://api.pekohub.ai",
      scope: "runtimes:read",
    });
  });

  it("says so when signing in worked but this computer couldn't register", async () => {
    runOAuthFlowMock.mockResolvedValue({ registered: false, error: "PekoHub refused a registration challenge: HTTP 503" });
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("pekohub-signin"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      await screen.findByText(/couldn't connect to PekoHub: PekoHub refused a registration challenge/),
    ).toBeInTheDocument();
  });

  it("shows signing-in indicator while runOAuthFlow is pending", () => {
    // Never-resolving promise — keeps the component in signing-in state.
    runOAuthFlowMock.mockReturnValue(new Promise(() => {}));
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    fireEvent.click(screen.getByTestId("pekohub-signin"));

    expect(
      screen.getByText(/Waiting for PekoHub to redirect you back/),
    ).toBeInTheDocument();
  });

  it("signed-in: dropdown has pekohub-signout, no pekohub-signin", () => {
    usePekohubBundleMock.mockReturnValue({
      isPending: false,
      data: { access_token: "abc" },
    });
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    const btn = screen.getByRole("button", { name: /PekoHub account menu/i });
    expect(btn).toHaveAttribute("title", "PekoHub · signed in");

    fireEvent.click(btn);
    expect(screen.getByTestId("pekohub-signout")).toBeInTheDocument();
    expect(screen.queryByTestId("pekohub-signin")).toBeNull();
    expect(screen.getByText("PekoHub · signed in")).toBeInTheDocument();
  });

  it("clicking Sign out calls usePekohubLogout mutation and closes the menu", () => {
    const mutate = vi.fn();
    usePekohubLogoutMock.mockReturnValue({ mutate, isPending: false });
    usePekohubBundleMock.mockReturnValue({
      isPending: false,
      data: { access_token: "abc" },
    });
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    fireEvent.click(screen.getByTestId("pekohub-signout"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pekohub-signout")).toBeNull();
  });

  it("outside click closes the dropdown", async () => {
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    expect(screen.getByText("PekoHub · not signed in")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByText("PekoHub · not signed in")).toBeNull(),
    );
  });

  it("Escape closes the dropdown", async () => {
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    expect(screen.getByText("PekoHub · not signed in")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("PekoHub · not signed in")).toBeNull(),
    );
  });

  it("is the account menu only: Settings lives in the rail", () => {
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /Settings/i })).toBeNull();
  });

  // Runtime ADR-091 D5: disconnecting this computer, then signing out.
  describe("disconnect this computer", () => {
    function signedIn() {
      usePekohubBundleMock.mockReturnValue({ isPending: false, data: { access_token: "t" } });
      const mutate = vi.fn();
      usePekohubLogoutMock.mockReturnValue({ mutate, isPending: false });
      render(<ProfileMenu />, { wrapper: makeWrapper() });
      fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
      fireEvent.click(screen.getByTestId("pekohub-disconnect"));
      return mutate;
    }

    beforeEach(() => runtimeHubDisconnectMock.mockReset());

    it("confirms, disconnects, then signs out", async () => {
      runtimeHubDisconnectMock.mockResolvedValue({ done: true, unsent: null, localOnly: ["ada"] });
      const mutate = signedIn();
      expect(screen.getByText("Disconnect this computer?")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      await waitFor(() => expect(mutate).toHaveBeenCalledWith("https://api.pekohub.ai"));
      expect(runtimeHubDisconnectMock).toHaveBeenCalledWith("https://api.pekohub.ai", false);
      expect(screen.queryByText("Disconnect this computer?")).toBeNull();
    });

    it("names undelivered messages and goes on only when asked", async () => {
      runtimeHubDisconnectMock
        .mockResolvedValueOnce({ done: false, unsent: 2, localOnly: [] })
        .mockResolvedValueOnce({ done: true, unsent: null, localOnly: [] });
      const mutate = signedIn();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      await screen.findByText("Some messages haven't been delivered");
      expect(screen.getByText(/^2 message\(s\) to pekos on other computers/)).toBeInTheDocument();
      expect(mutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect anyway" }));
      await waitFor(() => expect(mutate).toHaveBeenCalled());
      expect(runtimeHubDisconnectMock).toHaveBeenLastCalledWith("https://api.pekohub.ai", true);
    });

    it("waiting keeps everything as it was", async () => {
      runtimeHubDisconnectMock.mockResolvedValueOnce({ done: false, unsent: 1, localOnly: [] });
      const mutate = signedIn();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      fireEvent.click(await screen.findByRole("button", { name: "Wait" }));
      expect(screen.queryByText("Some messages haven't been delivered")).toBeNull();
      expect(mutate).not.toHaveBeenCalled();
      expect(runtimeHubDisconnectMock).toHaveBeenCalledTimes(1);
    });

    it("says why it couldn't disconnect", async () => {
      runtimeHubDisconnectMock.mockResolvedValue({
        reject: "PekoHub refused to unregister the runtime: HTTP 401",
      });
      const mutate = signedIn();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
      expect(await screen.findByTestId("pekohub-disconnect-error")).toHaveTextContent("HTTP 401");
      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
