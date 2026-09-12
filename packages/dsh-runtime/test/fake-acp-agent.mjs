import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import {
  agent as createAgent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

const activeSessions = new Set();
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
    if (activeSessions.has(sessionId)) {
      throw RequestError.invalidParams(
        undefined,
        `session is already active: ${sessionId}`,
      );
    }
    activeSessions.add(sessionId);
    return Promise.resolve({ sessionId });
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    if (params.sessionId === "stale-dsh-session") {
      throw RequestError.invalidParams(
        undefined,
        `session is not resumable: ${params.sessionId}`,
      );
    }
    if (activeSessions.has(params.sessionId)) {
      throw RequestError.invalidParams(
        undefined,
        `session is already active: ${params.sessionId}`,
      );
    }
    activeSessions.add(params.sessionId);
    return Promise.resolve({});
  })
  .onRequest(methods.agent.session.list, () =>
    Promise.resolve({ sessions: [], nextCursor: null }),
  )
  .onRequest(methods.agent.session.close, ({ params }) => {
    activeSessions.delete(params.sessionId);
    return Promise.resolve({});
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    if (process.env.FAKE_CRASH === "1") process.exit(17);
    if (process.env.FAKE_PERMISSION === "1") {
      if (process.env.FAKE_PERMISSION_SPARSE === "1") {
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            title: "write",
            kind: "other",
            status: "in_progress",
            rawInput: { file_path: ".env", content: "API_KEY=secret" },
          },
        });
      }
      const decision = await client.request(
        methods.client.session.requestPermission,
        {
          sessionId: params.sessionId,
          toolCall:
            process.env.FAKE_PERMISSION_SPARSE === "1"
              ? { toolCallId: "call-1" }
              : {
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
        messageId: "msg-thought-1",
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
        messageId: "msg-answer-1",
        content: { type: "text", text: process.env.FAKE_TEXT ?? "done" },
      },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "usage_update",
        used: 8700,
        size: 1_000_000,
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
