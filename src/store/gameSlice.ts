import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type Inventory = {
  hammer: number
  clock: number
  square: number
  shuffle: number
}

export type BoosterId = keyof Inventory

export const SHOP_PRICES: Record<BoosterId, number> = {
  hammer: 150,
  clock: 50,
  square: 100,
  shuffle: 200,
}

export type CompletedLevelEntry = {
  id: number
  difficulty: 'easy' | 'hard'
}

export type ProfileAvatarMode = 'emoji' | 'photo'

export type ProfileState = {
  displayName: string
  avatarMode: ProfileAvatarMode
  avatarEmoji: string
  avatarPhotoDataUrl: string | null
}

const defaultProfile: ProfileState = {
  displayName: 'Игрок',
  avatarMode: 'emoji',
  avatarEmoji: '🐙',
  avatarPhotoDataUrl: null,
}

export type GamePersistentState = {
  nextLevelNumber: number
  nextChallengeNumber: number
  completedLevels: CompletedLevelEntry[]
  /** Номера челленджей, пройденных хотя бы раз (новые сверху). */
  completedChallenges: number[]
  coins: number
  lives: number
  nextLifeAtMs: number | null
  inventory: Inventory
  lastRewardDate: string | null
  profile: ProfileState
  /** @deprecated kept for migration from older saves */
  currentLevelIndex?: number
  completedLevelIds?: number[]
}

export const CHALLENGE_WIN_COINS = 120
export const CHALLENGE_WIN_BOOSTERS: BoosterId[] = ['hammer', 'clock', 'square', 'shuffle']

const initialState: GamePersistentState = {
  nextLevelNumber: 1,
  nextChallengeNumber: 1,
  completedLevels: [],
  completedChallenges: [],
  coins: 0,
  lives: 5,
  nextLifeAtMs: null,
  inventory: {
    hammer: 0,
    clock: 0,
    square: 0,
    shuffle: 0,
  },
  lastRewardDate: null,
  profile: { ...defaultProfile },
}

const LIFE_REGEN_MS = 15 * 60 * 1000

const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    hydrateGameState: (_, action: PayloadAction<GamePersistentState>) => action.payload,
    tickLives: (state) => {
      if (state.lives >= 5) {
        state.nextLifeAtMs = null
        return
      }
      const now = Date.now()
      let nextAt = state.nextLifeAtMs
      if (nextAt == null) {
        state.nextLifeAtMs = now + LIFE_REGEN_MS
        return
      }
      while (state.lives < 5 && now >= nextAt) {
        state.lives += 1
        if (state.lives >= 5) {
          state.nextLifeAtMs = null
          return
        }
        nextAt += LIFE_REGEN_MS
        state.nextLifeAtMs = nextAt
      }
    },
    loseLife: (state) => {
      if (state.lives <= 0) {
        return
      }
      state.lives -= 1
      if (state.lives < 5 && state.nextLifeAtMs == null) {
        state.nextLifeAtMs = Date.now() + LIFE_REGEN_MS
      }
    },
    addCoins: (state, action: PayloadAction<number>) => {
      state.coins += Math.max(0, action.payload)
    },
    grantBooster: (state, action: PayloadAction<BoosterId>) => {
      const id = action.payload
      state.inventory[id] += 1
    },
    addLife: (state, action: PayloadAction<number>) => {
      const n = Math.max(0, Math.floor(action.payload))
      state.lives = Math.min(5, state.lives + n)
      if (state.lives >= 5) {
        state.nextLifeAtMs = null
      }
    },
    completeChallengeWin: (state) => {
      const wonId = state.nextChallengeNumber
      if (!state.completedChallenges.includes(wonId)) {
        state.completedChallenges.unshift(wonId)
      }
      state.coins += CHALLENGE_WIN_COINS
      const pick = CHALLENGE_WIN_BOOSTERS[Math.floor(Math.random() * CHALLENGE_WIN_BOOSTERS.length)]!
      state.inventory[pick] += 1
      state.lives = Math.min(5, state.lives + 1)
      state.nextChallengeNumber += 1
    },
    buyBooster: (state, action: PayloadAction<BoosterId>) => {
      const id = action.payload
      const price = SHOP_PRICES[id]
      if (state.coins >= price) {
        state.coins -= price
        state.inventory[id] += 1
      }
    },
    completeCurrentLevel: (state, action: PayloadAction<CompletedLevelEntry>) => {
      const entry = action.payload
      const exists = state.completedLevels.some((e) => e.id === entry.id && e.difficulty === entry.difficulty)
      if (!exists) {
        state.completedLevels.unshift(entry)
      }
      state.nextLevelNumber = Math.max(state.nextLevelNumber, entry.id + 1)
    },
    setCurrentLevelNumber: (state, action: PayloadAction<number>) => {
      state.nextLevelNumber = Math.max(1, action.payload)
    },
    addDailyReward: (state) => {
      state.inventory.hammer += 1
      state.inventory.clock += 1
      state.inventory.square += 1
      state.lastRewardDate = new Date().toDateString()
    },
    consumeItem: (state, action: PayloadAction<BoosterId>) => {
      const item = action.payload
      if (state.inventory[item] > 0) {
        state.inventory[item] -= 1
      }
    },
    setProfileDisplayName: (state, action: PayloadAction<string>) => {
      const name = action.payload.trim().slice(0, 32)
      state.profile.displayName = name.length > 0 ? name : defaultProfile.displayName
    },
    setProfileAvatarEmoji: (state, action: PayloadAction<string>) => {
      state.profile.avatarEmoji = action.payload
      state.profile.avatarMode = 'emoji'
      state.profile.avatarPhotoDataUrl = null
    },
    setProfileAvatarPhoto: (state, action: PayloadAction<string | null>) => {
      state.profile.avatarPhotoDataUrl = action.payload
      if (action.payload) {
        state.profile.avatarMode = 'photo'
      } else {
        state.profile.avatarMode = 'emoji'
      }
    },
  },
})

export const {
  hydrateGameState,
  tickLives,
  loseLife,
  addCoins,
  grantBooster,
  addLife,
  buyBooster,
  completeCurrentLevel,
  completeChallengeWin,
  setCurrentLevelNumber,
  addDailyReward,
  consumeItem,
  setProfileDisplayName,
  setProfileAvatarEmoji,
  setProfileAvatarPhoto,
} = gameSlice.actions

export { defaultProfile }

export default gameSlice.reducer
