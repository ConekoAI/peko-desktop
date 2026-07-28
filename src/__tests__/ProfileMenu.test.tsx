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
    runOAuthFlowMock.mockResolvedValue({ added: 1, runtimes: [] });
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
    expect(runOAuthFlowMock).toHaveBeenCalledWith({
      baseUrl: "https://pekohub.org",
      scope: "runtimes:read",
    });
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

  it("Settings link navigates to /settings and closes the menu", () => {
    const wrapper = makeWrapper();
    render(<ProfileMenu />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /PekoHub account menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/i }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings" });
    expect(screen.queryByText("PekoHub · not signed in")).toBeNull();
  });
});