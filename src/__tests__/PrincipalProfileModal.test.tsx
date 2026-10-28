// Tests for the principal profile modal's ADR-covered surfaces:
//   • share link uses the canonical `/peko/{owner}/{name}` form
//   • registration changes go through `principalRegister`; an
//     `[exposure_conflict]` rejection renders the dedicated
//     one-online-copy alert with the tag stripped
//   • `.peko` export panel: key warning, validated path input,
//     principalExport payload, success echo

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

interface MutState {
  error: unknown;
  isPending: boolean;
  mutate: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}

function idleMut(): MutState {
  return { error: null, isPending: false, mutate: vi.fn(), reset: vi.fn() };
}

const principalState: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
const updateState: MutState = idleMut();
const removeState: MutState = idleMut();
const exportState: MutState = idleMut();

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipal: () => principalState,
  usePrincipalUpdate: () => updateState,
  usePrincipalRemove: () => removeState,
  usePrincipalExport: () => exportState,
}));

vi.mock("../hooks/usePrincipalStatus", () => ({
  usePrincipalStatus: () => ({ data: { status: "online" }, isLoading: false }),
  statusBadge: (s: string) => ({ label: s, color: "text-emerald-500" }),
}));

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: [], isLoading: false }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
    data: [{ key: "pekohub.base_url", value: "https://pekohub.org" }],
  }),
}));

const principalRegisterMock = vi.fn();
vi.mock("../lib/api", () => ({
  principalSetStatus: vi.fn(),
  principalMintInvite: vi.fn(),
  principalRevokeInvite: vi.fn(),
  principalRegister: (...args: unknown[]) => principalRegisterMock(...args),
}));

import PrincipalProfileModal from "../components/modals/PrincipalProfileModal";

/** Edit, pick a registration, Save; the config update succeeds. */
function saveRegistration(value: string) {
  updateState.mutate.mockImplementation(
    (_payload: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
  );
  fireEvent.click(screen.getByTitle("Edit"));
  fireEvent.change(screen.getByLabelText("PekoHub"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

const LOCAL_PUBLIC = {
  name: "helper",
  exposure: "public",
  status: "online",
  description: "personal assistant",
  preferredModelId: null,
  owner: "alice",
  runtimeId: "local",
};

function renderModal(principal: unknown = LOCAL_PUBLIC) {
  principalState.data = principal;
  return render(
    <PrincipalProfileModal
      open
      principalName="helper"
      onClose={vi.fn()}
    />,
  );
}

describe("PrincipalProfileModal", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    principalRegisterMock.mockReset();
    principalState.data = undefined;
    principalState.isLoading = false;
    for (const s of [updateState, removeState, exportState]) {
      s.error = null;
      s.isPending = false;
      s.mutate.mockReset();
      s.reset.mockReset();
    }
  });

  it("builds the share link with the canonical /peko/{owner}/{name} path", () => {
    renderModal();
    expect(
      screen.getByText("https://pekohub.org/peko/alice/helper"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/p\/alice\/helper/)).toBeNull();
  });

  it("saves a registration change through principalRegister, not the config update", async () => {
    principalRegisterMock.mockResolvedValue({});
    renderModal();
    saveRegistration("private");
    await waitFor(() =>
      expect(principalRegisterMock).toHaveBeenCalledWith({
        name: "helper",
        registration: "private",
        runtimeId: "local",
      }),
    );
    const payload = updateState.mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("exposure");
  });

  it("renders the dedicated one-online-copy alert when registration rejects with [exposure_conflict]", async () => {
    principalRegisterMock.mockRejectedValue(
      new Error("[exposure_conflict] conflictingInstanceId: hub:hub.example.com"),
    );
    renderModal();
    saveRegistration("private");
    const alert = await screen.findByTestId("exposure-conflict");
    expect(alert).toHaveTextContent(/already registered from another computer/i);
    // The tag is stripped; the hub's detail rides along.
    expect(alert).toHaveTextContent("conflictingInstanceId: hub:hub.example.com");
    expect(alert.textContent).not.toContain("[exposure_conflict]");
  });

  it("renders a generic error box for non-conflict update failures", () => {
    updateState.error = new Error("daemon unreachable");
    renderModal();
    expect(screen.queryByTestId("exposure-conflict")).toBeNull();
    expect(screen.getByText("daemon unreachable")).toBeInTheDocument();
  });

  it("export panel warns about private keys and defaults to ~/.peko/exports/<name>.peko", () => {
    renderModal();
    expect(screen.getByText(/private keys/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/destination path/i) as HTMLInputElement;
    expect(input.value).toBe("~/.peko/exports/helper.peko");
  });

  it("export calls principalExport with {name, output} and echoes the path on success", () => {
    exportState.mutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    renderModal();
    fireEvent.click(screen.getByTestId("export-peko-submit"));
    expect(exportState.mutate).toHaveBeenCalledWith(
      { name: "helper", output: "~/.peko/exports/helper.peko" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByTestId("export-peko-success")).toHaveTextContent(
      "~/.peko/exports/helper.peko",
    );
  });

  it("blocks export when the destination does not end in .peko", () => {
    renderModal();
    const input = screen.getByLabelText(/destination path/i);
    fireEvent.change(input, { target: { value: "/tmp/helper.txt" } });
    expect(screen.getByText(/must end in/i)).toBeInTheDocument();
    const button = screen.getByTestId("export-peko-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(exportState.mutate).not.toHaveBeenCalled();
  });

  it("saves a picked avatar, and sends none when it is unchanged", () => {
    renderModal({ ...LOCAL_PUBLIC, avatar: "🐱" });
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateState.mutate.mock.calls[0][0]).toMatchObject({ avatar: undefined });

    // The mocked update never succeeds, so the form stays open.
    fireEvent.click(screen.getByRole("button", { name: "Use 🦉" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateState.mutate.mock.calls[1][0]).toMatchObject({ avatar: "🦉" });
  });

  it("clears the avatar with an empty value", () => {
    renderModal({ ...LOCAL_PUBLIC, avatar: "🐱" });
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateState.mutate.mock.calls[0][0]).toMatchObject({ avatar: "" });
  });

  it("edit mode uses peko copy for the description placeholder", () => {
    renderModal();
    fireEvent.click(screen.getByTitle("Edit"));
    expect(
      screen.getByPlaceholderText("What this peko does"),
    ).toBeInTheDocument();
  });

  it("puts Remove in a Danger zone with one confirmation", () => {
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    principalState.data = LOCAL_PUBLIC;
    removeState.mutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    render(
      <PrincipalProfileModal open principalName="helper" onClose={onClose} onRemoved={onRemoved} />,
    );
    // No Activity page any more; one footer, no stray cancel buttons.
    expect(screen.queryByRole("button", { name: /activity/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep helper" }));
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
    expect(removeState.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    fireEvent.click(screen.getByTestId("confirm-remove-peko"));
    expect(removeState.mutate).toHaveBeenCalledWith({ name: "helper" }, expect.any(Object));
    expect(onRemoved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

