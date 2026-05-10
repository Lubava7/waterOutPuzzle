import type { Piece, PieceColor, Pipe, Level } from './levelTypes'
import { getAbsoluteCells, getShapeCells, isInsideBoard, somePieceHasSlideMove, toCellId } from './pieceGeometry'
import {
  getValidPipeRowsForSide,
  intersectSets,
  pickTwoDistinctRows,
  winCellsForColor,
} from './pipeReachability'

export type { Level, Piece, PieceColor, Pipe } from './levelTypes'

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COLORS: PieceColor[] = ['red', 'blue', 'green', 'yellow']

type ShapeKind = Piece['shape']

function pickShape(rand: () => number, difficulty: 'easy' | 'hard'): { shape: ShapeKind; orientation?: 'horizontal' | 'vertical' } {
  const roll = rand()
  const orient = rand() < 0.5 ? 'horizontal' : 'vertical'
  if (difficulty === 'easy') {
    if (roll < 0.35) {
      return { shape: 'smallSquare' }
    }
    if (roll < 0.55) {
      return { shape: 'rect2', orientation: orient }
    }
    if (roll < 0.8) {
      return { shape: 'rect3', orientation: orient }
    }
    if (roll < 0.92) {
      return { shape: 'corner' }
    }
    return { shape: 'bigSquare' }
  }
  if (roll < 0.15) {
    return { shape: 'smallSquare' }
  }
  if (roll < 0.35) {
    return { shape: 'rect2', orientation: orient }
  }
  if (roll < 0.55) {
    return { shape: 'rect3', orientation: orient }
  }
  if (roll < 0.75) {
    return { shape: 'corner' }
  }
  return { shape: 'bigSquare' }
}

function hasOverlap(pieces: Piece[]) {
  const occ = new Set<string>()
  for (const p of pieces) {
    for (const c of getAbsoluteCells(p)) {
      const id = toCellId(c.row, c.col)
      if (occ.has(id)) {
        return true
      }
      occ.add(id)
    }
  }
  return false
}

function buildReachablePipes(pieces: Piece[], boardSize: number, rand: () => number): Pipe[] | null {
  const byColor: Record<PieceColor, Set<number>> = {
    red: new Set(),
    blue: new Set(),
    green: new Set(),
    yellow: new Set(),
  }

  for (const c of COLORS) {
    const side: 'left' | 'right' = COLORS.indexOf(c) % 2 === 0 ? 'left' : 'right'
    const parts = pieces.filter((p) => p.color === c)
    const sets = parts.map((p) => getValidPipeRowsForSide(p.shape, p.orientation, side, boardSize))
    const inter = intersectSets(sets)
    if (inter.size === 0) {
      return null
    }
    byColor[c] = inter
  }

  const leftPair = pickTwoDistinctRows(byColor.red, byColor.green, rand)
  const rightPair = pickTwoDistinctRows(byColor.blue, byColor.yellow, rand)
  if (!leftPair || !rightPair) {
    return null
  }

  return [
    { side: 'left', row: leftPair.first, color: 'red' },
    { side: 'right', row: rightPair.first, color: 'blue' },
    { side: 'left', row: leftPair.second, color: 'green' },
    { side: 'right', row: rightPair.second, color: 'yellow' },
  ]
}

const MAX_BACKTRACK_STEPS = 1_200_000

function shuffleInPlace<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
}

/**
 * Точная расстановка полиомино: случайный перебор почти никогда не находит решение;
 * backtracking перебирает позиции и надёжно находит раскладку, если она существует.
 */
function tryPlaceAll(
  pieces: Piece[],
  pipes: Pipe[],
  boardSize: number,
  rand: () => number,
  _legacyMaxTriesIgnored?: number,
): Piece[] | null {
  const trial = pieces.map((p) => ({ ...p }))
  const order = [...trial].sort(
    (a, b) => getShapeCells(b).length - getShapeCells(a).length || (rand() - 0.5),
  )
  shuffleInPlace(order, rand)

  const occupied = new Set<string>()
  let steps = 0

  function canPlace(piece: Piece, row: number, col: number): boolean {
    if (!isInsideBoard(piece, row, col, boardSize)) {
      return false
    }
    const forbidden = winCellsForColor(pipes, piece.color, boardSize)
    const cells = getAbsoluteCells(piece, row, col)
    for (const c of cells) {
      const id = toCellId(c.row, c.col)
      if (forbidden.has(id) || occupied.has(id)) {
        return false
      }
    }
    return true
  }

  function dfs(i: number): boolean {
    if (i >= order.length) {
      return true
    }
    steps += 1
    if (steps > MAX_BACKTRACK_STEPS) {
      return false
    }
    const piece = order[i]!
    const candidates: Array<{ row: number; col: number }> = []
    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        if (canPlace(piece, row, col)) {
          candidates.push({ row, col })
        }
      }
    }
    shuffleInPlace(candidates, rand)

    for (const { row, col } of candidates) {
      const cells = getAbsoluteCells(piece, row, col)
      for (const c of cells) {
        occupied.add(toCellId(c.row, c.col))
      }
      piece.row = row
      piece.col = col
      if (dfs(i + 1)) {
        return true
      }
      for (const c of cells) {
        occupied.delete(toCellId(c.row, c.col))
      }
    }
    return false
  }

  return dfs(0) ? trial : null
}

export function levelDifficulty(levelId: number): 'easy' | 'hard' {
  return levelId % 3 === 0 ? 'hard' : 'easy'
}

export function makeLevelSeed(levelId: number, difficulty: 'easy' | 'hard'): number {
  return levelId * 1_000_003 + (difficulty === 'hard' ? 97_777 : 13_337)
}

export function generateLevel(levelId: number): Level {
  const difficulty = levelDifficulty(levelId)
  const seed = makeLevelSeed(levelId, difficulty)
  const rand = mulberry32(seed)
  const size = difficulty === 'easy' ? 5 + Math.floor(rand() * 2) : 6 + Math.floor(rand() * 2)

  const pieceCount = difficulty === 'easy' ? 4 + Math.floor(rand() * 2) : 6 + Math.floor(rand() * 3)

  const MAX_LAYOUT_ATTEMPTS = 52
  const MAX_PLACE_ROUNDS = 64

  for (let genAttempt = 0; genAttempt < MAX_LAYOUT_ATTEMPTS; genAttempt += 1) {
    const pieces: Piece[] = []
    for (let i = 0; i < pieceCount; i += 1) {
      const color = COLORS[i % 4]
      const { shape, orientation } = pickShape(rand, difficulty)
      pieces.push({
        id: `g-${levelId}-${i}-${genAttempt}`,
        color,
        shape,
        orientation,
        row: 0,
        col: 0,
      })
    }

    const pipes = buildReachablePipes(pieces, size, rand)
    if (!pipes) {
      continue
    }

    for (let placeAttempt = 0; placeAttempt < MAX_PLACE_ROUNDS; placeAttempt += 1) {
      const trial = tryPlaceAll(pieces, pipes, size, rand)
      if (trial && !hasOverlap(trial) && somePieceHasSlideMove(trial, size)) {
        return {
          id: levelId,
          seed,
          difficulty,
          size,
          pieces: trial,
          pipes,
        }
      }
    }
  }

  const FALLBACK_SHAPE_ROUNDS = 22
  const FALLBACK_PLACE_ROUNDS = 48
  for (let fb = 0; fb < FALLBACK_SHAPE_ROUNDS; fb += 1) {
    const diversePieces: Piece[] = []
    for (let i = 0; i < pieceCount; i += 1) {
      const color = COLORS[i % 4]
      const { shape, orientation } = pickShape(rand, difficulty)
      diversePieces.push({
        id: `g-${levelId}-div-${fb}-${i}`,
        color,
        shape,
        orientation,
        row: 0,
        col: 0,
      })
    }
    const fbPipes = buildReachablePipes(diversePieces, size, rand)
    if (!fbPipes) {
      continue
    }
    for (let r = 0; r < FALLBACK_PLACE_ROUNDS; r += 1) {
      const trial = tryPlaceAll(diversePieces, fbPipes, size, rand, 260)
      if (trial && !hasOverlap(trial) && somePieceHasSlideMove(trial, size)) {
        return {
          id: levelId,
          seed,
          difficulty,
          size,
          pieces: trial,
          pipes: fbPipes,
        }
      }
    }
  }

  const minimalPieces: Piece[] = []
  for (let i = 0; i < pieceCount; i += 1) {
    const color = COLORS[i % 4]
    minimalPieces.push({
      id: `g-${levelId}-mini-${i}`,
      color,
      shape: 'smallSquare',
      row: 0,
      col: 0,
    })
  }
  const pipes = buildReachablePipes(minimalPieces, size, rand) ?? [
    { side: 'left', row: 0, color: 'red' },
    { side: 'right', row: 0, color: 'blue' },
    { side: 'left', row: 1, color: 'green' },
    { side: 'right', row: 1, color: 'yellow' },
  ]
  const placed = tryPlaceAll(minimalPieces, pipes, size, rand, 320)
  return {
    id: levelId,
    seed,
    difficulty,
    size,
    pieces: placed ?? minimalPieces.map((p, i) => ({ ...p, row: 1 + i, col: 2 })),
    pipes,
  }
}

/** Random new positions for same shapes; returns null if placement failed after retries. */
export function shufflePiecesOnBoard(pieces: Piece[], pipes: Pipe[], boardSize: number): Piece[] | null {
  const rand = mulberry32(Math.floor(Math.random() * 2_147_483_647))
  const origById = new Map(pieces.map((p) => [p.id, { row: p.row, col: p.col }]))

  for (let attempt = 0; attempt < 72; attempt += 1) {
    const templates = pieces.map((p) => ({ ...p }))
    const trial = tryPlaceAll(templates, pipes, boardSize, rand, 160)
    if (!trial || hasOverlap(trial) || !somePieceHasSlideMove(trial, boardSize)) {
      continue
    }
    const changed = trial.some((p) => {
      const o = origById.get(p.id)
      return o != null && (o.row !== p.row || o.col !== p.col)
    })
    if (changed) {
      return trial
    }
  }
  return null
}
