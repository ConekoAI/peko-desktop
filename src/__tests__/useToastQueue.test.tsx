// src/__tests__/useToastQueue.test.tsx
//
// P1.6: toast queue FIFO + auto-dismiss behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useToastQueue } from "../hooks/useToastQueue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useToastQueue", () => {
  it("returns null current when empty", () => {
    const { result } = renderHook(() => useToastQueue<string>());
    expect(result.current.current).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });

  it("enqueues items FIFO; current is the head item", () => {
    const { result } = renderHook(() => useToastQueue<string>());
    act(() => result.current.enqueue("a"));
    act(() => result.current.enqueue("b"));
    act(() => result.current.enqueue("c"));
    expect(result.current.current).toBe("a");
    expect(result.current.pendingCount).toBe(2);
  });

  it("dismiss() removes the head and promotes the next item", () => {
    const { result } = renderHook(() => useToastQueue<string>());
    act(() => result.current.enqueue("a"));
    act(() => result.current.enqueue("b"));
    act(() => result.current.dismiss());
    expect(result.current.current).toBe("b");
    expect(result.current.pendingCount).toBe(0);
  });

  it("auto-dismisses the head after autoDismissMs", () => {
    const { result } = renderHook(() =>
      useToastQueue<string>({ autoDismissMs: 1_000 }),
    );
    act(() => result.current.enqueue("a"));
    act(() => result.current.enqueue("b"));
    expect(result.current.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.current).toBe("b");
    expect(result.current.pendingCount).toBe(0);
  });

  it("respects maxLength by silently dropping when over capacity", () => {
    const { result } = renderHook(() =>
      useToastQueue<string>({ maxLength: 2 }),
    );
    act(() => result.current.enqueue("a"));
    act(() => result.current.enqueue("b"));
    act(() => result.current.enqueue("c"));
    expect(result.current.current).toBe("a");
    expect(result.current.pendingCount).toBe(1);
  });
});