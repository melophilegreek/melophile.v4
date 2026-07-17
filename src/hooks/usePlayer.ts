import { useSyncExternalStore } from 'react';
import { player } from '../lib/player';

export function usePlayer() {
  return useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => player.state,
    () => player.state,
  );
}
