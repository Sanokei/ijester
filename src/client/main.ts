import "./styles.css";
import { StatusAnnouncer } from "./accessibility";
import { Controls } from "./controls";
import { DebugPanel } from "./debug-panel";
import { Iris } from "./iris";
import { Microphone, pickMimeType } from "./microphone";
import { showPermissionModal } from "./permission-modal";
import { SessionClient } from "./session-socket";
import { SoundEngine } from "./sound-engine";
import type { IrisState } from "../shared/schema";

const app = document.getElementById("app")!;
const debugMode = new URLSearchParams(location.search).has("debug");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const iris = new Iris(app);
const status = new StatusAnnouncer(app);
const sounds = new SoundEngine();

const micIndicator = document.createElement("div");
micIndicator.className = "mic-indicator";
micIndicator.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="text">mic live</span>`;
app.appendChild(micIndicator);

let microphone: Microphone | null = null;
let session: SessionClient | null = null;
let controls: Controls | null = null;
let debugPanel: DebugPanel | null = null;
let running = false;
let starting = false;
let localPaused = false;

function setState(state: IrisState): void {
  iris.setState(state);
  status.setState(state);
}

function setMicIndicator(mode: "off" | "live" | "paused"): void {
  micIndicator.classList.toggle("active", mode !== "off");
  micIndicator.classList.toggle("paused", mode === "paused");
  micIndicator.querySelector(".text")!.textContent =
    mode === "paused" ? "mic paused" : "mic live";
}

setState("idle");

iris.element.addEventListener("click", () => {
  if (!running && !starting) void begin();
});
iris.element.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !running && !starting) {
    event.preventDefault();
    void begin();
  }
});

async function begin(): Promise<void> {
  starting = true;
  iris.hideHint();
  setState("permission");

  const choice = await showPermissionModal();
  if (choice === "later") {
    // Visual-demo mode: the iris stays alive, retry on next activation.
    setState("idle");
    status.notice("Microphone off. Tap the iris to try again.");
    starting = false;
    return;
  }

  let stream: MediaStream;
  try {
    stream = await Microphone.requestStream();
  } catch {
    setState("error");
    status.notice("Microphone was blocked. Tap the iris to retry, or check browser permissions.");
    starting = false;
    return;
  }

  try {
    await start(stream);
  } catch (err) {
    console.error(err);
    for (const track of stream.getTracks()) track.stop();
    setMicIndicator("off");
    setState("error");
    status.notice("Could not reach the server. Tap the iris to retry.");
    starting = false;
    return;
  }

  running = true;
  starting = false;
}

async function start(stream: MediaStream): Promise<void> {
  setState("connecting");

  // Preload sounds inside the user-gesture chain for autoplay policy.
  await sounds.init();

  session = new SessionClient({
    ready: (msg) => {
      status.notice(`listening · ${msg.config.classifier} classifier`);
      debugPanel?.append(`ready: ${JSON.stringify(msg.config)}`);
    },
    state: (msg) => {
      // The client owns fine-grained speech visuals; take server states that
      // represent pipeline phases.
      if (msg.state === "evaluating" || msg.state === "listening" || msg.state === "ended") {
        if (!localPaused || msg.state === "ended") setState(msg.state);
      }
      if (msg.state === "ended" && running) void teardown(false);
    },
    cue: (msg) => {
      const played = sounds.play(
        msg.cue,
        msg.gain,
        msg.delay_ms,
        () => {
          iris.cueImpact();
          setState("cueing");
          session?.sendCueAck(msg.event_id, "started");
        },
        () => {
          session?.sendCueAck(msg.event_id, "ended");
          if (running && !localPaused) setState("listening");
        },
      );
      debugPanel?.append(`cue: ${msg.cue} gain=${msg.gain} delay=${msg.delay_ms} played=${played}`);
    },
    notice: (msg) => {
      debugPanel?.append(`notice: ${msg.code}`);
    },
    error: (msg) => {
      debugPanel?.append(`error: ${msg.code}`);
      if (!msg.recoverable) {
        setState("error");
        status.notice("Session error. Tap the iris to start a new session.");
      }
    },
    transcript_debug: (msg) => debugPanel?.transcript(msg.segments),
    onDisconnect: (permanent) => {
      if (!running) return;
      if (permanent) {
        setState("error");
        status.notice("Connection lost. Tap the iris to start a new session.");
        void teardown(false);
      } else {
        setState("connecting");
      }
    },
  });

  await session.create();
  await session.connect({ mime: pickMimeType(), reduced_motion: reducedMotion, debug: debugMode });

  microphone = new Microphone({
    onLevel: (level, speechProb) => iris.setMicLevel(level, speechProb),
    onSpeechStart: () => {
      if (!localPaused && iris.getState() === "listening") setState("speech");
    },
    onSpeechEnd: () => {
      if (!localPaused && iris.getState() === "speech") setState("listening");
    },
    onUtterance: (blob, durationMs, mimeType) => {
      void session?.sendAudio(blob, durationMs, mimeType);
    },
  });
  await microphone.start(stream);

  controls ??= new Controls(app, sounds.getVolume(), {
    onPauseToggle: (paused) => {
      localPaused = paused;
      if (paused) {
        microphone?.pause();
        session?.sendControl("pause");
        setMicIndicator("paused");
        setState("paused");
      } else {
        microphone?.resume();
        session?.sendControl("resume");
        setMicIndicator("live");
        setState("listening");
      }
    },
    onMuteToggle: (muted) => {
      sounds.setMuted(muted);
      session?.sendControl("mute_state", muted);
      status.notice(muted ? "Reactions muted." : "Reactions on.");
    },
    onVolume: (volume) => sounds.setVolume(volume),
    onEnd: () => void teardown(true),
  });
  controls.setPaused(false);
  controls.setMuted(sounds.isMuted());
  controls.show();

  if (debugMode && !debugPanel) {
    const cueIds = [
      "laugh_light",
      "laugh_big",
      "ooo",
      "aww",
      "gasp",
      "boo_soft",
      "dramatic_impact",
      "knife_sting",
    ];
    debugPanel = new DebugPanel(app, cueIds, sounds);
  }

  setMicIndicator("live");
  setState("listening");
}

async function teardown(userInitiated: boolean): Promise<void> {
  if (!running && !userInitiated) {
    setMicIndicator("off");
    return;
  }
  running = false;
  localPaused = false;
  microphone?.stop();
  microphone = null;
  if (userInitiated) await session?.end();
  session = null;
  controls?.hide();
  setMicIndicator("off");
  setState("ended");
  status.notice("Session ended. Tap the iris to start fresh.");
  // The next activation is a brand-new visit: new session, new Durable Object.
  starting = false;
}

// Global keyboard shortcuts: M mutes instantly from anywhere.
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "m" && running && controls) {
    const next = !sounds.isMuted();
    sounds.setMuted(next);
    controls.setMuted(next);
    session?.sendControl("mute_state", next);
  }
});

// Leaving the page: release the microphone immediately.
window.addEventListener("pagehide", () => {
  microphone?.stop();
});
