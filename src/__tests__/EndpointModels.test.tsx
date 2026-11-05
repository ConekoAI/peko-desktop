// The endpoint form asks the endpoint for its models once the base URL
// and key are in, so the model id is picked rather than typed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const discoverMock = vi.fn(async (..._args: unknown[]) => ["gpt-4o", "gpt-5"]);
vi.mock("../lib/api", () => ({
  modelDiscover: (...args: unknown[]) => discoverMock(...args),
}));

import EndpointForm, { EMPTY_ENDPOINT, type EndpointDraft } from "../components/models/EndpointForm";

let latest: EndpointDraft = EMPTY_ENDPOINT;
function Harness() {
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_ENDPOINT);
  latest = draft;
  return <EndpointForm value={draft} onChange={setDraft} />;
}

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

const field = (label: RegExp) => screen.getByLabelText(label);

beforeEach(() => {
  discoverMock.mockClear();
  discoverMock.mockImplementation(async () => ["gpt-4o", "gpt-5"]);
  latest = EMPTY_ENDPOINT;
});

describe("models from the endpoint", () => {
  it("asks nothing until the base URL and key are in", async () => {
    renderForm();
    fireEvent.change(field(/base url/i), { target: { value: "https://api.example.com/v1" } });
    await new Promise((r) => setTimeout(r, 700));
    expect(discoverMock).not.toHaveBeenCalled();
  });

  it("lists the endpoint's models and picks one into the model id", async () => {
    renderForm();
    fireEvent.change(field(/base url/i), { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(field(/api key/i), { target: { value: " sk-test " } });
    const select = (await screen.findByTestId("endpoint-models", {}, { timeout: 2000 })) as HTMLSelectElement;
    expect(discoverMock).toHaveBeenCalledWith("https://api.example.com/v1", "openai", "sk-test");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "gpt-4o", "gpt-5"]);
    fireEvent.change(select, { target: { value: "gpt-5" } });
    expect(latest.modelId).toBe("gpt-5");
    expect((field(/model id/i) as HTMLInputElement).value).toBe("gpt-5");
  });

  it("fills in an endpoint's only model", async () => {
    discoverMock.mockImplementation(async () => ["llama3.2"]);
    renderForm();
    fireEvent.change(field(/base url/i), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.change(field(/api key/i), { target: { value: "k" } });
    await waitFor(() => expect(latest.modelId).toBe("llama3.2"), { timeout: 2000 });
  });

  it("says when the list can't be had, and typing still works", async () => {
    discoverMock.mockImplementation(async () => {
      throw new Error("HTTP 404: endpoint not found");
    });
    renderForm();
    fireEvent.change(field(/base url/i), { target: { value: "https://gw.example.com/anthropic" } });
    fireEvent.change(field(/api key/i), { target: { value: "k" } });
    expect(
      await screen.findByTestId("endpoint-models-error", {}, { timeout: 2000 }),
    ).toHaveTextContent("HTTP 404");
    fireEvent.change(field(/model id/i), { target: { value: "mimo-v2.6-flash" } });
    expect(latest.modelId).toBe("mimo-v2.6-flash");
  });
});
