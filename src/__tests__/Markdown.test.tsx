// Replies render as sanitized markdown; code blocks are highlighted
// and copyable.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const copyMock = vi.fn(async (_text: string) => true);
vi.mock("../components/chat/copy", () => ({
  copyText: (text: string) => copyMock(text),
}));

const api = vi.hoisted(() => ({
  attachmentPreview: vi.fn(async (_path: string) => "data:image/png;base64,AAAA"),
  attachmentOpen: vi.fn(async (_path: string) => {}),
}));
vi.mock("../lib/api", () => api);
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Markdown, { localPath, svgDataUrl } from "../components/chat/Markdown";

function md(text: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Markdown>{text}</Markdown>
    </QueryClientProvider>,
  );
}

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

  it("draws inline SVG as an image, never as live markup", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" onclick="alert(1)"/></svg>';
    const { container } = md(`Here:\n\n${svg}\n\nDone.`);
    expect(container.querySelector("svg")).toBeNull();
    const img = screen.getByRole("img", { name: "SVG image" });
    const src = img.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(src)).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });

  it("joins SVG markup a blank line split", () => {
    md('<svg width="4" height="4">\n<rect width="4" height="4"/>\n\n<circle r="1"/>\n</svg>');
    const src = decodeURIComponent(screen.getByRole("img").getAttribute("src") ?? "");
    expect(src).toContain("<rect");
    expect(src).toContain("<circle");
    expect(src.trim().endsWith("</svg>")).toBe(true);
  });

  it("previews an svg code block and shows its code on demand", () => {
    const { container } = md("```svg\n<svg><rect width='1' height='1'/></svg>\n```");
    expect(screen.getByRole("img", { name: "SVG image" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show code" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("rect width");
  });

  it("shows data: images, and files on this computer through the attachment viewer", async () => {
    md("![dot](data:image/png;base64,AAAA) and ![chart](/Users/me/.peko/principals/p/workspace/chart.png)");
    expect(screen.getByRole("img", { name: "dot" })).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(await screen.findByRole("img", { name: "chart.png" })).toBeInTheDocument();
    expect(api.attachmentPreview).toHaveBeenCalledWith("/Users/me/.peko/principals/p/workspace/chart.png");
  });

  it("plays audio and video named by an image or an HTML tag", () => {
    md('![memo](/p/memo.mp3)\n\n<video src="file:///p/clip%20one.mp4" controls></video>');
    expect(screen.getByRole("button", { name: "Play memo.mp3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play clip one.mp4" }));
    expect(screen.getByLabelText("clip one.mp4").tagName).toBe("VIDEO");
  });

  it("leaves remote images as links and opens local files from links", () => {
    const { container } = md("![logo](https://example.com/x.png) see [the report](/p/report.pdf)");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: /logo/ })).toHaveAttribute("href", "https://example.com/x.png");
    fireEvent.click(screen.getByRole("button", { name: "the report" }));
    expect(api.attachmentOpen).toHaveBeenCalledWith("/p/report.pdf");
  });

  it("refuses non-image data: URLs", () => {
    const { container } = md("![x](data:text/html,<b>hi</b>)");
    expect(container.querySelector("img")).toBeNull();
  });

  it("finds local paths in file URLs and absolute paths only", () => {
    expect(localPath("file:///Users/me/a%20b.png")).toBe("/Users/me/a b.png");
    expect(localPath("file:///C:/x/y.png")).toBe("C:/x/y.png");
    expect(localPath("/tmp/x.png")).toBe("/tmp/x.png");
    expect(localPath("C:\\x\\y.png")).toBe("C:\\x\\y.png");
    expect(localPath("//cdn/x.png")).toBeNull();
    expect(localPath("https://x/y.png")).toBeNull();
    expect(localPath("relative.png")).toBeNull();
    expect(svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')).not.toContain("xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20xmlns");
  });
});
