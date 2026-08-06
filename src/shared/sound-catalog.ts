/**
 * Server-owned sound catalog. The model can only ever propose one of these
 * ids (or "none"); the client can only ever play files listed here. Nothing
 * in this file is influenced by transcript content.
 */

export type SoundCategory =
  | "positive"
  | "negative"
  | "surprise"
  | "comedy"
  | "dramatic";

export interface SoundDefinition {
  id: string;
  file: string;
  category: SoundCategory;
  description: string;
  allowedContexts: string[];
  blockedContexts: string[];
  minConfidence: number;
  cooldownMs: number;
  defaultGain: number;
  maxPlaysPerSession: number;
  license: {
    name: string;
    source: string;
    attributionRequired: boolean;
  };
}

/**
 * All assets are CC0 recordings sourced from freesound.org (trimmed and
 * loudness-normalized to -16 LUFS). `source` is the sound's freesound page;
 * CC0 requires no attribution. scripts/generate-sounds.mjs can still emit
 * synthesized stand-ins if an asset ever needs replacing.
 */
const freesound = (source: string) =>
  ({ name: "CC0 1.0", source, attributionRequired: false }) as const;

export const SOUND_CATALOG: readonly SoundDefinition[] = [
  {
    id: "laugh_light",
    file: "/sounds/laugh-light.mp3",
    category: "comedy",
    description: "A light, warm chuckle for a small joke or wry remark.",
    allowedContexts: ["joke", "banter", "wordplay", "self_deprecation"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.82,
    cooldownMs: 12_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 30,
    license: freesound("https://freesound.org/people/mglennsound/sounds/678670/"),
  },
  {
    id: "laugh_big",
    file: "/sounds/laugh-big.mp3",
    category: "comedy",
    description: "A big audience laugh for a clear, landed punchline.",
    allowedContexts: ["punchline", "absurd_reveal", "comic_timing"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.88,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: freesound("https://freesound.org/people/HowardV/sounds/581528/"),
  },
  {
    id: "ooo",
    file: "/sounds/ooo.mp3",
    category: "surprise",
    description: "Audience 'ooo' for a spicy reveal, flirtation, or callout.",
    allowedContexts: ["romantic_reveal", "callout", "bold_claim", "gossip"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.86,
    cooldownMs: 15_000,
    defaultGain: 0.58,
    maxPlaysPerSession: 20,
    license: freesound("https://freesound.org/people/noah0189/sounds/264499/"),
  },
  {
    id: "aww",
    file: "/sounds/aww.mp3",
    category: "positive",
    description: "A warm 'aww' for something wholesome, sweet, or touching.",
    allowedContexts: ["wholesome", "affection", "pet_story", "kind_gesture"],
    blockedContexts: ["sarcasm_at_person"],
    minConfidence: 0.85,
    cooldownMs: 18_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 20,
    license: freesound("https://freesound.org/people/phmiller42/sounds/124996/"),
  },
  {
    id: "gasp",
    file: "/sounds/gasp.mp3",
    category: "surprise",
    description: "A collective gasp for a genuine shock or twist.",
    allowedContexts: ["shock", "twist", "confession", "escalation"],
    blockedContexts: ["grief", "medical_emergency"],
    minConfidence: 0.86,
    cooldownMs: 15_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: freesound("https://freesound.org/people/RadioCounseling/sounds/635110/"),
  },
  {
    id: "boo_soft",
    file: "/sounds/boo-soft.mp3",
    category: "negative",
    description: "A gentle pantomime boo for playful villainy only.",
    allowedContexts: ["pantomime_villainy", "playful_disagreement"],
    blockedContexts: [
      "grief",
      "distress",
      "insult_at_person",
      "protected_class",
      "sincere_opinion",
    ],
    minConfidence: 0.93,
    cooldownMs: 30_000,
    defaultGain: 0.45,
    maxPlaysPerSession: 6,
    license: freesound("https://freesound.org/people/Nox_Sound/sounds/752707/"),
  },
  {
    id: "dramatic_impact",
    file: "/sounds/dramatic-impact.mp3",
    category: "dramatic",
    description: "A deep dramatic impact for an over-the-top serious beat.",
    allowedContexts: ["mock_drama", "cliffhanger", "dramatic_pause"],
    blockedContexts: ["grief", "distress", "medical_emergency"],
    minConfidence: 0.91,
    cooldownMs: 25_000,
    defaultGain: 0.6,
    maxPlaysPerSession: 10,
    license: freesound("https://freesound.org/people/unfa/sounds/647712/"),
  },
  {
    id: "knife_sting",
    file: "/sounds/knife-sting.mp3",
    category: "dramatic",
    description: "A sharp suspense sting for exaggerated fake tension.",
    allowedContexts: ["mock_suspense", "over_dramatic_reveal"],
    blockedContexts: ["grief", "distress", "violence", "medical_emergency"],
    minConfidence: 0.94,
    cooldownMs: 40_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 6,
    license: freesound("https://freesound.org/people/nomiqbomi/sounds/578382/"),
  },
  {
    id: "drum_sting",
    file: "/sounds/drum-sting.mp3",
    category: "comedy",
    description: "Ba-dum-tss rimshot for a deliberate, groan-worthy punchline or pun.",
    allowedContexts: ["punchline", "pun", "dad_joke", "one_liner"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.84,
    cooldownMs: 15_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: freesound("https://freesound.org/people/gefscream/sounds/470195/"),
  },
  {
    id: "sad_trombone",
    file: "/sounds/sad-trombone.mp3",
    category: "comedy",
    description: "Womp-womp sad trombone for a playful, trivial failure or letdown.",
    allowedContexts: ["playful_failure", "anticlimax", "minor_mishap"],
    blockedContexts: ["grief", "distress", "real_failure", "insult_at_person"],
    minConfidence: 0.88,
    cooldownMs: 25_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 8,
    license: freesound("https://freesound.org/people/kirbydx/sounds/175409/"),
  },
  {
    id: "crickets",
    file: "/sounds/crickets.mp3",
    category: "comedy",
    description: "Cricket chirps for a joke that intentionally lands flat or an awkward beat.",
    allowedContexts: ["joke_flop", "awkward_silence", "tumbleweed_moment"],
    blockedContexts: ["grief", "distress", "sincere_question"],
    minConfidence: 0.9,
    cooldownMs: 30_000,
    defaultGain: 0.45,
    maxPlaysPerSession: 6,
    license: freesound("https://freesound.org/people/_sinny_/sounds/822935/"),
  },
  {
    id: "airhorn",
    file: "/sounds/airhorn.mp3",
    category: "comedy",
    description: "Hype airhorn blast for an over-the-top win, mic-drop, or celebration.",
    allowedContexts: ["hype", "mic_drop", "big_win", "celebration"],
    blockedContexts: ["grief", "distress", "quiet_moment"],
    minConfidence: 0.92,
    cooldownMs: 30_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 6,
    license: freesound("https://freesound.org/people/neopolitansixth/sounds/547020/"),
  },
  {
    id: "boing",
    file: "/sounds/boing.mp3",
    category: "comedy",
    description: "Cartoon spring boing for silly physical mishaps or absurd statements.",
    allowedContexts: ["silly_mistake", "absurdity", "cartoon_moment"],
    blockedContexts: ["grief", "distress", "real_injury"],
    minConfidence: 0.87,
    cooldownMs: 18_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 10,
    license: freesound("https://freesound.org/people/sdroliasnick/sounds/731262/"),
  },
  {
    id: "tada",
    file: "/sounds/tada.mp3",
    category: "positive",
    description: "A little fanfare for an accomplishment, reveal, or proud announcement.",
    allowedContexts: ["achievement", "announcement", "proud_reveal"],
    blockedContexts: ["sarcasm_at_person", "grief"],
    minConfidence: 0.85,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 10,
    license: freesound("https://freesound.org/people/plasterbrain/sounds/397355/"),
  },
  {
    id: "applause",
    file: "/sounds/applause.mp3",
    category: "positive",
    description: "Warm applause for genuine accomplishments or a moment worth celebrating.",
    allowedContexts: ["achievement", "good_news", "well_done"],
    blockedContexts: ["sarcasm_at_person", "grief"],
    minConfidence: 0.85,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 10,
    license: freesound("https://freesound.org/people/Masgame/sounds/347547/"),
  },
  {
    id: "ding",
    file: "/sounds/ding.mp3",
    category: "positive",
    description: "A bright correct-answer ding for a good point or emphatic agreement.",
    allowedContexts: ["correct_answer", "agreement", "good_point"],
    blockedContexts: ["sarcasm_at_person"],
    minConfidence: 0.84,
    cooldownMs: 12_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 20,
    license: freesound("https://freesound.org/people/Fupicat/sounds/538147/"),
  },
  {
    id: "magic_sparkle",
    file: "/sounds/magic-sparkle.mp3",
    category: "positive",
    description: "Twinkling sparkle for whimsy, delight, or a charming little moment.",
    allowedContexts: ["whimsy", "delight", "charming_moment"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.87,
    cooldownMs: 20_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 10,
    license: freesound("https://freesound.org/people/MLaudio/sounds/511485/"),
  },
  {
    id: "record_scratch",
    file: "/sounds/record-scratch.mp3",
    category: "surprise",
    description: "Record scratch for an abrupt wait-what turn in the conversation.",
    allowedContexts: ["abrupt_turn", "wait_what", "sudden_reversal"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.89,
    cooldownMs: 25_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 8,
    license: freesound("https://freesound.org/people/ludvique/sounds/71853/"),
  },
  {
    id: "suspense_riser",
    file: "/sounds/suspense-riser.mp3",
    category: "dramatic",
    description: "A rising suspense swell for playful anticipation before a reveal.",
    allowedContexts: ["anticipation", "drumroll_moment", "pre_reveal"],
    blockedContexts: ["grief", "distress", "medical_emergency"],
    minConfidence: 0.9,
    cooldownMs: 30_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 8,
    license: freesound("https://freesound.org/people/magnuswaker/sounds/567310/"),
  },
  {
    id: "heartbeat",
    file: "/sounds/heartbeat.mp3",
    category: "dramatic",
    description: "A quiet heartbeat pulse for exaggerated mock tension.",
    allowedContexts: ["mock_tension", "dramatic_pause"],
    blockedContexts: ["grief", "distress", "medical_emergency", "real_fear"],
    minConfidence: 0.92,
    cooldownMs: 35_000,
    defaultGain: 0.45,
    maxPlaysPerSession: 6,
    license: freesound("https://freesound.org/people/daandraait/sounds/249716/"),
  },
] as const;

export const SOUND_MANIFEST_VERSION = "v2";

export type CueId = (typeof SOUND_CATALOG)[number]["id"] | "none";

export const ALL_CUE_IDS: readonly string[] = [
  "none",
  ...SOUND_CATALOG.map((s) => s.id),
];

export type ReactionMode = "minimal" | "standard" | "full";

/**
 * Reaction modes gate which categories may fire at all. "minimal" keeps only
 * gentle positive/surprise cues; negative cues are opt-in via "full".
 */
const MODE_CATEGORIES: Record<ReactionMode, readonly SoundCategory[]> = {
  minimal: ["positive", "surprise"],
  standard: ["positive", "surprise", "comedy", "dramatic"],
  full: ["positive", "surprise", "comedy", "dramatic", "negative"],
};

export function parseReactionMode(raw: string | undefined): ReactionMode {
  return raw === "minimal" || raw === "full" ? raw : "standard";
}

export function activeCatalog(mode: ReactionMode): SoundDefinition[] {
  const categories = MODE_CATEGORIES[mode];
  return SOUND_CATALOG.filter((s) => categories.includes(s.category));
}

export function soundById(id: string): SoundDefinition | undefined {
  return SOUND_CATALOG.find((s) => s.id === id);
}
