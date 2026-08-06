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

/** All placeholder assets are synthesized by scripts/generate-sounds.mjs. */
const SELF_LICENSE = {
  name: "CC0 (synthesized in-repo placeholder)",
  source: "scripts/generate-sounds.mjs",
  attributionRequired: false,
} as const;

export const SOUND_CATALOG: readonly SoundDefinition[] = [
  {
    id: "laugh_light",
    file: "/sounds/laugh-light.wav",
    category: "comedy",
    description: "A light, warm chuckle for a small joke or wry remark.",
    allowedContexts: ["joke", "banter", "wordplay", "self_deprecation"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.82,
    cooldownMs: 12_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 30,
    license: SELF_LICENSE,
  },
  {
    id: "laugh_big",
    file: "/sounds/laugh-big.wav",
    category: "comedy",
    description: "A big audience laugh for a clear, landed punchline.",
    allowedContexts: ["punchline", "absurd_reveal", "comic_timing"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.88,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: SELF_LICENSE,
  },
  {
    id: "ooo",
    file: "/sounds/ooo.wav",
    category: "surprise",
    description: "Audience 'ooo' for a spicy reveal, flirtation, or callout.",
    allowedContexts: ["romantic_reveal", "callout", "bold_claim", "gossip"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.86,
    cooldownMs: 15_000,
    defaultGain: 0.58,
    maxPlaysPerSession: 20,
    license: SELF_LICENSE,
  },
  {
    id: "aww",
    file: "/sounds/aww.wav",
    category: "positive",
    description: "A warm 'aww' for something wholesome, sweet, or touching.",
    allowedContexts: ["wholesome", "affection", "pet_story", "kind_gesture"],
    blockedContexts: ["sarcasm_at_person"],
    minConfidence: 0.85,
    cooldownMs: 18_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 20,
    license: SELF_LICENSE,
  },
  {
    id: "gasp",
    file: "/sounds/gasp.wav",
    category: "surprise",
    description: "A collective gasp for a genuine shock or twist.",
    allowedContexts: ["shock", "twist", "confession", "escalation"],
    blockedContexts: ["grief", "medical_emergency"],
    minConfidence: 0.86,
    cooldownMs: 15_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: SELF_LICENSE,
  },
  {
    id: "boo_soft",
    file: "/sounds/boo-soft.wav",
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
    license: SELF_LICENSE,
  },
  {
    id: "dramatic_impact",
    file: "/sounds/dramatic-impact.wav",
    category: "dramatic",
    description: "A deep dramatic impact for an over-the-top serious beat.",
    allowedContexts: ["mock_drama", "cliffhanger", "dramatic_pause"],
    blockedContexts: ["grief", "distress", "medical_emergency"],
    minConfidence: 0.91,
    cooldownMs: 25_000,
    defaultGain: 0.6,
    maxPlaysPerSession: 10,
    license: SELF_LICENSE,
  },
  {
    id: "knife_sting",
    file: "/sounds/knife-sting.wav",
    category: "dramatic",
    description: "A sharp suspense sting for exaggerated fake tension.",
    allowedContexts: ["mock_suspense", "over_dramatic_reveal"],
    blockedContexts: ["grief", "distress", "violence", "medical_emergency"],
    minConfidence: 0.94,
    cooldownMs: 40_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 6,
    license: SELF_LICENSE,
  },
  {
    id: "drum_sting",
    file: "/sounds/drum-sting.wav",
    category: "comedy",
    description: "Ba-dum-tss rimshot for a deliberate, groan-worthy punchline or pun.",
    allowedContexts: ["punchline", "pun", "dad_joke", "one_liner"],
    blockedContexts: ["grief", "distress", "insult_at_person"],
    minConfidence: 0.84,
    cooldownMs: 15_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 15,
    license: SELF_LICENSE,
  },
  {
    id: "sad_trombone",
    file: "/sounds/sad-trombone.wav",
    category: "comedy",
    description: "Womp-womp sad trombone for a playful, trivial failure or letdown.",
    allowedContexts: ["playful_failure", "anticlimax", "minor_mishap"],
    blockedContexts: ["grief", "distress", "real_failure", "insult_at_person"],
    minConfidence: 0.88,
    cooldownMs: 25_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 8,
    license: SELF_LICENSE,
  },
  {
    id: "crickets",
    file: "/sounds/crickets.wav",
    category: "comedy",
    description: "Cricket chirps for a joke that intentionally lands flat or an awkward beat.",
    allowedContexts: ["joke_flop", "awkward_silence", "tumbleweed_moment"],
    blockedContexts: ["grief", "distress", "sincere_question"],
    minConfidence: 0.9,
    cooldownMs: 30_000,
    defaultGain: 0.45,
    maxPlaysPerSession: 6,
    license: SELF_LICENSE,
  },
  {
    id: "airhorn",
    file: "/sounds/airhorn.wav",
    category: "comedy",
    description: "Hype airhorn blast for an over-the-top win, mic-drop, or celebration.",
    allowedContexts: ["hype", "mic_drop", "big_win", "celebration"],
    blockedContexts: ["grief", "distress", "quiet_moment"],
    minConfidence: 0.92,
    cooldownMs: 30_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 6,
    license: SELF_LICENSE,
  },
  {
    id: "boing",
    file: "/sounds/boing.wav",
    category: "comedy",
    description: "Cartoon spring boing for silly physical mishaps or absurd statements.",
    allowedContexts: ["silly_mistake", "absurdity", "cartoon_moment"],
    blockedContexts: ["grief", "distress", "real_injury"],
    minConfidence: 0.87,
    cooldownMs: 18_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 10,
    license: SELF_LICENSE,
  },
  {
    id: "tada",
    file: "/sounds/tada.wav",
    category: "positive",
    description: "A little fanfare for an accomplishment, reveal, or proud announcement.",
    allowedContexts: ["achievement", "announcement", "proud_reveal"],
    blockedContexts: ["sarcasm_at_person", "grief"],
    minConfidence: 0.85,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 10,
    license: SELF_LICENSE,
  },
  {
    id: "applause",
    file: "/sounds/applause.wav",
    category: "positive",
    description: "Warm applause for genuine accomplishments or a moment worth celebrating.",
    allowedContexts: ["achievement", "good_news", "well_done"],
    blockedContexts: ["sarcasm_at_person", "grief"],
    minConfidence: 0.85,
    cooldownMs: 20_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 10,
    license: SELF_LICENSE,
  },
  {
    id: "ding",
    file: "/sounds/ding.wav",
    category: "positive",
    description: "A bright correct-answer ding for a good point or emphatic agreement.",
    allowedContexts: ["correct_answer", "agreement", "good_point"],
    blockedContexts: ["sarcasm_at_person"],
    minConfidence: 0.84,
    cooldownMs: 12_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 20,
    license: SELF_LICENSE,
  },
  {
    id: "magic_sparkle",
    file: "/sounds/magic-sparkle.wav",
    category: "positive",
    description: "Twinkling sparkle for whimsy, delight, or a charming little moment.",
    allowedContexts: ["whimsy", "delight", "charming_moment"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.87,
    cooldownMs: 20_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 10,
    license: SELF_LICENSE,
  },
  {
    id: "record_scratch",
    file: "/sounds/record-scratch.wav",
    category: "surprise",
    description: "Record scratch for an abrupt wait-what turn in the conversation.",
    allowedContexts: ["abrupt_turn", "wait_what", "sudden_reversal"],
    blockedContexts: ["grief", "distress"],
    minConfidence: 0.89,
    cooldownMs: 25_000,
    defaultGain: 0.55,
    maxPlaysPerSession: 8,
    license: SELF_LICENSE,
  },
  {
    id: "suspense_riser",
    file: "/sounds/suspense-riser.wav",
    category: "dramatic",
    description: "A rising suspense swell for playful anticipation before a reveal.",
    allowedContexts: ["anticipation", "drumroll_moment", "pre_reveal"],
    blockedContexts: ["grief", "distress", "medical_emergency"],
    minConfidence: 0.9,
    cooldownMs: 30_000,
    defaultGain: 0.5,
    maxPlaysPerSession: 8,
    license: SELF_LICENSE,
  },
  {
    id: "heartbeat",
    file: "/sounds/heartbeat.wav",
    category: "dramatic",
    description: "A quiet heartbeat pulse for exaggerated mock tension.",
    allowedContexts: ["mock_tension", "dramatic_pause"],
    blockedContexts: ["grief", "distress", "medical_emergency", "real_fear"],
    minConfidence: 0.92,
    cooldownMs: 35_000,
    defaultGain: 0.45,
    maxPlaysPerSession: 6,
    license: SELF_LICENSE,
  },
] as const;

export const SOUND_MANIFEST_VERSION = "v1";

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
