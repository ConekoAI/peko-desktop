// "New peko" from the sidebar is onboarding's name-and-avatar form:
// name, avatar, then description and model under Advanced.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const createMock = vi.fn(async (_req: unknown) => ({ name: "juno" }));
const updateMock = vi.fn(async (_req: unknown) => ({}));
const principalsSignal: { value: unknown } = { value: [] };
const modelsSignal: { value: unknown } = { value: [] };

function mutation(fn: (arg: never) => Promise<unknown>) {
  return { mutateAsync: fn, isPending: false, error: null, reset: vi.fn() };
}

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipals: () => ({ data: principalsSignal.value }),
  usePrincipalCreate: () => mutation(createMock as never),
  usePrincipalUpdate: () => mutation(updateMock as never),
}));
const setupStepsMock = vi.fn(async (_seed: string): Promise<string[]> => []);
vi.mock("../lib/api", () => ({
  seedSetupSteps: (seed: string) => setupStepsMock(seed),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsSignal.value }),
}));

import CreatePrincipalModal from "../components/modals/CreatePrincipalModal";

beforeEach(() => {
  createMock.mockClear();
  updateMock.mockClear();
  setupStepsMock.mockReset();
  setupStepsMock.mockResolvedValue([]);
  principalsSignal.value = [{ name: "nova" }];
  modelsSignal.value = [
    { id: "fast", displayName: "Fast", enabled: true },
    { id: "deep", displayName: "Deep", enabled: true },
  ];
});

describe("CreatePrincipalModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CreatePrincipalModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("creates a peko with a name, avatar, and the first model, then opens it", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreatePrincipalModal open onClose={onClose} onCreated={onCreated} />);
    // A free name is suggested; taken ones are not.
    expect(screen.getByRole("textbox", { name: /name/i })).toHaveValue("pip");
    fireEvent.change(screen.getByRole("textbox", { name: /name/i }), { target: { value: "juno" } });
    fireEvent.click(screen.getByRole("button", { name: "Use 🦉" }));
    fireEvent.click(screen.getByRole("button", { name: /create juno/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("juno"));
    expect(createMock).toHaveBeenCalledWith({ name: "juno", modelId: "fast" });
    expect(updateMock).toHaveBeenCalledWith({ name: "juno", avatar: "🦉" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the description and model under Advanced", async () => {
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/what this peko is for/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.change(screen.getByPlaceholderText(/what this peko is for/i), {
      target: { value: "Plans my week" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "deep" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: "pip",
        modelId: "deep",
        description: "Plans my week",
      }),
    );
  });

  it("grows the peko from a chosen seed file", async () => {
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const text = 'name = "ada"\npreferred_model_id = "deep"\n';
    const file = new File([text], "ada.seed.toml", { type: "application/toml" });
    fireEvent.change(screen.getByLabelText("Seed file"), { target: { files: [file] } });
    expect(await screen.findByTestId("new-peko-seed")).toHaveTextContent("ada.seed.toml");
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ name: "pip", modelId: "fast", seed: text }),
    );
  });

  it("shows a seed's setup steps and creates only once they are accepted", async () => {
    setupStepsMock.mockResolvedValue(["Install ripgrep", "Add the notes skill"]);
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const text = 'name = "ada"\n[intent]\nsetup = ["Install ripgrep", "Add the notes skill"]\n';
    const file = new File([text], "ada.seed.toml", { type: "application/toml" });
    fireEvent.change(screen.getByLabelText("Seed file"), { target: { files: [file] } });

    const steps = await screen.findAllByTestId("new-peko-setup-step");
    expect(steps.map((s) => s.textContent)).toEqual(["Install ripgrep", "Add the notes skill"]);
    expect(screen.getByTestId("new-peko-setup")).toHaveTextContent(
      /run commands and download code on this computer/i,
    );
    const create = screen.getByRole("button", { name: /create pip/i });
    expect(create).toBeDisabled();

    fireEvent.click(screen.getByTestId("new-peko-setup-accept"));
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: "pip",
        modelId: "fast",
        seed: text,
        acceptSetup: true,
      }),
    );
  });

  it("forgets the steps and the acceptance when the seed is removed", async () => {
    setupStepsMock.mockResolvedValue(["Install ripgrep"]);
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const file = new File(['name = "ada"\n'], "ada.seed.toml", { type: "application/toml" });
    fireEvent.change(screen.getByLabelText("Seed file"), { target: { files: [file] } });
    fireEvent.click(await screen.findByTestId("new-peko-setup-accept"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByTestId("new-peko-setup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create pip/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "pip", modelId: "fast" }));
  });

  it("says so when a seed's steps can't be read", async () => {
    setupStepsMock.mockRejectedValue(new Error("This seed could not be read: bad TOML"));
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const file = new File(['name = "ada"\n[['], "ada.seed.toml", { type: "application/toml" });
    fireEvent.change(screen.getByLabelText("Seed file"), { target: { files: [file] } });
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    expect(screen.queryByTestId("new-peko-seed")).toBeNull();
  });

  it("refuses a file that isn't a seed", async () => {
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const file = new File(["just some text"], "notes.toml", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Seed file"), { target: { files: [file] } });
    expect(await screen.findByText(/doesn't look like a seed/)).toBeInTheDocument();
  });

  it("refuses a name already taken", () => {
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /name/i }), { target: { value: "nova" } });
    expect(screen.getByText(/already have a peko with this name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create nova/i })).toBeDisabled();
  });

  it("sends you to add a model when there is none", () => {
    modelsSignal.value = [];
    render(<CreatePrincipalModal open onClose={vi.fn()} />);
    expect(screen.getByTestId("new-peko-no-model")).toHaveTextContent(/settings → models/i);
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  });
});
