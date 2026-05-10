import type { Piece } from './levelTypes'

export function getShapeCells(piece: Pick<Piece, 'shape' | 'orientation'>) {
  if (piece.shape === 'smallSquare') {
    return [{ row: 0, col: 0 }]
  }
  if (piece.shape === 'bigSquare') {
    return [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]
  }
  if (piece.shape === 'rect2') {
    return piece.orientation === 'vertical'
      ? [
          { row: 0, col: 0 },
          { row: 1, col: 0 },
        ]
      : [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
        ]
  }
  if (piece.shape === 'rect3') {
    return piece.orientation === 'vertical'
      ? [
          { row: 0, col: 0 },
          { row: 1, col: 0 },
          { row: 2, col: 0 },
        ]
      : [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 0, col: 2 },
        ]
  }

  return [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
  ]
}

export function getAbsoluteCells(piece: Piece, row = piece.row, col = piece.col) {
  return getShapeCells(piece).map((cell) => ({
    row: row + cell.row,
    col: col + cell.col,
  }))
}

export function getShapeSize(piece: Piece) {
  const shapeCells = getShapeCells(piece)
  const maxRow = Math.max(...shapeCells.map((cell) => cell.row))
  const maxCol = Math.max(...shapeCells.map((cell) => cell.col))
  return { height: maxRow + 1, width: maxCol + 1 }
}

export function toCellId(row: number, col: number) {
  return `${row}:${col}`
}

export function fromCellId(id: string) {
  const [row, col] = id.split(':').map(Number)
  return { row, col }
}

export function isInsideBoard(piece: Piece, row: number, col: number, boardSize: number) {
  const absoluteCells = getAbsoluteCells(piece, row, col)
  return absoluteCells.every((cell) => cell.row >= 0 && cell.col >= 0 && cell.row < boardSize && cell.col < boardSize)
}

export function isPathFree(piece: Piece, targetRow: number, targetCol: number, pieces: Piece[], boardSize: number) {
  const sameRow = piece.row === targetRow
  const sameCol = piece.col === targetCol
  if (!sameRow && !sameCol) {
    return false
  }

  const otherCells = new Set(
    pieces
      .filter((item) => item.id !== piece.id)
      .flatMap((item) => getAbsoluteCells(item))
      .map((cell) => toCellId(cell.row, cell.col)),
  )

  const rowStep = targetRow === piece.row ? 0 : targetRow > piece.row ? 1 : -1
  const colStep = targetCol === piece.col ? 0 : targetCol > piece.col ? 1 : -1
  const steps = Math.max(Math.abs(targetRow - piece.row), Math.abs(targetCol - piece.col))

  for (let step = 1; step <= steps; step += 1) {
    const nextRow = piece.row + rowStep * step
    const nextCol = piece.col + colStep * step
    if (!isInsideBoard(piece, nextRow, nextCol, boardSize)) {
      return false
    }

    const shiftedCells = getAbsoluteCells(piece, nextRow, nextCol)
    if (shiftedCells.some((cell) => otherCells.has(toCellId(cell.row, cell.col)))) {
      return false
    }
  }
  return true
}

export function hasAnyOverlap(pieces: Piece[]) {
  const occupied = new Set<string>()
  for (const piece of pieces) {
    const cells = getAbsoluteCells(piece)
    for (const cell of cells) {
      const id = toCellId(cell.row, cell.col)
      if (occupied.has(id)) {
        return true
      }
      occupied.add(id)
    }
  }
  return false
}

/** Есть ли у фигуры ход ровно на одну клетку по горизонтали или вертикали без пересечений. */
export function pieceHasAnySlideMove(piece: Piece, pieces: Piece[], boardSize: number): boolean {
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const
  for (const [dr, dc] of dirs) {
    const tr = piece.row + dr
    const tc = piece.col + dc
    if (isPathFree(piece, tr, tc, pieces, boardSize)) {
      return true
    }
  }
  return false
}

/** Хотя бы одна фигура может сдвинуться (исключаем полностью «замёрзшие» раскладки). */
export function somePieceHasSlideMove(pieces: Piece[], boardSize: number): boolean {
  return pieces.some((p) => pieceHasAnySlideMove(p, pieces, boardSize))
}
