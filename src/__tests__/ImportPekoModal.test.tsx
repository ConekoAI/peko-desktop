// Tests for the ADR-056 `.peko` import modal. Mocks `../lib/api` at
// the module boundary so the REAL `usePrincipalImport` hook runs —
// that keeps the `["principals"]` invalidation under test too.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const principalImportMock = vi.fn();
const principalImportPreviewMock = vi.fn();

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  principalImport: (...args: unknown[]) => principalImportMock(...args),
  principalImportPreview: (...args: unknown[]) => principalImportPreviewMock(...args),
}));

const PREVIEW = {
  name: "alice",
  version: "0.1.0",
  did: "did:key:z6Mk",
  description: "a test peko",
  agents: [],
  inventory: {
    did: "did:key:z6Mk",
    file_count: 12,
    hooks: [{ id: "log-tools", path: "hooks/log-tools/hook.toml", definition: "" }],
    mcp_servers: [],
    skills: ["notes"],
    executable_files: [],
  },
  manifest_checksum: "sha256:abc",
  validation_errors: [],
  validation_warnings: [],
};

/** Enter a path and run the Review step. */
async function review(path = "~/.peko/alice.peko") {
  fireEvent.change(screen.getByLabelText(/package path/i), {
    target: { value: path },
  });
  fireEvent.click(screen.getByTestId("import-peko-review"));
  await screen.findByTestId("import-peko-preview");
}

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
    principalImportPreviewMock.mockReset();
    principalImportPreviewMock.mockResolvedValue(PREVIEW);
  });

  it("distinguishes waking the SAME peko from growing a FRESH one from a seed", () => {
    renderModal();
    const copy = screen.getByText(/package wakes the/i).textContent;
    expect(copy).toMatch(/same/i);
    expect(copy).toMatch(/fresh/i);
    expect(copy).toMatch(/seed/i);
  });

  it("reviews the package first, then imports with the reviewed checksum", async () => {
    principalImportMock.mockResolvedValue({
      type: "principal_imported",
      name: "alice",
    });
    renderModal();
    const reviewBtn = screen.getByTestId("import-peko-review") as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(true);
    await review("  ~/.peko/alice.peko  ");
    expect(principalImportPreviewMock).toHaveBeenCalledWith({
      path: "~/.peko/alice.peko",
      rotateKeys: false,
    });
    // Everything that can run is listed before the user wakes it.
    expect(screen.getByText(/can run code on this computer/i)).toBeInTheDocument();
    expect(screen.getByText("hook log-tools")).toBeInTheDocument();
    expect(principalImportMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("import-peko-submit"));
    await waitFor(() => {
      expect(principalImportMock).toHaveBeenCalledWith({
        path: "~/.peko/alice.peko",
        manifestChecksum: "sha256:abc",
        rotateKeys: false,
      });
    });
  });

  it("blocks the import when the preview reports validation errors", async () => {
    principalImportPreviewMock.mockResolvedValue({
      ...PREVIEW,
      validation_errors: ["manifest checksum mismatch"],
    });
    renderModal();
    await review();
    expect(screen.getByText("manifest checksum mismatch")).toBeInTheDocument();
    expect((screen.getByTestId("import-peko-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the woken peko's name and invalidates the principals list on success", async () => {
    principalImportMock.mockResolvedValue({
      type: "principal_imported",
      name: "alice",
      config_path: "/home/u/.peko/principals/alice",
    });
    const { invalidateSpy } = renderModal();
    await review();
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
    await review();
    fireEvent.click(screen.getByTestId("import-peko-submit"));
    await screen.findByTestId("import-peko-error");
    expect(
      screen.getByText(/ground it with `peko create alice -s alice.seed.toml`/),
    ).toBeInTheDocument();
  });
});
