// Secret requests (runtime ADR-116): the owner types the value into the
// card; it goes to the engine once and is not kept here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mutateAsync = vi.fn();
vi.mock("../hooks/usePrincipals", () => ({
  useAnswerSecret: () => ({ mutateAsync, isPending: false }),
}));

import SecretRequestCards from "../components/chat/SecretRequestCard";
import type { SecretRequest } from "../types";

const TOKEN: SecretRequest = {
  id: "sec_aaa",
  secret: "GITHUB_TOKEN",
  kind: "peko",
  why: "to open pull requests with gh",
  createdAt: "2026-11-22T10:00:00Z",
  expiresAt: "2026-11-23T10:00:00Z",
};
const SLOT: SecretRequest = { ...TOKEN, id: "sec_bbb", secret: "notion/api_token", kind: "mcp" };

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue("Saved GITHUB_TOKEN for mochi.");
});

describe("SecretRequestCards", () => {
  it("renders nothing without requests", () => {
    const { container } = render(<SecretRequestCards peko="mochi" requests={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the secret, the reason, and the MCP server for a slot", () => {
    render(<SecretRequestCards peko="mochi" requests={[TOKEN, SLOT]} />);
    expect(screen.getByTestId("secret-card-sec_aaa")).toHaveTextContent("GITHUB_TOKEN");
    expect(screen.getByTestId("secret-card-sec_aaa")).toHaveTextContent("pull requests");
    expect(screen.getByTestId("secret-card-sec_bbb")).toHaveTextContent("api_token");
    expect(screen.getByTestId("secret-card-sec_bbb")).toHaveTextContent("notion");
  });

  it("hides the value, saves it once, and clears the field", async () => {
    render(<SecretRequestCards peko="mochi" requests={[TOKEN]} />);
    const input = screen.getByTestId("secret-input-sec_aaa") as HTMLInputElement;
    expect(input.type).toBe("password");
    const save = screen.getByRole("button", { name: /save securely/i });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(input.type).toBe("text");
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "mochi",
      id: "sec_aaa",
      value: "ghp_secret",
      decline: false,
    });
    expect(input.value).toBe("");
    expect(screen.getByTestId("secret-cards")).toHaveTextContent("Saved GITHUB_TOKEN");
  });

  it("declines without sending a value", async () => {
    render(<SecretRequestCards peko="mochi" requests={[TOKEN]} />);
    fireEvent.change(screen.getByTestId("secret-input-sec_aaa"), { target: { value: "typed" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "mochi",
      id: "sec_aaa",
      value: undefined,
      decline: true,
    });
  });
});
