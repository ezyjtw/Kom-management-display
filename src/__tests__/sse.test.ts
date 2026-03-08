/**
 * SSE infrastructure tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerClient,
  removeClient,
  getConnectedClientCount,
  getConnectedClients,
  broadcastEvent,
} from "@/lib/sse";

describe("SSE Client Management", () => {
  // Create a mock controller
  function createMockController(): ReadableStreamDefaultController {
    const enqueuedData: Uint8Array[] = [];
    return {
      enqueue: (data: Uint8Array) => { enqueuedData.push(data); },
      close: () => {},
      error: () => {},
      desiredSize: null,
      // Store data for assertions
      __data: enqueuedData,
    } as unknown as ReadableStreamDefaultController;
  }

  beforeEach(() => {
    // Clean up any existing clients
    const clients = getConnectedClients();
    clients.forEach((c) => removeClient(c.id));
  });

  it("registers a client", () => {
    const controller = createMockController();
    registerClient("client-1", "user-1", "admin", "TransactionOperations", controller);
    expect(getConnectedClientCount()).toBe(1);
  });

  it("removes a client", () => {
    const controller = createMockController();
    registerClient("client-2", "user-2", "lead", "DataOperations", controller);
    expect(getConnectedClientCount()).toBeGreaterThanOrEqual(1);
    removeClient("client-2");
    const clients = getConnectedClients();
    expect(clients.find((c) => c.id === "client-2")).toBeUndefined();
  });

  it("returns client info without controller", () => {
    const controller = createMockController();
    registerClient("client-3", "user-3", "employee", "StakingOps", controller);
    const clients = getConnectedClients();
    const client = clients.find((c) => c.id === "client-3");
    expect(client).toBeDefined();
    expect(client!.userId).toBe("user-3");
    expect(client!.role).toBe("employee");
    expect(client!.team).toBe("StakingOps");
    expect((client as any).controller).toBeUndefined();
    removeClient("client-3");
  });

  it("broadcasts event to all clients", () => {
    const controller1 = createMockController();
    const controller2 = createMockController();
    registerClient("broadcast-1", "user-1", "admin", null, controller1);
    registerClient("broadcast-2", "user-2", "lead", null, controller2);

    broadcastEvent({
      type: "alert",
      data: { message: "Test alert" },
      timestamp: new Date().toISOString(),
    });

    expect((controller1 as any).__data.length).toBeGreaterThan(0);
    expect((controller2 as any).__data.length).toBeGreaterThan(0);

    removeClient("broadcast-1");
    removeClient("broadcast-2");
  });
});
