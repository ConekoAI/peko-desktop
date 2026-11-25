// Picking a model the endpoint lists fills in what its list says about
// it, then what models.dev suggests; nothing a person typed is replaced.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mutateMock = vi.fn();
vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: [], isLoading: false }),
  useAddModel: () => ({ mutate: mutateMock, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock("../hooks/useSettings", () => ({
  useGenericCredentialList: () => ({ data: [], isLoading: false }),
}));
vi.mock("../lib/api", () => ({
  modelDiscover: async () => [
    {
      id: "kimi-for-coding",
      reported: {
        context_window: 1048576,
        image_input: true,
        video_input: true,
        thinking: { supported: true, efforts: ["low", "high", "max"], default_effort: "max" },
      },
      suggested: { max_output_tokens: 32768 },
    },
    {
      id: "glm-5.3",
      reported: {},
      suggested: {
        context_window: 1000000,
        max_output_tokens: 131072,
        pricing: { input_per_million: 0.75, output_per_million: 3.3 },
      },
    },
    { id: "glm-5.4", reported: {} },
  ],
}));

import AddModelModal from "../components/modals/AddModelModal";

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AddModelModal open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const field = (label: RegExp) => screen.getByLabelText(label);
const value = (id: string) => (screen.getByTestId(id) as HTMLInputElement).value;

async function pick(id: string) {
  const select = (await screen.findByTestId("endpoint-models", {}, { timeout: 2000 })) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: id } });
}

beforeEach(() => {
  mutateMock.mockReset();
  renderModal();
  fireEvent.change(field(/base url/i), { target: { value: "https://api.example.com/v1" } });
  fireEvent.change(field(/api key/i), { target: { value: "sk-test" } });
});

describe("filling in a picked model", () => {
  it("takes the endpoint's word first and models.dev's for the rest", async () => {
    await pick("kimi-for-coding");
    await waitFor(() => expect(value("add-model-context")).toBe("1048576"));
    expect(value("add-model-max-output")).toBe("32768");
    expect(screen.getByRole("checkbox", { name: /image/i })).toHaveAttribute("aria-checked", "true");
    const sources = screen.getByTestId("add-model-sources");
    expect(sources).toHaveTextContent(/provider's model list/i);
    expect(sources).toHaveTextContent(/models\.dev/i);

    fireEvent.click(screen.getByTestId("add-model-submit"));
    expect(mutateMock.mock.calls[0][0]).toMatchObject({
      model: ["kimi-for-coding"],
      contextWindow: 1048576,
      maxOutputTokens: 32768,
      spec: { image_input: true, video_input: true, audio_input: false },
    });
  });

  it("follows the pick, but keeps what was typed", async () => {
    await pick("kimi-for-coding");
    await waitFor(() => expect(value("add-model-context")).toBe("1048576"));
    fireEvent.change(screen.getByTestId("add-model-max-output"), { target: { value: "16000" } });
    await pick("glm-5.3");
    await waitFor(() => expect(value("add-model-context")).toBe("1000000"));
    expect(value("add-model-max-output")).toBe("16000");
    expect(screen.getByTestId("add-model-sources")).not.toHaveTextContent(/provider's model list/i);
    expect(screen.getByRole("checkbox", { name: /image/i })).toHaveAttribute("aria-checked", "false");
  });

  it("leaves the fields empty when nothing is known", async () => {
    await pick("glm-5.4");
    await waitFor(() => expect(field(/model id/i)).toHaveValue("glm-5.4"));
    expect(value("add-model-context")).toBe("");
    expect(screen.queryByTestId("add-model-sources")).toBeNull();
    fireEvent.click(screen.getByTestId("add-model-submit"));
    const args = mutateMock.mock.calls[0][0];
    expect(args.contextWindow).toBeUndefined();
    expect(args.spec).toBeUndefined();
  });

  it("offers the effort levels the model takes, and sends the one picked", async () => {
    await pick("kimi-for-coding");
    const effort = (await screen.findByTestId("model-effort")) as HTMLSelectElement;
    expect(Array.from(effort.options).map((o) => o.value)).toEqual(["", "low", "high", "max"]);
    expect(effort.value).toBe("");
    fireEvent.change(effort, { target: { value: "high" } });
    fireEvent.click(screen.getByTestId("add-model-submit"));
    expect(mutateMock.mock.calls[0][0]).toMatchObject({
      effort: "high",
      effortLevels: ["low", "high", "max"],
    });
  });

  it("shows no effort for a model with no levels, and drops one it does not take", async () => {
    await pick("kimi-for-coding");
    fireEvent.change(await screen.findByTestId("model-effort"), { target: { value: "max" } });
    await pick("glm-5.4");
    await waitFor(() => expect(screen.queryByTestId("model-effort")).toBeNull());
    fireEvent.click(screen.getByTestId("add-model-submit"));
    expect(mutateMock.mock.calls[0][0].effort).toBeUndefined();
    expect(mutateMock.mock.calls[0][0].effortLevels).toBeUndefined();
  });

  it("refuses a limit that is not a number of tokens", async () => {
    await pick("glm-5.4");
    fireEvent.change(screen.getByTestId("add-model-context"), { target: { value: "lots" } });
    expect(screen.getByTestId("add-model-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("add-model-context"), { target: { value: "200,000" } });
    expect(screen.getByTestId("add-model-submit")).toBeEnabled();
  });
});
