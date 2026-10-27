// Replies render as sanitized markdown; code blocks are highlighted
// and copyable.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const copyMock = vi.fn(async (_text: string) => true);
vi.mock("../components/chat/copy", () => ({
  copyText: (text: string) => copyMock(text),
}));

import Markdown from "../components/chat/Markdown";

describe("Markdown", () => {
  it("highlights a fenced block with a language and copies its plain text", async () => {
    const { container } = render(
      <Markdown>{"Run:\n\n```python\ndef hi():\n    return 1\n```\n"}</Markdown>,
    );
    expect(screen.getByText("python")).toBeInTheDocument();
    // The highlighter tags tokens with hljs classes.
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("def");

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(copyMock).toHaveBeenCalledWith("def hi():\n    return 1"));
  });

  it("leaves a block without a language unhighlighted", () => {
    const { container } = render(<Markdown>{"```\nplain text\n```"}</Markdown>);
    expect(screen.getByText("code")).toBeInTheDocument();
    expect(container.querySelector("[class*='hljs-']")).toBeNull();
  });

  it("strips raw HTML", () => {
    const { container } = render(
      <Markdown>{'<img src=x onerror="alert(1)"> and <script>bad()</script> **bold**'}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});
