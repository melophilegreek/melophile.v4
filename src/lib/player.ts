import type { RepeatMode, ShuffleMode, Song } from '../types';
import { getFile } from './db';

type Listener = () => void;

export interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffleMode: ShuffleMode;
  repeat: RepeatMode;
  queue: Song[];
  currentIndex: number;
  objectUrl: string | null;
  userQueue: Song[];
}

// DIAGNOSTIC (intermittent "song doesn't play" reports): the audio element's
// `error` event was previously caught with no logging at all, so a file that
// failed to decode (corrupt encode, container/codec the browser can't play,
// a bad blob URL, etc.) just silently reset isPlaying/isLoading with zero
// trace of why. MediaError only exposes a numeric `code`, so we map it to a
// human-readable reason here.
function describeMediaError(err: MediaError | null): string {
  if (!err) return 'unknown (no MediaError object present)';
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED: return 'MEDIA_ERR_ABORTED — fetching the media was aborted';
    case MediaError.MEDIA_ERR_NETWORK: return 'MEDIA_ERR_NETWORK — a network error occurred while fetching the media';
    case MediaError.MEDIA_ERR_DECODE: return 'MEDIA_ERR_DECODE — the media could not be decoded (corrupt file or unsupported encoding profile)';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'MEDIA_ERR_SRC_NOT_SUPPORTED — this format/codec is not supported by the browser';
    default: return `unrecognized error code ${err.code}`;
  }
}

function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Player {
  readonly audio = new Audio();
  private _state: PlayerState = {
    currentSong: null, isPlaying: false, isLoading: false,
    currentTime: 0, duration: 0, volume: 0.8, muted: false,
    shuffleMode: 'off', repeat: 'off',
    queue: [], currentIndex: -1, objectUrl: null, userQueue: [],
  };
  private _library: Song[] = [];
  private _viewSongs: Song[] = [];
  private _objectUrl: string | null = null;
  private listeners = new Set<Listener>();
  // Monotonically increasing request id, used by loadSong() to detect and
  // discard stale async results (see the race-condition fix below).
  private _loadToken = 0;
  // Called when a song starts playing — used to log a "recently played"
  // history entry (this fires immediately, regardless of how much of the
  // song actually gets listened to).
  onPlayStart: ((song: Song) => void) | null = null;
  // Called at most once per continuous play session, the moment playback
  // position first crosses 75% of the song's duration — this is what
  // actually increments the song's play count (see TASK 3: a "play" only
  // counts once the listener has heard at least 75% of the track).
  onThresholdReached: ((song: Song) => void) | null = null;
  // TASK 3 (75%-threshold play counting): tracks whether the threshold has
  // already fired for the song currently loaded, so that scrubbing back
  // below 75% and letting playback cross it again doesn't fire a second
  // time for the same continuous listen. Reset whenever a genuinely new
  // playthrough starts (a different song loads, or repeat-one restarts the
  // same song from 0) — see loadSong() and the repeat-one branch of
  // _handleEnd() below.
  private _thresholdReached = false;

  constructor() {
    const a = this.audio;
    a.volume = 0.8;
    a.addEventListener('timeupdate', () => {
      this._patch({ currentTime: a.currentTime });
      // TASK 3: fire the play-count callback the first time this
      // continuous session crosses 75% of the track's duration. Guarded by
      // _thresholdReached so it can only fire once per session (see the
      // field comment above for what resets it) — e.g. scrubbing from 80%
      // back to 50% and letting it play back up to 75% again must NOT
      // increment the count a second time.
      const song = this._state.currentSong;
      if (song && !this._thresholdReached && a.duration > 0 && isFinite(a.duration)) {
        if (a.currentTime / a.duration >= 0.75) {
          this._thresholdReached = true;
          this.onThresholdReached?.(song);
        }
      }
    });
    a.addEventListener('durationchange', () => this._patch({ duration: isFinite(a.duration) ? a.duration : 0 }));
    a.addEventListener('playing', () => this._patch({ isPlaying: true, isLoading: false }));
    a.addEventListener('pause', () => this._patch({ isPlaying: false }));
    a.addEventListener('waiting', () => this._patch({ isLoading: true }));
    a.addEventListener('canplay', () => this._patch({ isLoading: false }));
    a.addEventListener('ended', () => this._handleEnd());
    // DIAGNOSTIC: log which song failed and why, instead of failing silently.
    // If this fires, the browser could not play the file at all (MediaError),
    // which is a different — and more informative — failure than a rejected
    // play() promise (see the play()/loadSong() catch blocks below).
    a.addEventListener('error', () => {
      console.error(
        `Playback error for "${this._state.currentSong?.title ?? 'unknown song'}"` +
        `${this._state.currentSong?.fileName ? ` (${this._state.currentSong.fileName})` : ''}: ` +
        describeMediaError(a.error),
        { song: this._state.currentSong, src: a.currentSrc, mediaError: a.error },
      );
      this._patch({ isLoading: false, isPlaying: false });
    });
  }

  get state(): PlayerState { return this._state; }
  private _patch(patch: Partial<PlayerState>) {
    this._state = { ...this._state, ...patch };
    this.listeners.forEach((l) => l());
  }
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setLibrary(library: Song[], viewSongs: Song[]) { this._library = library; this._viewSongs = viewSongs; }
  initQueue(songs: Song[]) { if (this._state.queue.length === 0) this._patch({ queue: songs, currentIndex: 0 }); }

  buildQueue(clickedSong: Song, viewSongs: Song[]): { queue: Song[]; idx: number } {
    const { shuffleMode } = this._state;
    if (shuffleMode === 'off') {
      const idx = viewSongs.findIndex((s) => s.id === clickedSong.id);
      return { queue: viewSongs, idx: idx >= 0 ? idx : 0 };
    }
    const source = shuffleMode === 'library' ? this._library : viewSongs;
    const rest = source.filter((s) => s.id !== clickedSong.id);
    return { queue: [clickedSong, ...fisherYates(rest)], idx: 0 };
  }

  async loadSong(song: Song, autoplay = true) {
    // BUG FIX (race condition on rapid song change): loadSong is async
    // (it awaits an IndexedDB read via getFile), so calling next()/previous()
    // in quick succession could previously start several overlapping loads.
    // Whichever one's getFile() happened to resolve *last* would win — not
    // necessarily the most recently requested song — so the audio element
    // and currentSong state could end up playing/showing different tracks,
    // and a stale load could even revoke the blob URL a newer load was still
    // using. Each call now gets a token; if a newer loadSong() has started
    // by the time this one's await resolves, this one bails out instead of
    // touching the audio element or state.
    const token = ++this._loadToken;
    // New playthrough — reset the 75% play-count guard for TASK 3.
    this._thresholdReached = false;
    this._patch({ isLoading: true, currentSong: song });
    if (autoplay && this.onPlayStart) this.onPlayStart(song);
    try {
      const blob = await getFile(song.fileKey);
      if (token !== this._loadToken) return; // superseded by a newer load
      if (!blob) {
        // DIAGNOSTIC: this is a strong candidate for "sometimes a song just
        // doesn't play" — getFile() succeeded but found nothing under this
        // song's fileKey (e.g. the blob was evicted by the browser under
        // storage pressure, or the 'files' record never got written). This
        // used to fail completely silently.
        console.error(
          `loadSong: no stored audio blob found for "${song.title}" (fileKey: ${song.fileKey}). ` +
          `The song's IndexedDB file record is missing — it will not play.`,
          { song },
        );
        this._patch({ isLoading: false });
        return;
      }
      if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = URL.createObjectURL(blob);
      this.audio.src = this._objectUrl;
      this.audio.load();
      this._patch({ objectUrl: this._objectUrl });
      if (autoplay) await this.audio.play();
    } catch (e) {
      if (token !== this._loadToken) return; // superseded, don't clobber newer state
      // DIAGNOSTIC: include the song so a failure can be tied back to a
      // specific file (e.g. a getFile() rejection because its IndexedDB
      // blob is missing/corrupt, or a play() rejection from autoplay policy).
      console.error(`loadSong failed for "${song.title}" (${song.fileName})`, e);
      this._patch({ isLoading: false });
    }
  }

  async playSong(song: Song, viewSongs: Song[]) {
    const { queue, idx } = this.buildQueue(song, viewSongs);
    this._patch({ queue, currentIndex: idx, userQueue: [] });
    await this.loadSong(song, true);
  }

  /**
   * Add a song to the end of the user queue.
   * BUG FIX (duplicates in queue): this used to skip the add if a song with
   * the same id was already queued (`if (!uq.some(...)) uq.push(song)`), so
   * queuing the same track twice silently did nothing. The queue is allowed
   * to contain the same song multiple times — each add should create another
   * independent entry — so we always push now.
   */
  addToQueue(song: Song) {
    this._patch({ userQueue: [...this._state.userQueue, song] });
  }

  /**
   * Add a song to the front of the user queue (play next).
   * Same duplicate-guard removal as addToQueue above — always unshift.
   */
  playNext(song: Song) {
    this._patch({ userQueue: [song, ...this._state.userQueue] });
  }

  /**
   * Remove a single entry from the user queue by its position.
   * BUG FIX (duplicates in queue): this previously took a songId and
   * filtered every entry with that id out of the queue
   * (`userQueue.filter((s) => s.id !== songId)`). That's correct when a song
   * can only appear once, but now that duplicates are allowed, removing "the"
   * entry for a songId would remove *every* copy of that song from the queue
   * instead of just the one the person removed. Queue entries are now
   * addressed by index (their position in userQueue) so only the specific
   * entry that was interacted with is removed; other copies of the same song
   * are left untouched. Reordering (reorderQueue, below) already worked by
   * index, so this brings removeFromQueue in line with it.
   */
  removeFromQueue(index: number) {
    const uq = [...this._state.userQueue];
    if (index < 0 || index >= uq.length) return;
    uq.splice(index, 1);
    this._patch({ userQueue: uq });
  }

  /** Reorder: move queue item at `from` to `to` */
  reorderQueue(from: number, to: number) {
    const uq = [...this._state.userQueue];
    if (from < 0 || from >= uq.length || to < 0 || to >= uq.length) return;
    const [item] = uq.splice(from, 1);
    uq.splice(to, 0, item);
    this._patch({ userQueue: uq });
  }

  clearQueue() { this._patch({ userQueue: [] }); }

  /**
   * Remove a song from playback state after it has been deleted from the
   * library. Strips it out of the queue and user-queue so it can never be
   * navigated back to (its file/blob no longer exists in storage). If it
   * was the currently-playing song, playback is stopped and — if there is
   * anything left in the queue — advances to the next available song.
   */
  removeSong(songId: string) {
    const { queue, currentIndex, currentSong, userQueue } = this._state;
    const wasCurrent = currentSong?.id === songId;
    const removedIdx = queue.findIndex((s) => s.id === songId);
    const newQueue = queue.filter((s) => s.id !== songId);
    const newUserQueue = userQueue.filter((s) => s.id !== songId);

    if (!wasCurrent) {
      // Keep currentIndex pointing at the same song if something earlier
      // in the queue was removed.
      const newIndex = removedIdx !== -1 && removedIdx < currentIndex ? currentIndex - 1 : currentIndex;
      this._patch({ queue: newQueue, userQueue: newUserQueue, currentIndex: newIndex });
      return;
    }

    // The playing song itself was deleted: stop audio and release its blob URL.
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this._objectUrl) { URL.revokeObjectURL(this._objectUrl); this._objectUrl = null; }

    if (newUserQueue.length > 0 || newQueue.length > 0) {
      // Prefer the user queue (matches `next()` behavior), otherwise fall
      // back to whatever now sits at the same position in the queue.
      if (newUserQueue.length > 0) {
        const nextSong = newUserQueue[0];
        this._patch({
          queue: newQueue, userQueue: newUserQueue.slice(1),
          currentSong: null, isPlaying: false, isLoading: false,
          currentTime: 0, duration: 0, objectUrl: null,
        });
        this.loadSong(nextSong, true);
        return;
      }
      const newIndex = Math.min(removedIdx, newQueue.length - 1);
      this._patch({
        queue: newQueue, userQueue: newUserQueue, currentIndex: newIndex,
        currentSong: null, isPlaying: false, isLoading: false,
        currentTime: 0, duration: 0, objectUrl: null,
      });
      this.loadSong(newQueue[newIndex], true);
      return;
    }

    // Nothing left to play at all.
    this._patch({
      queue: [], userQueue: [], currentIndex: -1, currentSong: null,
      isPlaying: false, isLoading: false, currentTime: 0, duration: 0, objectUrl: null,
    });
  }

  async play() {
    if (!this.audio.src) return;
    try {
      await this.audio.play();
    } catch (e) {
      // BUG FIX: togglePlay() calls play() without awaiting/catching it, so a
      // rejected play() promise (e.g. an AbortError when play() is interrupted
      // by a near-simultaneous load(), or a browser autoplay-policy rejection)
      // was surfacing as an unhandled promise rejection / console error with
      // the UI stuck showing "playing". Catch it here and resync state.
      console.error(
        `play() failed for "${this._state.currentSong?.title ?? 'unknown song'}": ${e instanceof Error ? e.name + ' — ' + e.message : e}`,
      );
      this._patch({ isPlaying: false, isLoading: false });
    }
  }
  pause() { this.audio.pause(); }
  togglePlay() { if (this._state.isPlaying) this.pause(); else this.play(); }
  seek(time: number) { this.audio.currentTime = Math.max(0, Math.min(time, this._state.duration)); }
  setVolume(v: number) { this.audio.volume = v; this.audio.muted = false; this._patch({ volume: v, muted: false }); }
  setMuted(m: boolean) { this.audio.muted = m; this._patch({ muted: m }); }

  setShuffle(mode: ShuffleMode) {
    if (mode === this._state.shuffleMode) return;
    const { queue, currentIndex } = this._state;
    const current = queue[currentIndex];
    if (mode === 'off') {
      const source = this._viewSongs;
      const idx = current ? source.findIndex((s) => s.id === current.id) : 0;
      this._patch({ shuffleMode: mode, queue: source, currentIndex: idx >= 0 ? idx : 0 });
    } else {
      const source = mode === 'library' ? this._library : this._viewSongs;
      const rest = current ? source.filter((s) => s.id !== current.id) : source;
      const shuffled = current ? [current, ...fisherYates(rest)] : fisherYates(rest);
      this._patch({ shuffleMode: mode, queue: shuffled, currentIndex: 0 });
    }
  }

  setRepeat(mode: RepeatMode) { this._patch({ repeat: mode }); }

  async next(auto = false) {
    const { queue, currentIndex, repeat, userQueue } = this._state;
    if (!queue.length) return;
    if (userQueue.length > 0) {
      const nextSong = userQueue[0];
      this._patch({ userQueue: userQueue.slice(1) });
      await this.loadSong(nextSong, true);
      return;
    }
    let next = currentIndex + 1;
    if (next >= queue.length) {
      if (repeat === 'all') next = 0;
      else if (auto) { this._patch({ isPlaying: false }); return; }
      else next = 0;
    }
    this._patch({ currentIndex: next });
    await this.loadSong(queue[next], true);
  }

  async previous() {
    const { queue, currentIndex, repeat } = this._state;
    if (!queue.length) return;
    if (this.audio.currentTime > 3) { this.seek(0); return; }
    let prev = currentIndex - 1;
    if (prev < 0) prev = repeat === 'all' ? queue.length - 1 : 0;
    this._patch({ currentIndex: prev });
    await this.loadSong(queue[prev], true);
  }

  private _handleEnd() {
    const { repeat } = this._state;
    if (repeat === 'one') {
      // Restarting the same song from 0 is a brand-new playthrough, so it
      // should be able to earn another qualifying play once it crosses 75%
      // again (TASK 3).
      this._thresholdReached = false;
      this.seek(0); this.play(); return;
    }
    this.next(true);
  }

  /**
   * Full reset for "delete all songs" — every currently-loaded/queued song is
   * about to stop existing in storage, so unlike removeSong() (which tries to
   * advance to the next available track) there is nothing left to advance to.
   * Stops audio, releases the blob URL, and clears the in-memory library
   * reference so a stale song list can't be handed back out via buildQueue().
   */
  clearAll() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this._objectUrl) { URL.revokeObjectURL(this._objectUrl); this._objectUrl = null; }
    this._library = [];
    this._viewSongs = [];
    this._patch({
      queue: [], userQueue: [], currentIndex: -1, currentSong: null,
      isPlaying: false, isLoading: false, currentTime: 0, duration: 0, objectUrl: null,
    });
  }

  patchCurrentSong(updated: Song) {
    if (this._state.currentSong?.id === updated.id) this._patch({ currentSong: updated });
  }
}

export const player = new Player();
