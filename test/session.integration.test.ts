import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://example.com";

/**
 * Cleanly end a session over its socket so the Durable Object deletes its
 * storage and pending alarms; leftover alarms break vitest's isolated
 * storage stack between tests.
 */
async function stopSession(socket: WebSocket): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve());
  });
  socket.send(
    JSON.stringify({ v: 1, type: "stop", event_id: "evt_cleanup", sent_at: Date.now() }),
  );
  await closed;
}

async function createSession(): Promise<{
  session_id: string;
  session_token: string;
  websocket_url: string;
}> {
  const response = await SELF.fetch(`${ORIGIN}/api/sessions`, {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  expect(response.status).toBe(200);
  return response.json();
}

describe("worker routes", () => {
  it("health responds without secrets", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body["ok"]).toBe(true);
    expect(JSON.stringify(body)).not.toContain("KEY");
  });

  it("rejects session creation from a foreign origin", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/sessions`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("creates unique sessions per visit", async () => {
    const first = await createSession();
    const second = await createSession();
    expect(first.session_id).not.toBe(second.session_id);
    expect(first.session_token).not.toBe(second.session_token);
    expect(first.websocket_url).toContain(first.session_id);
  });

  it("rejects a websocket upgrade with a bad token", async () => {
    const session = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=forged.token.value`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a token minted for a different session", async () => {
    const a = await createSession();
    const b = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${a.websocket_url}?token=${encodeURIComponent(b.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(response.status).toBe(401);
  });

  it("upgrades a websocket with a valid token and completes hello/ready", async () => {
    const session = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=${encodeURIComponent(session.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeTruthy();
    socket!.accept();

    const messages: Record<string, unknown>[] = [];
    const gotReady = new Promise<void>((resolve) => {
      socket!.addEventListener("message", (event) => {
        const parsed = JSON.parse(event.data as string) as Record<string, unknown>;
        messages.push(parsed);
        if (parsed["type"] === "ready") resolve();
      });
    });

    socket!.send(
      JSON.stringify({
        v: 1,
        type: "hello",
        event_id: "evt_test1",
        sent_at: Date.now(),
        capabilities: { mime: "audio/webm;codecs=opus" },
      }),
    );
    await gotReady;

    const ready = messages.find((m) => m["type"] === "ready")!;
    const config = ready["config"] as Record<string, unknown>;
    expect(config["transcription_provider"]).toBe("mock");
    expect(config["classifier"]).toBe("heuristic");
    await stopSession(socket!);
  });

  it("audio flows through mock STT and can produce a policy-gated cue", async () => {
    const session = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=${encodeURIComponent(session.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    const socket = response.webSocket!;
    socket.accept();

    const received: Record<string, unknown>[] = [];
    socket.addEventListener("message", (event) => {
      received.push(JSON.parse(event.data as string) as Record<string, unknown>);
    });

    socket.send(
      JSON.stringify({
        v: 1,
        type: "hello",
        event_id: "evt_hello",
        sent_at: Date.now(),
        capabilities: { mime: "audio/webm;codecs=opus" },
      }),
    );

    // Push several utterances through; the mock STT cycles fixture lines and
    // the heuristic classifier should eventually react to one of them.
    for (let seq = 0; seq < 8; seq++) {
      socket.send(
        JSON.stringify({
          v: 1,
          type: "audio_meta",
          event_id: `evt_meta_${seq}`,
          sent_at: Date.now(),
          seq,
          mime: "audio/webm;codecs=opus",
          duration_ms: 1500,
        }),
      );
      socket.send(new Uint8Array(1024).buffer);
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 300));

    const cues = received.filter((m) => m["type"] === "cue");
    expect(cues.length).toBeGreaterThanOrEqual(1);
    for (const cue of cues) {
      expect(typeof cue["cue"]).toBe("string");
      expect(cue["cue"]).not.toBe("none");
      expect(cue["gain"] as number).toBeLessThanOrEqual(0.9);
    }
    await stopSession(socket);
  });

  it("streamed PCM aggregates at pauses and can produce a cue", async () => {
    const session = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=${encodeURIComponent(session.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    const socket = response.webSocket!;
    socket.accept();
    const received: Record<string, unknown>[] = [];
    socket.addEventListener("message", (event) => {
      received.push(JSON.parse(event.data as string) as Record<string, unknown>);
    });

    socket.send(
      JSON.stringify({
        v: 1,
        type: "hello",
        event_id: "evt_hello",
        sent_at: Date.now(),
        capabilities: { mime: "audio/pcm;rate=16000" },
      }),
    );

    // Several rounds of ~1.3s speech + ~0.9s pause: each pause flushes a
    // window through mock STT; the heuristic reacts to a fixture line.
    let seq = 0;
    const pcmPacket = new ArrayBuffer((16000 * 2 * 256) / 1000);
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 5; i++) {
        socket.send(
          JSON.stringify({
            v: 1, type: "audio_meta", event_id: `m${seq}`, sent_at: Date.now(),
            seq: seq++, mime: "audio/pcm;rate=16000", duration_ms: 256, speech: true,
          }),
        );
        socket.send(pcmPacket);
      }
      for (let i = 0; i < 4; i++) {
        socket.send(
          JSON.stringify({
            v: 1, type: "audio_meta", event_id: `m${seq}`, sent_at: Date.now(),
            seq: seq++, mime: "audio/pcm;rate=16000", duration_ms: 256, speech: false,
          }),
        );
        socket.send(pcmPacket);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 300));

    const cues = received.filter((m) => m["type"] === "cue");
    expect(cues.length).toBeGreaterThanOrEqual(1);
    await stopSession(socket);
  });

  it("stop message ends the session and deletes state", async () => {
    const session = await createSession();
    const response = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=${encodeURIComponent(session.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    const socket = response.webSocket!;
    socket.accept();

    const closed = new Promise<void>((resolve) => {
      socket.addEventListener("close", () => resolve());
    });
    socket.send(
      JSON.stringify({
        v: 1,
        type: "stop",
        event_id: "evt_stop",
        sent_at: Date.now(),
      }),
    );
    await closed;

    // The object refuses new connections after an explicit stop.
    const reconnect = await SELF.fetch(
      `${ORIGIN}${session.websocket_url}?token=${encodeURIComponent(session.session_token)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(reconnect.status).toBe(410);
  });

  it("DELETE ends a session with a valid token", async () => {
    const session = await createSession();
    const response = await SELF.fetch(`${ORIGIN}/api/sessions/${session.session_id}`, {
      method: "DELETE",
      headers: { Origin: ORIGIN, "X-Session-Token": session.session_token },
    });
    expect(response.status).toBe(200);
  });

  it("DELETE without a token is rejected", async () => {
    const session = await createSession();
    const response = await SELF.fetch(`${ORIGIN}/api/sessions/${session.session_id}`, {
      method: "DELETE",
      headers: { Origin: ORIGIN },
    });
    expect(response.status).toBe(401);
  });
});
