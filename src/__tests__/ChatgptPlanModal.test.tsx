// Use a ChatGPT plan (runtime ADR-115): the engine runs the sign-in; the
// dialog opens the browser, waits, then adds the plan's models.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mutateMock = vi.fn();
const modelsState: { data: unknown[] } = { data: [] };
const startMock = vi.fn();
const statusMock = vi.fn();
const cancelMock = vi.fn();
const openUrlMock = vi.fn();

vi.mock("../hooks/useModels", () => ({
  useModels: () => ({ data: modelsState.data, isLoading: false }),
  useAddModel: () => ({ mutate: mutateMock, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock("../lib/api", () => ({
  chatgptSignInStart: () => startMock(),
  chatgptSignInStatus: (flowId: string, pasted?: string) => statusMock(flowId, pasted),
  chatgptSignInCancel: (flowId: string) => cancelMock(flowId),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrlMock(url) }));

import ChatgptPlanModal, { PLAN_BASE_URL } from "../components/modals/ChatgptPlanModal";

const DONE = {
  state: "done",
  credentialId: "cred-1",
  account: "you@example.com",
  models: [
    {
      slug: "gpt-6.2-sol",
      displayName: "GPT-6.2-Sol",
      reported: { context_window: 272000 },
      suggested: { max_output_tokens: 128000 },
    },
    { slug: "gpt-6-luna", displayName: "GPT-6-Luna" },
  ],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mutateMock.mockReset();
  startMock.mockReset().mockResolvedValue({ flowId: "flow-1", url: "https://auth.openai.com/x" });
  statusMock.mockReset().mockResolvedValue({ state: "waiting" });
  cancelMock.mockReset().mockResolvedValue(undefined);
  openUrlMock.mockReset().mockResolvedValue(undefined);
  modelsState.data = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatgptPlanModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<ChatgptPlanModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts a sign-in, opens the browser, and waits", async () => {
    render(<ChatgptPlanModal open onClose={vi.fn()} />);
    await flush();
    expect(openUrlMock).toHaveBeenCalledWith("https://auth.openai.com/x");
    expect(screen.getByTestId("chatgpt-plan-waiting")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(statusMock).toHaveBeenCalledWith("flow-1", undefined);
  });

  it("hands over a pasted address", async () => {
    render(<ChatgptPlanModal open onClose={vi.fn()} />);
    await flush();
    fireEvent.change(screen.getByLabelText(/another computer/i), {
      target: { value: " http://127.0.0.1:5/auth/callback?code=c " },
    });
    fireEvent.click(screen.getByRole("button", { name: /use address/i }));
    await flush();
    expect(statusMock).toHaveBeenCalledWith("flow-1", "http://127.0.0.1:5/auth/callback?code=c");
  });

  it("lists the plan's models and adds one on the plan credential", async () => {
    statusMock.mockResolvedValue(DONE);
    modelsState.data = [
      { id: "luna", displayName: "Luna", modelId: "gpt-6-luna", credentialId: "cred-1" },
    ];
    render(<ChatgptPlanModal open onClose={vi.fn()} />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await flush();
    expect(screen.getByTestId("chatgpt-plan-done")).toHaveTextContent("you@example.com");
    // Already on the plan: says under which name, no button.
    expect(screen.queryByTestId("chatgpt-plan-add-gpt-6-luna")).toBeNull();
    expect(screen.getByTestId("chatgpt-plan-added-gpt-6-luna")).toHaveTextContent("Luna");
    fireEvent.click(screen.getByTestId("chatgpt-plan-add-gpt-6.2-sol"));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        custom: true,
        name: "gpt-6.2-sol",
        displayName: "GPT-6.2-Sol",
        apiFormat: "responses",
        baseUrl: PLAN_BASE_URL,
        model: ["gpt-6.2-sol"],
        credentialId: "cred-1",
        // The plan's own limit; a suggestion is not added unseen.
        contextWindow: 272000,
      }),
      expect.anything(),
    );
    expect(mutateMock.mock.calls[0][0].maxOutputTokens).toBeUndefined();
  });

  it("adds -plan only when the model's own name is taken", async () => {
    statusMock.mockResolvedValue(DONE);
    modelsState.data = [{ id: "gpt-6.2-sol", modelId: "gpt-6.2-sol", credentialId: "api-key" }];
    render(<ChatgptPlanModal open onClose={vi.fn()} />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await flush();
    fireEvent.click(screen.getByTestId("chatgpt-plan-add-gpt-6.2-sol"));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "gpt-6.2-sol-plan", credentialId: "cred-1" }),
      expect.anything(),
    );
  });

  it("cancels a waiting sign-in when closed", async () => {
    const onClose = vi.fn();
    render(<ChatgptPlanModal open onClose={onClose} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelMock).toHaveBeenCalledWith("flow-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows why a sign-in failed and can try again", async () => {
    statusMock.mockResolvedValue({ state: "failed", message: "ChatGPT sign-in was declined" });
    render(<ChatgptPlanModal open onClose={vi.fn()} />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await flush();
    expect(screen.getByTestId("chatgpt-plan-failed")).toHaveTextContent("declined");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await flush();
    expect(startMock).toHaveBeenCalledTimes(2);
  });
});
