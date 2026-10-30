import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  attachmentPreview: vi.fn(),
  attachmentOpen: vi.fn(),
}));
vi.mock("../hooks/useRemotePrincipals", () => ({
  useRemotePrincipals: () => ({ data: [] }),
  useRemotePeko: (_runtimeId: string, name: string) => ({
    record: undefined,
    status: { data: undefined },
    identity: { name, avatar: null, initials: name.slice(0, 1).toUpperCase(), accent: "emerald" },
    description: null,
  }),
}));

vi.mock("../lib/api", () => api);
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

import {
  MessageAttachments,
  PendingAttachments,
  attachmentKind,
  baseName,
  formatSize,
} from "../components/chat/Attachments";
import Composer from "../components/chat/Composer";
import { chatLogMessagesToChatItems } from "../pages/Chat";
import { inputsOf, withInputs } from "../lib/model-spec";

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("attachments", () => {
  it("tells kinds by MIME type, else by extension", () => {
    expect(attachmentKind("a.bin", "image/png")).toBe("image");
    expect(attachmentKind("a.bin", "audio/wav")).toBe("audio");
    expect(attachmentKind("a.bin", "video/mp4")).toBe("video");
    expect(attachmentKind("/x/clip.MOV")).toBe("video");
    expect(attachmentKind("/x/notes.md")).toBe("text");
    expect(attachmentKind("/x/blob")).toBe("file");
    expect(baseName("/Users/me/Desktop/photo one.png")).toBe("photo one.png");
    expect(formatSize(1_258_291)).toBe("1.2 MB");
  });

  it("lists files for the next message and removes one", () => {
    const onRemove = vi.fn();
    render(<PendingAttachments paths={["/a/photo.png", "/a/voice.wav"]} onRemove={onRemove} />);
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove voice.wav" }));
    expect(onRemove).toHaveBeenCalledWith("/a/voice.wav");
  });

  it("shows an image as a thumbnail and opens other files", async () => {
    api.attachmentPreview.mockResolvedValue("data:image/png;base64,AAAA");
    wrap(
      <MessageAttachments
        attachments={[
          { name: "photo.png", path: "/p/photo.png", mime: "image/png", size: 10 },
          { name: "voice.wav", path: "/p/voice.wav", mime: "audio/wav", size: 2048 },
        ]}
      />,
    );
    expect(await screen.findByRole("img", { name: "photo.png" })).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
    fireEvent.click(screen.getByTitle("Open voice.wav"));
    expect(api.attachmentOpen).toHaveBeenCalledWith("/p/voice.wav");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("sends files alone and offers the paperclip only when attaching works", () => {
    const onSend = vi.fn();
    const onAttach = vi.fn();
    const props = {
      value: "",
      onChange: () => {},
      onSend,
      onStop: () => {},
      busy: false,
      stopping: false,
      models: [],
      model: null,
      onModelChange: () => {},
    };
    const { rerender } = render(<Composer {...props} />);
    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    rerender(<Composer {...props} attachments={["/a/clip.mp4"]} onAttach={onAttach} />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(onAttach).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalled();
  });

  it("hands pasted files to the chat", () => {
    const onPasteFiles = vi.fn();
    render(
      <Composer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        busy={false}
        stopping={false}
        models={[]}
        model={null}
        onModelChange={() => {}}
        onPasteFiles={onPasteFiles}
      />,
    );
    const shot = new File(["png"], "image.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Message"), { clipboardData: { files: [shot] } });
    expect(onPasteFiles).toHaveBeenCalledWith([shot]);
  });

  it("plays audio inline once asked, from the engine's copy", async () => {
    wrap(
      <MessageAttachments
        attachments={[{ name: "memo.wav", path: "/p/memo.wav", mime: "audio/wav", size: 2048 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play memo.wav" }));
    const player = await screen.findByLabelText("memo.wav");
    expect(player.tagName).toBe("AUDIO");
    expect(player.getAttribute("src")).toContain("memo.wav");
  });

  it("keeps a thread row that is only files", () => {
    const items = chatLogMessagesToChatItems([
      {
        schemaVersion: 1,
        id: "chan_1",
        sender: "user:local",
        timestamp: "2026-10-30T10:00:00Z",
        text: "",
        attachments: [{ name: "a.png", path: "/p/a.png", mime: "image/png", size: 1 }],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].attachments?.[0].name).toBe("a.png");
  });
});

describe("model inputs", () => {
  it("gives a model without a descriptor one that keeps its tools", () => {
    const spec = withInputs(null, { image: true, audio: true, video: true });
    expect(spec.tool_support).toBe("function_calling");
    expect(spec.thinking).toBe("optional");
    expect(inputsOf(spec)).toEqual({ image: true, audio: true, video: true });
  });

  it("changes only the inputs of an existing descriptor", () => {
    const spec = withInputs(
      {
        image_input: true,
        audio_input: false,
        tool_support: "full",
        streaming: true,
        thinking: "required",
        json_mode: true,
      },
      { image: true, audio: true, video: false },
    );
    expect(spec.tool_support).toBe("full");
    expect(spec.thinking).toBe("required");
    expect(spec.audio_input).toBe(true);
    expect(spec.video_input).toBe(false);
  });
});

describe("model price", () => {
  it("reads a price draft and keeps tools on a new descriptor", async () => {
    const { pricingFromDraft, withPricing, priceDraftOf } = await import("../lib/model-spec");
    expect(pricingFromDraft({ input: "", output: "" })).toBeUndefined();
    expect(pricingFromDraft({ input: "$1", output: "2.5" })).toEqual({
      input_per_million: 1,
      output_per_million: 2.5,
    });
    expect(pricingFromDraft({ input: "-1", output: "" })).toBeNull();
    const spec = withPricing(null, { input_per_million: 1 });
    expect(spec.tool_support).toBe("function_calling");
    expect(priceDraftOf(spec)).toEqual({ input: "1", output: "" });
    expect(withPricing(spec, undefined).pricing).toBeUndefined();
  });
});
