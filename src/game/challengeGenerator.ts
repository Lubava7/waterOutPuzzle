import { generateLevel } from './levelGenerator'
import type { Piece, PieceRewardBooster, Pipe } from './levelTypes'
import { getShapeCells } from './pieceGeometry'

export type ChallengeStage = {
  size: number
  pieces: Piece[]
  pipes: Pipe[]
}

export type ChallengeLevel = {
  id: number
  stages: ChallengeStage[]
  timeLimitSec: number
}

const REWARD_ICONS: Record<PieceRewardBooster, string> = {
  hammer: '🔨',
  clock: '⏰',
  square: '⬜',
  shuffle: '🔀',
}

export function rewardBoosterLabel(id: PieceRewardBooster): string {
  return REWARD_ICONS[id]
}

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BOOSTERS: PieceRewardBooster[] = ['hammer', 'clock', 'square', 'shuffle']

function withChallengeIdsAndRewards(
  pieces: Piece[],
  challengeId: number,
  stageIndex: number,
  rand: () => number,
): Piece[] {
  return pieces.map((p, i) => {
    const base = {
      ...p,
      id: `ch-${challengeId}-s${stageIndex}-${i}-${p.id}`,
    }
    if (rand() < 0.28) {
      const cells = getShapeCells(p)
      const cell = cells[Math.floor(rand() * cells.length)]!
      return {
        ...base,
        rewardBooster: BOOSTERS[Math.floor(rand() * BOOSTERS.length)]!,
        rewardBoosterCell: { row: cell.row, col: cell.col },
      }
    }
    return base
  })
}

/** Несколько последовательных полей; уровни как в кампании, но сложнее и с наградами в фигурах. */
export function generateChallenge(challengeId: number): ChallengeLevel {
  const rand = mulberry32(challengeId * 99_901 + 42_337)
  const stageCount = 2 + (challengeId % 2)
  const stages: ChallengeStage[] = []

  for (let s = 0; s < stageCount; s += 1) {
    const syntheticLevelId = 50_000 + challengeId * 10 + s * 17
    const L = generateLevel(syntheticLevelId)
    const pieces = withChallengeIdsAndRewards(L.pieces, challengeId, s, rand)
    stages.push({
      size: L.size,
      pieces,
      pipes: L.pipes,
    })
  }

  const timeLimitSec = 75 + stageCount * 55 + Math.floor(rand() * 40)

  return {
    id: challengeId,
    stages,
    timeLimitSec,
  }
}
