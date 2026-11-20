import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  principalAccess: vi.fn(),
  principalSetAccess: vi.fn(),
  pickSharedPath: vi.fn(),
}));
vi.mock("../lib/api", () => api);

import SharingPanel, { personLabel } from "../components/peko/SharingPanel";
import type { PekoAccess } from "../types";

const everyone = {
  tools: ["Read", "Glob", "Fetch"],
  mcp: [],
  read: ["public/", "kb/CONVENTIONS.md"],
  write: [],
  ask_owner: false,
};

function access(overrides: Partial<PekoAccess> = {}): PekoAccess {
  return {
    visitors: everyone,
    people: [],
    known: [{ address: "visitor:local:+15550100", display_name: "Ada" }],
    servers: ["orders"],
    workspace: "/home/me/.peko/pekos/desk",
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("SharingPanel", () => {
  it("shows what everyone reaches", async () => {
    api.principalAccess.mockResolvedValue(access());
    wrap(<SharingPanel name="desk" />);
    expect(await screen.findByText("public/")).toBeInTheDocument();
    expect(screen.getByText("kb/CONVENTIONS.md")).toBeInTheDocument();
    expect(screen.getByTestId("sharing-everyone-web")).toBeChecked();
    expect(screen.getByTestId("sharing-everyone-service-orders")).not.toBeChecked();
    expect(screen.getByLabelText("When they ask for more")).toHaveValue("refuse");
    expect(screen.getByTestId("sharing-save")).toBeDisabled();
  });

  it("adds a shared folder and a service, then saves", async () => {
    api.principalAccess.mockResolvedValue(access());
    api.pickSharedPath.mockResolvedValue("menu/");
    api.principalSetAccess.mockImplementation(async (_n, visitors, people) =>
      access({ visitors, people }),
    );
    wrap(<SharingPanel name="desk" />);
    fireEvent.click(await screen.findByTestId("sharing-everyone-read-folder"));
    expect(await screen.findByText("menu/")).toBeInTheDocument();
    expect(api.pickSharedPath).toHaveBeenCalledWith("/home/me/.peko/pekos/desk", true);
    fireEvent.click(screen.getByTestId("sharing-everyone-service-orders"));
    fireEvent.change(screen.getByLabelText("When they ask for more"), { target: { value: "ask" } });

    fireEvent.click(screen.getByTestId("sharing-save"));
    await waitFor(() => expect(api.principalSetAccess).toHaveBeenCalled());
    const [name, visitors, people] = api.principalSetAccess.mock.calls[0];
    expect(name).toBe("desk");
    expect(visitors.read).toEqual(["public/", "kb/CONVENTIONS.md", "menu/"]);
    expect(visitors.mcp).toEqual(["orders"]);
    expect(visitors.ask_owner).toBe(true);
    expect(people).toEqual([]);
    expect(await screen.findByTestId("sharing-saved")).toBeInTheDocument();
  });

  it("says when a picked file is outside the peko's folder", async () => {
    api.principalAccess.mockResolvedValue(access());
    api.pickSharedPath.mockResolvedValue("outside");
    wrap(<SharingPanel name="desk" />);
    fireEvent.click(await screen.findByTestId("sharing-everyone-read-file"));
    expect(await screen.findByText("Choose something inside desk's folder.")).toBeInTheDocument();
    expect(screen.getByTestId("sharing-save")).toBeDisabled();
  });

  it("gives someone their own rules, starting from everyone's", async () => {
    api.principalAccess.mockResolvedValue(access());
    api.principalSetAccess.mockImplementation(async (_n, visitors, people) =>
      access({ visitors, people }),
    );
    wrap(<SharingPanel name="desk" />);
    fireEvent.change(await screen.findByTestId("sharing-add-person"), {
      target: { value: "visitor:local:+15550100" },
    });
    const person = await screen.findByTestId("sharing-person");
    expect(within(person).getByText("Ada")).toBeInTheDocument();
    expect(within(person).getByText("public/")).toBeInTheDocument();
    fireEvent.click(within(person).getByTestId("sharing-person-0-web"));

    fireEvent.click(screen.getByTestId("sharing-save"));
    await waitFor(() => expect(api.principalSetAccess).toHaveBeenCalled());
    const calls = api.principalSetAccess.mock.calls;
    const [, visitors, people] = calls[calls.length - 1];
    expect(visitors).toEqual(everyone);
    expect(people).toHaveLength(1);
    expect(people[0].address).toBe("visitor:local:+15550100");
    expect(people[0].rule.tools).toEqual(["Read", "Glob"]);
  });

  it("shows the runtime's refusal and keeps the change", async () => {
    api.principalAccess.mockResolvedValue(access());
    api.pickSharedPath.mockResolvedValue("contacts/");
    api.principalSetAccess.mockRejectedValue(
      new Error("the change would not be valid: `contacts/` holds each conversation's own folder"),
    );
    wrap(<SharingPanel name="desk" />);
    fireEvent.click(await screen.findByTestId("sharing-everyone-read-folder"));
    fireEvent.click(await screen.findByTestId("sharing-save"));
    expect(await screen.findByTestId("sharing-save-error")).toHaveTextContent("would not be valid");
    expect(screen.getByText("contacts/")).toBeInTheDocument();
  });

  it("explains a rules file it cannot edit", async () => {
    api.principalAccess.mockResolvedValue(access({ problem: "expected `]`" }));
    wrap(<SharingPanel name="desk" />);
    expect(await screen.findByTestId("sharing-problem")).toHaveTextContent("expected `]`");
    expect(screen.queryByTestId("sharing-save")).not.toBeInTheDocument();
  });

  it("names people by their name, else their address", () => {
    expect(personLabel({ address: "visitor:local:+15550100", display_name: "Ada" })).toBe("Ada");
    expect(personLabel({ address: "visitor:local:+15550100" })).toBe("+15550100");
    expect(personLabel({ address: "user:hub:3f2a" })).toBe("hub:3f2a");
  });
});

describe("relativeTo", () => {
  it("makes a picked path relative to the peko's folder", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    expect(actual.relativeTo("/w/desk", "/w/desk/menu", true)).toBe("menu/");
    expect(actual.relativeTo("/w/desk/", "/w/desk/public/faq.md", false)).toBe("public/faq.md");
    expect(actual.relativeTo("C:\\w\\desk", "C:\\w\\desk\\menu", true)).toBe("menu/");
    expect(actual.relativeTo("/w/desk", "/w/desk-other/x", false)).toBe("outside");
    expect(actual.relativeTo("/w/desk", "/w/desk", true)).toBe("outside");
  });
});
