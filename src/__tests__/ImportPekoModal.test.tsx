// Tests for the ADR-056 `.peko` import modal. Mocks `../lib/api` at
// the module boundary so the REAL `usePrincipalImport` hook runs —
// that keeps the `["principals"]` invalidation under test too.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalImportMock = vi.fn();

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  principalImport: (...args: unknown[]) => principalImportMock(...args),
}));

import ImportPekoModal from "../components/modals/ImportPekoModal";

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return {
    invalidateSpy,
    ...render(
      <QueryClientProvider client={qc}>
        <ImportPekoModal open onClose={vi.fn()} />
      </QueryClientProvider>,
    ),
  };
}

describe("ImportPekoModal", () => {
  beforeEach(() => {
    principalImportMock.mockReset();
  });

  it("distinguishes waking the SAME peko from growing a FRESH one from a seed", () => {
    renderModal();
    const copy = screen.getByText(/package wakes the/i).textContent;
    expect(copy).toMatch(/same/i);
    expect(copy).toMatch(/fresh/i);
    expect(copy).toMatch(/seed/i);
  });

  it("keeps Import disabled until a package path is entered, then submits the trimmed path", async () => {
    principalImportMock.mockResolvedValue({
      type: "principal_imported",
      name: "alice",
    });
    renderModal();
    const submit = screen.getByTestId("import-peko-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/package path/i), {
      target: { value: "  ~/.peko/alice.peko  " },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(principalImportMock).toHaveBeenCalledWith({
        path: "~/.peko/alice.peko",
      });
    });
  });

  it("shows the woken peko's name and invalidates the principals list on success", async () => {
    principalImportMock.mockResolvedValue({
      type: "principal_imported",
      name: "alice",
      config_path: "/home/u/.peko/principals/alice",
    });
    const { invalidateSpy } = renderModal();
    fireEvent.change(screen.getByLabelText(/package path/i), {
      target: { value: "~/.peko/alice.peko" },
    });
    fireEvent.click(screen.getByTestId("import-peko-submit"));
    await screen.findByTestId("import-peko-success");
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["principals"],
    });
  });

  it("renders runtime errors verbatim (keyless packages carry the 'peko create' grounding guidance)", async () => {
    principalImportMock.mockRejectedValue(
      new Error(
        "package has no keys — ground it with `peko create alice -s alice.seed.toml`",
      ),
    );
    renderModal();
    fireEvent.change(screen.getByLabelText(/package path/i), {
      target: { value: "~/.peko/alice.peko" },
    });
    fireEvent.click(screen.getByTestId("import-peko-submit"));
    await screen.findByTestId("import-peko-error");
    expect(
      screen.getByText(/ground it with `peko create alice -s alice.seed.toml`/),
    ).toBeInTheDocument();
  });
});
