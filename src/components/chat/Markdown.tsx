import { useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import { Check, Code, Copy, Image as ImageIcon } from "lucide-react";

import { copyText } from "./copy";
import { AttachmentView, baseName } from "./Attachments";
import { attachmentOpen } from "../../lib/api";

/**
 * A reply rendered as GitHub-flavoured markdown. Sanitizing runs before
 * highlighting, so the only classes in the output are the highlighter's
 * own. Code blocks show their language and a copy button.
 *
 * Raw HTML is never rendered. The few embeds a reply means as media
 * become markdown images first (`remarkEmbeds`): inline `<svg>` markup,
 * and `<img>` / `<audio>` / `<video>` tags with a `src`. Every image
 * then goes through `MarkdownImage`, which shows `data:` images and SVG
 * through `<img>` (no scripts, nothing external), files on this computer
 * through the attachment viewer (confined to the pekos' folder), and
 * leaves remote URLs as links: loading them would tell a server that,
 * and when, the reply was read.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkEmbeds]}
        rehypePlugins={[[rehypeSanitize, SCHEMA], [rehypeHighlight, { detect: false }]]}
        urlTransform={urlTransform}
        components={{
          pre: CodeBlock,
          img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : ""} alt={alt} />,
          a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** The default schema, plus `data:` images and `file:` URLs (see `urlTransform`). */
const SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data", "file"],
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
};

/** react-markdown's filter, also keeping `data:image/…` sources and `file:` URLs. */
function urlTransform(url: string, key: string): string {
  if (key === "src" && /^data:image\//i.test(url)) return url;
  if (/^file:/i.test(url)) return url;
  return defaultUrlTransform(url);
}

/** SVG markup as a `data:` URL an `<img>` can show. */
export function svgDataUrl(markup: string): string {
  let svg = markup.trim();
  // An SVG document needs its namespace to render as an image.
  const openTag = svg.slice(0, svg.indexOf(">") + 1);
  if (!/\sxmlns\s*=/.test(openTag)) {
    svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The file on this computer a URL names, if it names one. */
export function localPath(url: string): string | null {
  let path: string;
  if (/^file:/i.test(url)) {
    try {
      path = decodeURIComponent(new URL(url).pathname);
    } catch {
      return null;
    }
    // file:///C:/x → C:/x
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  } else if (url.startsWith("/") && !url.startsWith("//")) {
    try {
      path = decodeURIComponent(url);
    } catch {
      path = url;
    }
  } else if (/^[A-Za-z]:[\\/]/.test(url)) {
    path = url;
  } else {
    return null;
  }
  return path;
}

// ─── Embeds ──────────────────────────────────────────────────────

/** The parts of an mdast node `remarkEmbeds` reads. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Parents whose children are blocks: an embed there needs a paragraph. */
const FLOW_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

const SVG_OPEN = /^\s*<svg[\s>/]/i;
const SVG_CLOSE = /<\/svg\s*>/gi;
const MEDIA_TAG = /^\s*<(img|audio|video)\b[^>]*>/i;

function attribute(html: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(html);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** `markup` up to its last `</svg>`, or null when it never closes. */
function closedSvg(markup: string): string | null {
  let end = -1;
  for (const match of markup.matchAll(SVG_CLOSE)) end = match.index + match[0].length;
  return end < 0 ? null : markup.slice(0, end);
}

/**
 * The image an HTML node at `children[i]` stands for, and how many
 * siblings it spans. SVG markup that a blank line split across several
 * nodes is read back from the source by position.
 */
function embedAt(
  children: MdNode[],
  i: number,
  source: string,
): { image: MdNode; count: number } | null {
  const node = children[i];
  const value = node.value ?? "";
  if (SVG_OPEN.test(value)) {
    const whole = closedSvg(value);
    if (whole) return { image: { type: "image", url: svgDataUrl(whole), alt: "SVG image" }, count: 1 };
    const start = node.position?.start.offset;
    if (start === undefined) return null;
    for (let j = i + 1; j < children.length; j++) {
      const end = children[j].position?.end.offset;
      if (end === undefined) return null;
      const markup = closedSvg(source.slice(start, end));
      if (markup) {
        return { image: { type: "image", url: svgDataUrl(markup), alt: "SVG image" }, count: j - i + 1 };
      }
    }
    return null;
  }
  const tag = MEDIA_TAG.exec(value);
  if (tag) {
    const src = attribute(value, "src");
    if (!src) return null;
    return { image: { type: "image", url: src, alt: attribute(tag[0], "alt") ?? "" }, count: 1 };
  }
  return null;
}

function replaceEmbeds(parent: MdNode, source: string) {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === "html") {
      const embed = embedAt(children, i, source);
      if (embed) {
        const replacement = FLOW_PARENTS.has(parent.type)
          ? { type: "paragraph", children: [embed.image] }
          : embed.image;
        children.splice(i, embed.count, replacement);
      }
      continue;
    }
    replaceEmbeds(node, source);
  }
}

/** Turn HTML media in a reply into markdown images (see `Markdown`). */
function remarkEmbeds() {
  return (tree: MdNode, file: { value?: unknown }) => {
    replaceEmbeds(tree, String(file.value ?? ""));
  };
}

// ─── Images and links ────────────────────────────────────────────

function MarkdownImage({ src, alt }: { src: string; alt?: string }) {
  if (/^data:image\//i.test(src)) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className="not-prose my-1 inline-block max-h-96 max-w-full rounded-lg border border-line bg-white object-contain"
      />
    );
  }
  const path = localPath(src);
  if (path) {
    return (
      <span className="not-prose my-1 inline-block align-bottom">
        <AttachmentView attachment={{ name: baseName(path), path, mime: "", size: 0 }} />
      </span>
    );
  }
  if (/^https?:/i.test(src)) {
    return (
      <a href={src} title={src} className="inline-flex items-center gap-1">
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        {alt || src}
      </a>
    );
  }
  return alt ? <span>{alt}</span> : null;
}

/** A link; one to a file on this computer opens it in its app. */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const path = href ? localPath(href) : null;
  if (path) {
    return (
      <button
        type="button"
        title={`Open ${baseName(path)}`}
        onClick={() => void attachmentOpen(path).catch(() => {})}
        className="text-brand underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </button>
    );
  }
  return <a href={href}>{children}</a>;
}

// ─── Code blocks ─────────────────────────────────────────────────

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
  // An SVG block shows the picture; its source is a click away.
  const isSvg = language?.toLowerCase() === "svg" && SVG_OPEN.test(code);
  const [showCode, setShowCode] = useState(!isSvg);

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
        <span className="flex items-center gap-1">
          {isSvg && (
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              aria-label={showCode ? "Show image" : "Show code"}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-sunken hover:text-fg-soft"
            >
              {showCode ? <ImageIcon className="h-3 w-3" /> : <Code className="h-3 w-3" />}
              {showCode ? "Image" : "Code"}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-sunken hover:text-fg-soft"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </div>
      {showCode ? (
        <pre className="overflow-x-auto bg-surface-raised p-3 text-[12.5px] leading-relaxed">
          {children}
        </pre>
      ) : (
        <div className="flex justify-center bg-white p-3">
          <img src={svgDataUrl(code)} alt="SVG image" className="max-h-96 max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
