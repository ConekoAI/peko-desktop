import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

import { copyText } from "./copy";

/**
 * A reply rendered as GitHub-flavoured markdown. Sanitizing runs before
 * highlighting, so the only classes in the output are the highlighter's
 * own. Code blocks show their language and a copy button.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: false }]]}
        components={{ pre: CodeBlock }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Plain text of a rendered node tree (the highlighter splits code into spans). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, "");
  const className =
    children && typeof children === "object" && "props" in children
      ? String((children.props as { className?: string }).className ?? "")
      : "";
  const language = /language-([\w-]+)/.exec(className)?.[1];

  async function copy() {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between bg-surface-sunken px-3 py-1 text-[11px] text-fg-muted">
        <span>{language ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-sunken hover:text-fg-soft"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-surface-raised p-3 text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}
