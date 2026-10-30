import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { File, FileText, Film, Image as ImageIcon, Loader2, Music, Play, X } from "lucide-react";

import { attachmentOpen, attachmentPreview } from "../../lib/api";
import type { ChatLogAttachment } from "../../types";

/** At most this many files per message (the engine's limit). */
export const MAX_ATTACHMENTS = 8;

type Kind = "image" | "audio" | "video" | "text" | "file";

const EXTENSION_KIND: Record<string, Kind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  wav: "audio",
  mp3: "audio",
  flac: "audio",
  m4a: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  avi: "video",
  wmv: "video",
  webm: "video",
  txt: "text",
  md: "text",
  csv: "text",
  json: "text",
  pdf: "text",
};

/** What a file is, by MIME type when known, else by extension. */
export function attachmentKind(nameOrPath: string, mime?: string): Kind {
  if (mime?.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("text/") || mime === "application/pdf") return "text";
  if (mime && mime !== "application/octet-stream") return "file";
  const ext = nameOrPath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_KIND[ext] ?? "file";
}

/** The file name at the end of a path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ICONS: Record<Kind, typeof File> = {
  image: ImageIcon,
  audio: Music,
  video: Film,
  text: FileText,
  file: File,
};

const CHIP =
  "inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-line bg-surface-card px-2 py-1 text-xs text-fg-soft";

/** Files chosen for the next message, each removable. */
export function PendingAttachments({
  paths,
  onRemove,
}: {
  paths: string[];
  onRemove: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="flex flex-wrap gap-1.5 px-3 pt-3">
      {paths.map((path) => {
        const name = baseName(path);
        const Icon = ICONS[attachmentKind(name)];
        return (
          <li key={path} className={CHIP} title={path}>
            <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            <span className="truncate">{name}</span>
            <button
              type="button"
              onClick={() => onRemove(path)}
              aria-label={`Remove ${name}`}
              className="-mr-0.5 rounded p-0.5 text-fg-subtle hover:bg-surface-sunken hover:text-fg-soft"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thumbnail({ attachment }: { attachment: ChatLogAttachment }) {
  const preview = useQuery({
    queryKey: ["attachment-preview", attachment.path],
    queryFn: () => attachmentPreview(attachment.path),
    staleTime: Infinity,
    retry: false,
  });
  // An image the webview cannot decode shows as a file instead.
  const [broken, setBroken] = useState(false);
  if (!preview.data || broken) return <FileChip attachment={attachment} />;
  return (
    <button
      type="button"
      onClick={() => void attachmentOpen(attachment.path)}
      title={`Open ${attachment.name}`}
      className="overflow-hidden rounded-lg border border-line hover:opacity-90"
    >
      <img
        src={preview.data}
        alt={attachment.name}
        onError={() => setBroken(true)}
        className="block max-h-48 max-w-[16rem] object-contain"
      />
    </button>
  );
}

function FileChip({ attachment }: { attachment: ChatLogAttachment }) {
  const Icon = ICONS[attachmentKind(attachment.name, attachment.mime)];
  return (
    <button
      type="button"
      onClick={() => void attachmentOpen(attachment.path)}
      title={`Open ${attachment.name}`}
      className={`${CHIP} hover:bg-surface-sunken`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      <span className="truncate">{attachment.name}</span>
      {attachment.size > 0 && (
        <span className="shrink-0 text-fg-subtle">{formatSize(attachment.size)}</span>
      )}
    </button>
  );
}

/**
 * A `blob:` URL for a `data:` URL's bytes, released when unused. WebKit
 * will not play audio or video from a `data:` URL.
 */
function useBlobUrl(dataUrl: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!dataUrl) return;
    const comma = dataUrl.indexOf(",");
    const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const next = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [dataUrl]);
  return url;
}

/**
 * Audio or video: its chip, and a play button that loads the file into
 * an inline player (loaded only on demand; files can be large).
 */
function Playable({ attachment, kind }: { attachment: ChatLogAttachment; kind: "audio" | "video" }) {
  const [playing, setPlaying] = useState(false);
  const source = useQuery({
    queryKey: ["attachment-preview", attachment.path],
    queryFn: () => attachmentPreview(attachment.path),
    enabled: playing,
    staleTime: Infinity,
    retry: false,
  });
  const blobUrl = useBlobUrl(source.data);
  if (playing && blobUrl) {
    return kind === "audio" ? (
      <audio controls autoPlay src={blobUrl} aria-label={attachment.name} className="h-9 max-w-[18rem]" />
    ) : (
      <video controls autoPlay src={blobUrl} aria-label={attachment.name} className="max-h-64 max-w-[22rem] rounded-lg border border-line" />
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPlaying(true)}
        disabled={playing && !source.error}
        aria-label={`Play ${attachment.name}`}
        title={source.error ? "Can't play this here; open it instead" : `Play ${attachment.name}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-60"
      >
        {playing && !source.error ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <FileChip attachment={attachment} />
    </span>
  );
}

/** A sent message's files: images as thumbnails, the rest as chips. */
export function MessageAttachments({ attachments }: { attachments: ChatLogAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
      {attachments.map((a) => {
        const kind = attachmentKind(a.name, a.mime);
        if (kind === "image") return <Thumbnail key={a.path} attachment={a} />;
        if (kind === "audio" || kind === "video") {
          return <Playable key={a.path} attachment={a} kind={kind} />;
        }
        return <FileChip key={a.path} attachment={a} />;
      })}
    </div>
  );
}
