import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  principalUsage: vi.fn(),
  principalSetLimits: vi.fn(),
}));
vi.mock("../lib/api", () => api);

import UsagePanel, { formatTokens, formatUsd } from "../components/peko/UsagePanel";

function usage(cost: number, budget?: number) {
  return {
    state: {
      window_start: "2026-10-30T00:00:00Z",
      window_end: "2026-10-31T00:00:00Z",
      cycle: "daily",
      input_tokens: 81676,
      output_tokens: 19,
      request_count: 2,
      cost_usd: cost,
    },
    config: { cycle: "daily", ...(budget != null && { budget_per_cycle: budget }) },
  };
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("UsagePanel", () => {
  it("formats money and tokens", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.0915)).toBe("$0.09");
    expect(formatTokens(81676)).toBe("81.7K");
  });

  it("shows spend against the budget and says when it is over", async () => {
    api.principalUsage.mockResolvedValue(usage(0.0915, 0.06));
    wrap(<UsagePanel name="seer" priced />);
    expect(await screen.findByTestId("usage-spend")).toHaveTextContent("$0.09 of $0.06 budget");
    expect(screen.getByTestId("usage-over-budget")).toBeInTheDocument();
    expect(screen.getByText(/81.7K in · 19 out · 2 requests/)).toBeInTheDocument();
  });

  it("sets a budget, keeping the other limits", async () => {
    api.principalUsage.mockResolvedValue({
      ...usage(0.01),
      config: { cycle: "daily", input_tokens: 500000 },
    });
    api.principalSetLimits.mockResolvedValue(usage(0.01, 5));
    wrap(<UsagePanel name="seer" priced={false} />);
    expect(await screen.findByText(/once the peko's model has a price/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Budget period"), { target: { value: "monthly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.principalSetLimits).toHaveBeenCalledWith("seer", {
        cycle: "monthly",
        input_tokens: 500000,
        budget_per_cycle: 5,
      }),
    );
  });
});
