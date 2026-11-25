import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import YourNameSetting from "../components/YourNameSetting";

const person: { data: { name: string | null; handle: string | null } | undefined } = {
  data: undefined,
};
const mutate = vi.fn();
const setName: { mutate: typeof mutate; isPending: boolean; error: Error | null } = {
  mutate,
  isPending: false,
  error: null,
};

vi.mock("../hooks/usePrincipals", () => ({
  useLocalPerson: () => person,
  useSetPersonName: () => setName,
}));

// Runtime ADR-124: you choose what you are called.
describe("YourNameSetting", () => {
  beforeEach(() => {
    mutate.mockReset();
    setName.error = null;
    person.data = { name: "maya", handle: null };
  });

  it("starts from your name and saves a new one, tidied", () => {
    render(<YourNameSetting />);
    const input = screen.getByTestId("your-name-input") as HTMLInputElement;
    expect(input.value).toBe("maya");
    expect(screen.getByText(/stays on this computer/i)).toBeInTheDocument();
    const save = screen.getByTestId("your-name-save");
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: "  Maya   Lin " } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(mutate).toHaveBeenCalledWith("Maya Lin");
  });

  it("names your handle once signed in, and says why PekoHub refused", () => {
    person.data = { name: "Maya Lin", handle: "maya" };
    setName.error = new Error("PekoHub did not take the name (HTTP 400 Bad Request): too long");
    render(<YourNameSetting />);
    expect(screen.getByText(/@maya stays the same/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("too long");
  });

  it("saves nothing blank or unchanged", () => {
    render(<YourNameSetting />);
    const input = screen.getByTestId("your-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(screen.getByTestId("your-name-setting"));
    fireEvent.change(input, { target: { value: "maya" } });
    fireEvent.submit(screen.getByTestId("your-name-setting"));
    expect(mutate).not.toHaveBeenCalled();
  });
});
