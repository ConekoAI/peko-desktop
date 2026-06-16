import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Regression test for peko-desktop#1 (CSP / XSS).
 * Ensures that react-markdown + rehype-sanitize strips dangerous
 * inline event handlers and javascript: URLs from agent output.
 */

describe("Chat XSS sanitization", () => {
  it("strips onerror handlers from img tags", () => {
    const malicious = `<img src=x onerror="window.__TAURI__.invoke('shell', {cmd:'whoami'})">`;
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {malicious}
      </ReactMarkdown>
    );

    const img = document.querySelector("img");
    // rehype-sanitize should strip the entire raw HTML or at least the onerror
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    } else {
      // If the raw HTML is completely stripped, that's also acceptable
      expect(screen.queryByRole("img")).toBeNull();
    }
  });

  it("strips javascript: URLs from hrefs", () => {
    const malicious = `[click me](javascript:alert('xss'))`;
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {malicious}
      </ReactMarkdown>
    );

    const link = document.querySelector("a");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("strips inline script tags", () => {
    const malicious = `<script>alert('xss')</script>`;
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {malicious}
      </ReactMarkdown>
    );

    expect(container.querySelector("script")).toBeNull();
  });
});
