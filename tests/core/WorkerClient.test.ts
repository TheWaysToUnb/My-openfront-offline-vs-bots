import { describe, expect, test, vi } from "vitest";

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    private listeners = new Map<string, (event: any) => void>();

    addEventListener(type: string, listener: (event: any) => void) {
      this.listeners.set(type, listener);
    }

    postMessage() {
      queueMicrotask(() => {
        this.listeners.get("error")?.({ message: "map request failed" });
      });
    }
  }

  return { FakeWorker };
});

vi.mock("../../src/core/worker/Worker.worker.ts?worker&inline", () => ({
  default: FakeWorker,
}));

import { WorkerClient } from "../../src/core/worker/WorkerClient";

describe("WorkerClient", () => {
  test("rejects initialization when the worker reports an error", async () => {
    const client = new WorkerClient({} as any, undefined);

    await expect(client.initialize()).rejects.toThrow(
      "Worker initialization failed: map request failed",
    );
  });
});
