import { configureStore } from '@reduxjs/toolkit'
import gameReducer, { defaultProfile, type GamePersistentState } from './gameSlice'

const STORAGE_KEY = 'water-out-puzzle-game-state'

const defaultState: GamePersistentState = {
  nextLevelNumber: 1,
  nextChallengeNumber: 1,
  completedLevels: [],
  completedChallenges: [],
  coins: 0,
  lives: 5,
  nextLifeAtMs: null,
  inventory: { hammer: 0, clock: 0, square: 0, shuffle: 0 },
  lastRewardDate: null,
  profile: { ...defaultProfile },
}

function migratePersisted(raw: unknown): GamePersistentState {
  if (!raw || typeof raw !== 'object') {
    return { ...defaultState }
  }
  const r = raw as Record<string, unknown>
  const merged: GamePersistentState = { ...defaultState }

  if (typeof r.coins === 'number') {
    merged.coins = r.coins
  }
  if (typeof r.lives === 'number') {
    merged.lives = Math.min(5, Math.max(0, r.lives))
  }
  if (typeof r.nextLifeAtMs === 'number' || r.nextLifeAtMs === null) {
    merged.nextLifeAtMs = r.nextLifeAtMs as number | null
  }
  if (r.inventory && typeof r.inventory === 'object') {
    const inv = r.inventory as Record<string, unknown>
    merged.inventory = {
      hammer: typeof inv.hammer === 'number' ? inv.hammer : 0,
      clock: typeof inv.clock === 'number' ? inv.clock : 0,
      square: typeof inv.square === 'number' ? inv.square : 0,
      shuffle: typeof inv.shuffle === 'number' ? inv.shuffle : 0,
    }
  }
  if (typeof r.lastRewardDate === 'string' || r.lastRewardDate === null) {
    merged.lastRewardDate = r.lastRewardDate as string | null
  }

  if (typeof r.nextLevelNumber === 'number') {
    merged.nextLevelNumber = Math.max(1, r.nextLevelNumber)
  } else if (typeof r.currentLevelIndex === 'number') {
    merged.nextLevelNumber = Math.max(1, r.currentLevelIndex + 1)
  }

  if (typeof r.nextChallengeNumber === 'number') {
    merged.nextChallengeNumber = Math.max(1, r.nextChallengeNumber)
  }

  if ('completedChallenges' in r && Array.isArray(r.completedChallenges)) {
    merged.completedChallenges = (r.completedChallenges as unknown[])
      .filter((id): id is number => typeof id === 'number' && id >= 1)
      .filter((id, i, arr) => arr.indexOf(id) === i)
  } else if (typeof r.nextChallengeNumber === 'number' && r.nextChallengeNumber > 1) {
    const lastWon = r.nextChallengeNumber - 1
    merged.completedChallenges = Array.from({ length: lastWon }, (_, i) => lastWon - i)
  }

  if (Array.isArray(r.completedLevels)) {
    merged.completedLevels = r.completedLevels.filter(
      (e): e is GamePersistentState['completedLevels'][number] =>
        e != null &&
        typeof e === 'object' &&
        typeof (e as { id?: unknown }).id === 'number' &&
        ((e as { difficulty?: unknown }).difficulty === 'easy' ||
          (e as { difficulty?: unknown }).difficulty === 'hard'),
    )
  } else if (Array.isArray(r.completedLevelIds)) {
    merged.completedLevels = (r.completedLevelIds as unknown[])
      .filter((id): id is number => typeof id === 'number')
      .map((id) => ({ id, difficulty: 'easy' as const }))
  }

  if (r.profile && typeof r.profile === 'object') {
    const p = r.profile as Record<string, unknown>
    merged.profile = {
      displayName:
        typeof p.displayName === 'string' && p.displayName.trim().length > 0
          ? p.displayName.trim().slice(0, 32)
          : defaultProfile.displayName,
      avatarMode: p.avatarMode === 'photo' ? 'photo' : 'emoji',
      avatarEmoji: typeof p.avatarEmoji === 'string' && p.avatarEmoji.length > 0 ? p.avatarEmoji : defaultProfile.avatarEmoji,
      avatarPhotoDataUrl:
        typeof p.avatarPhotoDataUrl === 'string' && p.avatarPhotoDataUrl.length > 0 ? p.avatarPhotoDataUrl : null,
    }
  }

  return merged
}

function loadGameState(): GamePersistentState | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    return migratePersisted(JSON.parse(raw))
  } catch {
    return undefined
  }
}

const persistedGameState = loadGameState()

export const store = configureStore({
  reducer: {
    game: gameReducer,
  },
  ...(persistedGameState ? { preloadedState: { game: persistedGameState } } : {}),
})

store.subscribe(() => {
  try {
    const stateToSave = store.getState().game
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave))
  } catch {
    // Ignore persistence errors to keep gameplay uninterrupted.
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
