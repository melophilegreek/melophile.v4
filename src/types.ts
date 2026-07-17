export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  kbps: number | null;
  albumArtData?: ArrayBuffer;
  albumArtMime?: string;
  fileKey: string;
  addedAt: number;
  fileName: string;
  fileSize: number;
  playCount: number;
  lastPlayedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
}

export interface Preferences {
  accentColor: string;
}

export interface HistoryEntry {
  id: string;        // `${songId}-${timestamp}`
  songId: string;
  playedAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type ShuffleMode = 'off' | 'view' | 'library';
export type AppView = 'library' | 'liked' | 'most-played' | 'stats' | 'queue' | { type: 'playlist'; id: string };

// Format support: added Opus (Ogg container, same as .ogg) and AIFF/AIF.
// WMA and APE are deliberately NOT included -- no mainstream browser ships a
// decoder for either, so <audio>/Web Audio simply can't play them back. Real
// support would mean bundling a full transcoder (e.g. ffmpeg.wasm, ~25-30MB)
// just to unlock two formats, which is a much bigger call than a format-list
// change -- flagging this rather than quietly shipping files that import
// but won't play.
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.ogg', '.opus', '.aac', '.m4a', '.aiff', '.aif'];
// Sapphire blue, matching the app icon -- previously Spotify green
// ('#1DB954'), which is kept as a selectable preset in Settings but is no
// longer the default. Deliberately reuses the exact value of the existing
// "Sapphire" premium preset (see SettingsPanel.tsx's PREMIUM_PRESETS)
// rather than a new hex, so the default is a color that's already
// selectable/tested elsewhere in the app.
export const DEFAULT_ACCENT = '#2C5FCC';
export const ROW_HEIGHT = 56;
// Height of the "Pinned" section header row inserted above pinned songs in
// the Library/Playlist views (Feature: Pin/Unpin). Deliberately shorter than
// ROW_HEIGHT since it's a label, not a song row.
export const PINNED_HEADER_HEIGHT = 32;

// A row rendered by VirtualList in views that support pinned-song grouping
// (Library, Playlist). `displayIndex` is the song's 0-based position within
// the pinned-then-unpinned ordering, used for the row's numbered index label
// -- kept separate from the row's raw position in this array so inserting
// the header doesn't shift the numbers shown to the user.
export type LibraryRow =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'song'; song: Song; displayIndex: number };
