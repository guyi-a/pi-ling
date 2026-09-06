import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  agent as createAgent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

const sessions = new Set();
let resolveCancel;

createAgent({ name: "pi-ling-fake-dsh" })
  .onRequest(methods.agent.initialize, () =>
    Promise.resolve({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { resume: {}, close: {}, list: {} },
      },
      authMethods: [],
    }),
  )
  .onRequest(methods.agent.session.new, () => {
    const sessionId = process.env.FAKE_SESSION_ID ?? randomUUID();
    sessions.add(sessionId);
    return Promise.resolve({ sessionId });
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    sessions.add(params.sessionId);
    return Promise.resolve({});
  })
  .onRequest(methods.agent.session.list, () =>
    Promise.resolve({ sessions: [], nextCursor: null }),
  )
  .onRequest(methods.agent.session.close, ({ params }) => {
    sessions.delete(params.sessionId);
    return Promise.resolve({});
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    if (process.env.FAKE_CRASH === "1") process.exit(17);
    if (process.env.FAKE_PERMISSION === "1") {
      const decision = await client.request(
        methods.client.session.requestPermission,
        {
          sessionId: params.sessionId,
          toolCall: {
            toolCallId: "call-1",
            title: "Write file",
            kind: "edit",
            rawInput: { path: "a.txt" },
          },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        },
      );
      if (decision.outcome.outcome === "cancelled") {
        return { stopReason: "cancelled" };
      }
    }
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read file",
        kind: "read",
        status: "in_progress",
        rawInput: { path: "a.txt" },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        rawOutput: "ok",
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: process.env.FAKE_TEXT ?? "done" },
      },
    });
    if (process.env.FAKE_HANG === "1") {
      return new Promise((resolve) => {
        resolveCancel = () => resolve({ stopReason: "cancelled" });
      });
    }
    return { stopReason: "end_turn" };
  })
  .onNotification(methods.agent.session.cancel, () => {
    resolveCancel?.();
    return Promise.resolve();
  })
  .connect(
    ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin),
    ),
  );

process.stdin.on("end", () => process.exit(0));
