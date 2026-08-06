/**
 * iJester prod lab: streams TTS scenarios to ijester.com over the real
 * WebSocket protocol at REAL-TIME pacing with natural pauses, exactly like
 * a person at the microphone. Records transcripts, proposals, and cues per
 * scenario and prints a verdict table.
 *
 * Run: bun joke-lab.ts [rounds] [origin]
 */
const ROUNDS = Number(process.argv[2] ?? 1);
const ORIGIN = process.argv[3] ?? "https://ijester.com";
const DIR = import.meta.dir;

const PCM_MIME = "audio/pcm;rate=16000";
const SAMPLE_RATE = 16_000;
const PACKET_MS = 256;
const PACKET_BYTES = (SAMPLE_RATE * 2 * PACKET_MS) / 1000;

interface Scenario {
  name: string;
  /** wav file base names + pause afterwards (ms of VAD-silence packets). */
  parts: { file: string; pauseAfterMs: number }[];
  expect: "cue" | "none";
}

const SCENARIOS: Scenario[] = [
  {
    name: "wife-hug pun (two-liner)",
    parts: [
      { file: "hug_setup", pauseAfterMs: 900 },
      { file: "hug_punch", pauseAfterMs: 1600 },
    ],
    expect: "cue",
  },
  {
    name: "atoms pun (Q&A)",
    parts: [
      { file: "atoms_setup", pauseAfterMs: 1100 },
      { file: "atoms_punch", pauseAfterMs: 1600 },
    ],
    expect: "cue",
  },
  {
    name: "banker one-liner",
    parts: [{ file: "banker", pauseAfterMs: 1600 }],
    expect: "cue",
  },
  {
    name: "wholesome puppy story",
    parts: [
      { file: "puppy_a", pauseAfterMs: 700 },
      { file: "puppy_b", pauseAfterMs: 1600 },
    ],
    expect: "cue",
  },
  {
    name: "mundane control (groceries)",
    parts: [{ file: "mundane", pauseAfterMs: 1600 }],
    expect: "none",
  },
];

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function wavPcm(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let i = 12; i < bytes.length - 8; ) {
    const id = String.fromCharCode(...bytes.subarray(i, i + 4));
    const size = view.getUint32(i + 4, true);
    if (id === "data") return bytes.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

interface RunResult {
  scenario: string;
  expect: "cue" | "none";
  transcripts: string[];
  proposals: string[];
  cues: string[];
  errors: string[];
  pass: boolean;
}

async function runScenario(s: Scenario): Promise<RunResult> {
  const result: RunResult = {
    scenario: s.name,
    expect: s.expect,
    transcripts: [],
    proposals: [],
    cues: [],
    errors: [],
    pass: false,
  };

  const create = await fetch(`${ORIGIN}/api/sessions`, {
    method: "POST",
    headers: { Origin: ORIGIN },
  });
  if (!create.ok) {
    result.errors.push(`create ${create.status}`);
    return result;
  }
  const session = (await create.json()) as {
    session_token: string;
    websocket_url: string;
  };

  const wsUrl = new URL(session.websocket_url, ORIGIN);
  wsUrl.protocol = "wss:";
  wsUrl.searchParams.set("token", session.session_token);
  const ws = new WebSocket(wsUrl.toString(), { headers: { Origin: ORIGIN } });
  ws.binaryType = "arraybuffer";

  let seq = 0;
  let speechEndAt = 0; // stamped when the last speech packet is sent
  const rel = () =>
    speechEndAt === 0 ? "+?" : `+${((Date.now() - speechEndAt) / 1000).toFixed(1)}s`;
  const sendJson = (obj: Record<string, unknown>) =>
    ws.send(JSON.stringify({ v: 1, event_id: newId("evt"), sent_at: Date.now(), ...obj }));
  const sendPacket = (bytes: Uint8Array, speech: boolean) => {
    sendJson({
      type: "audio_meta",
      seq: seq++,
      mime: PCM_MIME,
      duration_ms: Math.round((bytes.length / 2 / SAMPLE_RATE) * 1000),
      speech,
    });
    ws.send(bytes);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await new Promise<void>((resolve) => {
    ws.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      const msg = JSON.parse(event.data);
      if (msg.type === "transcript_debug") {
        for (const seg of msg.segments) result.transcripts.push(`${rel()} ${seg.text}`);
      } else if (msg.type === "notice" && msg.code === "proposal") {
        result.proposals.push(`${rel()} ${msg.message}`);
      } else if (msg.type === "cue") {
        result.cues.push(`${msg.cue} ${rel()}`);
      } else if (msg.type === "error") {
        result.errors.push(msg.code);
      }
    };
    ws.onclose = () => resolve();
    ws.onerror = () => { result.errors.push("ws_error"); resolve(); };

    ws.onopen = async () => {
      sendJson({ type: "hello", capabilities: { mime: PCM_MIME, reduced_motion: false, debug: true } });

      const silence = new Uint8Array(PACKET_BYTES);
      for (const [i, part] of s.parts.entries()) {
        const pcm = wavPcm(new Uint8Array(await Bun.file(`${DIR}/${part.file}.wav`).arrayBuffer()));
        for (let off = 0; off < pcm.length; off += PACKET_BYTES) {
          sendPacket(pcm.subarray(off, Math.min(off + PACKET_BYTES, pcm.length)), true);
          await sleep(PACKET_MS); // real-time pacing
        }
        if (i === s.parts.length - 1) speechEndAt = Date.now();
        // Natural pause: VAD-marked silence, still inside the send hangover.
        for (let ms = 0; ms < part.pauseAfterMs; ms += PACKET_MS) {
          sendPacket(silence, false);
          await sleep(PACKET_MS);
        }
      }
      // Wait for STT + (possibly deferred) evaluation rounds to finish.
      await sleep(11_000);
      sendJson({ type: "stop" });
      setTimeout(resolve, 1_000);
    };
  });

  result.pass = s.expect === "cue" ? result.cues.length > 0 : result.cues.length === 0;
  return result;
}

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n════════ ROUND ${round}/${ROUNDS} ════════`);
  const results: RunResult[] = [];
  for (const s of SCENARIOS) {
    console.log(`\n▶ ${s.name}`);
    const r = await runScenario(s);
    results.push(r);
    console.log(`  transcripts: ${r.transcripts.map((t) => JSON.stringify(t)).join(" | ") || "(none)"}`);
    console.log(`  proposals:   ${r.proposals.join(" | ") || "(none)"}`);
    console.log(`  cues:        ${r.cues.join(", ") || "(none)"}`);
    if (r.errors.length) console.log(`  errors:      ${r.errors.join(", ")}`);
    console.log(`  ${r.pass ? "✅ PASS" : "❌ FAIL"} (expected ${r.expect})`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n──── round ${round} verdict: ${passed}/${results.length} scenarios passed ────`);
  for (const r of results) console.log(`  ${r.pass ? "✅" : "❌"} ${r.scenario} → ${r.cues.join(",") || "quiet"}`);
}
process.exit(0);
