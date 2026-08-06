/**
 * Inline SVG icons from Lucide (https://lucide.dev, ISC license).
 * Inlined because the site's CSP forbids external assets.
 */

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

function svg(body: string): string {
  return `${SVG_OPEN}${body}</svg>`;
}

const SPEAKER_PATH =
  '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/>';

export const ICONS = {
  pause: svg(
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  ),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  volume: svg(
    `${SPEAKER_PATH}<path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`,
  ),
  volumeMuted: svg(
    `${SPEAKER_PATH}<line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>`,
  ),
  shield: svg(
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.94a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  ),
  square: svg('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
} as const;

export type IconName = keyof typeof ICONS;
