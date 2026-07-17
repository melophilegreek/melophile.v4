import type { Song } from '../types';

// Album art placeholder: previously each of the 4 places that render art
// (SongRow, PlayerBar, StatsScreen, QueuePanel) had its own copy-pasted
// `gradientFor(title)` helper that hashed the title into a random-ish hue,
// so two tracks sitting next to each other could get wildly different
// background colors and there was no way to tell tracks apart at a glance
// (just a generic note icon on top). This replaces all four with a single
// shared placeholder: the artist's (or failing that, the track's) initial
// letter, on the app's actual accent color -- consistent across every
// screen and tied to the theme instead of being effectively random.

/** First letter (uppercased) to show on a placeholder tile: prefers the
 *  artist, falls back to the title, falls back to '?' if neither has one. */
export function initialFor(song: Song): string {
  const source = (song.artist?.trim() || song.title?.trim() || '').charAt(0);
  return source ? source.toUpperCase() : '?';
}

/** Placeholder tile background: a low-opacity tint of the current accent
 *  color, so it reads as "no art yet" rather than competing with real
 *  album art or the row's hover state. */
export function placeholderBackground(accentColor: string): string {
  return `${accentColor}26`; // ~15% opacity (hex alpha)
}
