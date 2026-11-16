// The New peko form offers PekoHub's starter seeds, so a first peko can
// start with a job without a seed file being downloaded first.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const createMock = vi.fn(async (_req: unknown) => ({ name: "pip" }));
const updateMock = vi.fn(async (_req: unknown) => ({}));

function mutation(fn: (arg: never) => Promise<unknown>) {
  return { mutateAsync: fn, isPending: false, error: null, reset: vi.fn() };
}

vi.mock("../hooks/usePrincipals", () => ({
  usePrincipalCreate: () => mutation(createMock as never),
  usePrincipalUpdate: () => mutation(updateMock as never),
}));
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: [{ id: "fast", displayName: "Fast", enabled: true }] }),
}));
type Contents = { steps: string[]; files: { path: string; size: number; content: string | null }[] };
const contentsMock = vi.fn(async (_seed: string): Promise<Contents> => ({ steps: [], files: [] }));
vi.mock("../lib/api", () => ({
  seedContents: (seed: string) => contentsMock(seed),
}));
const STARTERS = [
  { name: "briefing", displayName: "Briefing", avatar: "📰", description: "Sends you what changed, once a day." },
  { name: "coach", displayName: "Coach", avatar: "🎯", description: "Checks in until it is done." },
];
const listMock = vi.fn(async () => STARTERS);
const textMock = vi.fn(async (name: string) => `name = "${name}"\npersona = "…"\n`);
vi.mock("../lib/starterSeeds", () => ({
  listStarterSeeds: () => listMock(),
  starterSeedText: (name: string) => textMock(name),
}));

import NewPekoForm from "../components/peko/NewPekoForm";

const form = (onCreated = vi.fn()) => render(<NewPekoForm takenNames={[]} onCreated={onCreated} />);

beforeEach(() => {
  createMock.mockClear();
  updateMock.mockClear();
  contentsMock.mockReset();
  contentsMock.mockResolvedValue({ steps: [], files: [] });
  listMock.mockReset();
  listMock.mockResolvedValue(STARTERS);
  textMock.mockClear();
});

describe("New peko: starter seeds", () => {
  it("offers the starter seeds, with a blank peko chosen", async () => {
    form();
    const starters = await screen.findByTestId("new-peko-starters");
    expect(starters).toHaveTextContent("Briefing");
    expect(starters).toHaveTextContent("Coach");
    expect(screen.getByRole("button", { name: "Blank" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Briefing/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("creates the peko from a picked starter seed, with the seed's avatar", async () => {
    const onCreated = vi.fn();
    form(onCreated);
    fireEvent.click(await screen.findByRole("button", { name: /Briefing/ }));
    expect(await screen.findByTestId("new-peko-starter-about")).toHaveTextContent("once a day");
    expect(screen.getByRole("button", { name: /Briefing/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Blank" })).toHaveAttribute("aria-pressed", "false");
    expect(textMock).toHaveBeenCalledWith("briefing");

    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("nova"));
    expect(createMock).toHaveBeenCalledWith({
      name: "nova",
      modelId: "fast",
      seed: 'name = "briefing"\npersona = "…"\n',
    });
    expect(updateMock).toHaveBeenCalledWith({ name: "nova", avatar: "📰" });
  });

  it("keeps an avatar the person picked", async () => {
    form();
    fireEvent.click(screen.getByRole("button", { name: "Use 🦉" }));
    fireEvent.click(await screen.findByRole("button", { name: /Coach/ }));
    await screen.findByTestId("new-peko-starter-about");
    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ name: "nova", avatar: "🦉" }));
  });

  it("goes back to a blank peko", async () => {
    form();
    fireEvent.click(await screen.findByRole("button", { name: /Briefing/ }));
    await screen.findByTestId("new-peko-starter-about");
    fireEvent.click(screen.getByRole("button", { name: "Blank" }));
    expect(screen.queryByTestId("new-peko-starter-about")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "nova", modelId: "fast" }));
    expect(updateMock).toHaveBeenCalledWith({ name: "nova", avatar: "🦊" });
  });

  it("shows what a starter seed would set up and needs it accepted", async () => {
    contentsMock.mockResolvedValue({ steps: ["Install ripgrep"], files: [] });
    form();
    fireEvent.click(await screen.findByRole("button", { name: /Briefing/ }));
    expect(await screen.findByTestId("new-peko-setup")).toHaveTextContent("Install ripgrep");
    expect(screen.getByRole("button", { name: /create nova/i })).toBeDisabled();
    fireEvent.click(screen.getByTestId("new-peko-setup-accept"));
    expect(screen.getByRole("button", { name: /create nova/i })).toBeEnabled();
  });

  it("says so when a starter seed can't be fetched, and stays blank", async () => {
    textMock.mockRejectedValueOnce(new Error("Couldn't reach api.pekohub.ai"));
    form();
    fireEvent.click(await screen.findByRole("button", { name: /Briefing/ }));
    expect(await screen.findByText(/Couldn't get this seed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blank" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "nova", modelId: "fast" }));
  });

  it("works as before when PekoHub can't be reached", async () => {
    listMock.mockRejectedValue(new Error("offline"));
    form();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByTestId("new-peko-starters")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create nova/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "nova", modelId: "fast" }));
  });
});
