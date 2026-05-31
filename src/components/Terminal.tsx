import { useMemo } from "react";

interface TerminalProps {
  lines: string[];
  className?: string;
}

const ANSI_REGEX =
  /\u001b\[(\d+)(?:;(\d+))*m/g;

const COLOR_MAP: Record<string, string> = {
  "30": "ansi-black",
  "31": "ansi-red",
  "32": "ansi-green",
  "33": "ansi-yellow",
  "34": "ansi-blue",
  "35": "ansi-magenta",
  "36": "ansi-cyan",
  "37": "ansi-white",
  "90": "ansi-bright-black",
  "91": "ansi-bright-red",
  "92": "ansi-bright-green",
  "93": "ansi-bright-yellow",
  "94": "ansi-bright-blue",
  "95": "ansi-bright-magenta",
  "96": "ansi-bright-cyan",
  "97": "ansi-bright-white",
};

function parseAnsi(text: string): Array<{ text: string; className: string }> {
  const parts: Array<{ text: string; className: string }> = [];
  let lastIndex = 0;
  let currentClass = "";
  let match: RegExpExecArray | null;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), className: currentClass });
    }
    const codes = match.slice(1).filter(Boolean);
    if (codes.includes("0")) {
      currentClass = "";
    }
    for (const code of codes) {
      if (COLOR_MAP[code]) {
        currentClass = COLOR_MAP[code];
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), className: currentClass });
  }

  return parts;
}

export default function Terminal({ lines, className = "" }: TerminalProps) {
  const rendered = useMemo(() => {
    return lines.map((line, i) => {
      const segments = parseAnsi(line);
      return (
        <div key={i} className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
          {segments.map((seg, j) => (
            <span key={j} className={seg.className}>
              {seg.text || "\u00A0"}
            </span>
          ))}
        </div>
      );
    });
  }, [lines]);

  return (
    <div
      className={[
        "overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 text-slate-100 dark:border-slate-800",
        className,
      ].join(" ")}
    >
      {rendered}
    </div>
  );
}
