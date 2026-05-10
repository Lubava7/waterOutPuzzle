import type { Piece, PieceColor, Pipe } from './levelTypes'
import { getAbsoluteCells, toCellId } from './pieceGeometry'

/** All board rows where this shape can touch the given wall (have a cell on that column). */
export function getValidPipeRowsForSide(
  shape: Piece['shape'],
  orientation: Piece['orientation'] | undefined,
  side: 'left' | 'right',
  boardSize: number,
): Set<number> {
  const probe: Piece = {
    id: '_',
    color: 'red',
    shape,
    orientation,
    row: 0,
    col: 0,
  }
  const targetCol = side === 'left' ? 0 : boardSize - 1
  const rows = new Set<number>()

  for (let r = 0; r < boardSize; r += 1) {
    for (let c = 0; c < boardSize; c += 1) {
      probe.row = r
      probe.col = c
      if (!getAbsoluteCells(probe).every((cell) => cell.row >= 0 && cell.col >= 0 && cell.row < boardSize && cell.col < boardSize)) {
        continue
      }
      for (const cell of getAbsoluteCells(probe)) {
        if (cell.col === targetCol) {
          rows.add(cell.row)
        }
      }
    }
  }
  return rows
}

export function intersectSets(sets: Set<number>[]): Set<number> {
  if (sets.length === 0) {
    return new Set()
  }
  let out = new Set(sets[0])
  for (let i = 1; i < sets.length; i += 1) {
    const next = new Set<number>()
    for (const x of out) {
      if (sets[i].has(x)) {
        next.add(x)
      }
    }
    out = next
  }
  return out
}

export function winCellsForPipes(pipes: Pipe[], boardSize: number): Set<string> {
  const set = new Set<string>()
  for (const pipe of pipes) {
    if (pipe.side === 'left') {
      set.add(toCellId(pipe.row, 0))
    } else {
      set.add(toCellId(pipe.row, boardSize - 1))
    }
  }
  return set
}

export function winCellsForColor(pipes: Pipe[], color: PieceColor, boardSize: number): Set<string> {
  const set = new Set<string>()
  for (const pipe of pipes) {
    if (pipe.color !== color) {
      continue
    }
    if (pipe.side === 'left') {
      set.add(toCellId(pipe.row, 0))
    } else {
      set.add(toCellId(pipe.row, boardSize - 1))
    }
  }
  return set
}

/** Pick two different rows from two sets (for two pipes on the same side). */
export function pickTwoDistinctRows(a: Set<number>, b: Set<number>, rand: () => number): { first: number; second: number } | null {
  const arrA = [...a]
  const arrB = [...b]
  if (arrA.length === 0 || arrB.length === 0) {
    return null
  }
  for (let t = 0; t < 120; t += 1) {
    const ra = arrA[Math.floor(rand() * arrA.length)]
    const rb = arrB[Math.floor(rand() * arrB.length)]
    if (ra !== rb) {
      return { first: ra, second: rb }
    }
  }
  for (const ra of arrA) {
    for (const rb of arrB) {
      if (ra !== rb) {
        return { first: ra, second: rb }
      }
    }
  }
  return null
}
