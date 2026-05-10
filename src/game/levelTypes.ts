export type PieceColor = 'red' | 'blue' | 'green' | 'yellow'

/** Награда за успешное «слияние» фигуры с трубой (челленджи). */
export type PieceRewardBooster = 'hammer' | 'clock' | 'square' | 'shuffle'

export type Piece = {
  id: string
  color: PieceColor
  shape: 'smallSquare' | 'bigSquare' | 'rect2' | 'rect3' | 'corner'
  orientation?: 'horizontal' | 'vertical'
  row: number
  col: number
  isRemoving?: boolean
  /** Иконка бустера в одной из клеток фигуры; выдаётся при очистке через трубу. */
  rewardBooster?: PieceRewardBooster
  /** Клетка относительно якоря фигуры (как в getShapeCells); по умолчанию первая клетка. */
  rewardBoosterCell?: { row: number; col: number }
}

export type Pipe = {
  side: 'left' | 'right'
  row: number
  color: PieceColor
}

export type Level = {
  id: number
  seed: number
  difficulty: 'easy' | 'hard'
  size: number
  pieces: Piece[]
  pipes: Pipe[]
}
