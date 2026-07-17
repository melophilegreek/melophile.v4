import type { Song } from '../types';
import type { VirtualListHandle } from './VirtualList';

const LETTERS = ['#','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

function getLetterKey(title: string): string {
  const c = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

interface Props {
  songs: Song[];
  accentColor: string;
  listRef: React.RefObject<VirtualListHandle>;
  /**
   * Row-index offset to add before calling scrollToIndex. Needed in views
   * where VirtualList's item array has extra rows before the songs -- e.g.
   * the Library/Playlist "Pinned" section header (see App.tsx's `rows`
   * construction). `songs` here should still be in the exact display order
   * (pinned first, then unpinned) so the letter->position mapping matches.
   * Defaults to 0 for views with no such header (Liked Songs, etc).
   */
  indexOffset?: number;
}

export function AlphaScrollBar({ songs, accentColor, listRef, indexOffset = 0 }: Props) {
  const letterIndex = new Map<string, number>();
  songs.forEach((song, i) => {
    const key = getLetterKey(song.title);
    if (!letterIndex.has(key)) letterIndex.set(key, i);
  });

  return (
    <div className="flex flex-col items-center justify-center py-2 select-none z-10">
      {LETTERS.map((letter) => {
        const hasMatch = letterIndex.has(letter);
        return (
          <button
            key={letter}
            onClick={() => { const idx = letterIndex.get(letter); if (idx !== undefined) listRef.current?.scrollToIndex(idx + indexOffset); }}
            disabled={!hasMatch}
            className="w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded transition-colors leading-none"
            style={{ color: hasMatch ? accentColor : 'rgba(255,255,255,0.2)', cursor: hasMatch ? 'pointer' : 'default' }}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
