import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import type { ChangeEvent, RefObject } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import './App.css';
import {
  generateChallenge,
  rewardBoosterLabel,
  type ChallengeLevel,
  type ChallengeStage,
} from './game/challengeGenerator';
import {
  generateLevel,
  levelDifficulty,
  shufflePiecesOnBoard,
  type Level,
} from './game/levelGenerator';
import type { Piece } from './game/levelTypes';
import {
  getAbsoluteCells,
  getShapeCells,
  getShapeSize,
  hasAnyOverlap,
  isPathFree,
  toCellId,
} from './game/pieceGeometry';
import {
  addCoins,
  addDailyReward,
  buyBooster,
  CHALLENGE_WIN_COINS,
  completeChallengeWin,
  completeCurrentLevel,
  consumeItem,
  grantBooster,
  loseLife,
  setProfileAvatarEmoji,
  setProfileAvatarPhoto,
  setProfileDisplayName,
  SHOP_PRICES,
  tickLives,
} from './store/gameSlice';
import type {
  BoosterId,
  CompletedLevelEntry,
  ProfileState,
} from './store/gameSlice';
import type { AppDispatch, RootState } from './store/store';

const COLOR_HEX: Record<Piece['color'], string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
};

const COIN_EASY = 25;
const COIN_HARD = 75;

/** Таймер обычного уровня кампании (секунды). */
const CAMPAIGN_TIMER_SEC = 3 * 60;

const PROFILE_EMOJI_CHOICES = [
  '🐙',
  '🦋',
  '🌊',
  '💧',
  '🎮',
  '⭐',
  '🌸',
  '🐠',
  '🦆',
  '🌈',
  '🍀',
  '🎯',
  '🧩',
  '💎',
  '🌙',
  '🔮',
];

type ActiveDragSession = {
  pieceId: string;
  grabDr: number;
  grabDc: number;
};

function clampCell(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function grabCellInShapeLocal(
  piece: Piece,
  boardRow: number,
  boardCol: number,
): { row: number; col: number } {
  for (const c of getShapeCells(piece)) {
    if (piece.row + c.row === boardRow && piece.col + c.col === boardCol) {
      return { row: c.row, col: c.col };
    }
  }
  return { row: 0, col: 0 };
}

function clientToBoardCell(
  clientX: number,
  clientY: number,
  boardEl: HTMLElement,
  boardSize: number,
): { row: number; col: number } {
  const r = boardEl.getBoundingClientRect();
  const u = (clientX - r.left) / Math.max(1, r.width);
  const v = (clientY - r.top) / Math.max(1, r.height);
  return {
    row: clampCell(Math.floor(v * boardSize), 0, boardSize - 1),
    col: clampCell(Math.floor(u * boardSize), 0, boardSize - 1),
  };
}

/** Цель по оси X или Y от текущей клетки якоря; выбираем вариант ближе к «сырым» координатам указателя — без диагональных шагов и телепортов. */
function projectDragTarget(opts: {
  pointerRow: number;
  pointerCol: number;
  curRow: number;
  curCol: number;
  grabDr: number;
  grabDc: number;
  shapeW: number;
  shapeH: number;
  boardSize: number;
}): { row: number; col: number } {
  const rawRow = clampCell(
    opts.pointerRow - opts.grabDr,
    0,
    opts.boardSize - opts.shapeH,
  );
  const rawCol = clampCell(
    opts.pointerCol - opts.grabDc,
    0,
    opts.boardSize - opts.shapeW,
  );
  const candH = { row: opts.curRow, col: rawCol };
  const candV = { row: rawRow, col: opts.curCol };
  const dist = (t: { row: number; col: number }) =>
    Math.abs(t.row - rawRow) + Math.abs(t.col - rawCol);
  return dist(candH) <= dist(candV) ? candH : candV;
}

function pieceCellHasBooster(piece: Piece, cell: { row: number; col: number }) {
  if (!piece.rewardBooster) {
    return false;
  }
  const anchor = piece.rewardBoosterCell ?? getShapeCells(piece)[0]!;
  return anchor.row === cell.row && anchor.col === cell.col;
}

function compressImageFile(
  file: File,
  maxEdge = 168,
  quality = 0.82,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function DraggablePiece({
  piece,
  boardSize,
}: {
  piece: Piece;
  boardSize: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: piece.id,
  });
  const size = getShapeSize(piece);
  const cells = getShapeCells(piece);
  const cellCount = cells.length;
  /** Меньшие фигуры выше в стеке — проще схватить рядом с длинной «тройкой» и т.п. */
  const stackZ = 4 + (5 - cellCount);

  const style = {
    opacity: piece.isRemoving ? 0.45 : 1,
    '--piece-color': COLOR_HEX[piece.color],
    left: `${(piece.col * 100) / boardSize}%`,
    top: `${(piece.row * 100) / boardSize}%`,
    width: `${(size.width * 100) / boardSize}%`,
    height: `${(size.height * 100) / boardSize}%`,
    zIndex: isDragging ? 28 : stackZ,
  };

  return (
    <button
      ref={setNodeRef}
      style={{
        ...(style as CSSProperties),
        gridTemplateColumns: `repeat(${size.width}, 1fr)`,
        gridTemplateRows: `repeat(${size.height}, 1fr)`,
        touchAction: 'none',
      }}
      className={`piece ${piece.isRemoving ? 'piece-removing' : ''} ${isDragging ? 'piece--dragging' : ''}`}
      {...listeners}
      {...attributes}
      type='button'
      aria-label={`Figure ${piece.color}`}
    >
      {cells.map((cell) => (
        <span
          key={`${piece.id}-${cell.row}-${cell.col}`}
          className='piece-unit'
          style={{
            gridColumn: cell.col + 1,
            gridRow: cell.row + 1,
            borderColor: COLOR_HEX[piece.color],
          }}
        >
          {pieceCellHasBooster(piece, cell) ? (
            <span className='piece-boost-icon' aria-hidden>
              {rewardBoosterLabel(piece.rewardBooster!)}
            </span>
          ) : null}
        </span>
      ))}
    </button>
  );
}

function DroppableCell({ id }: { id: string }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} className='cell' />;
}

function GameRestartCornerIcon() {
  return (
    <svg
      className='game-restart-corner-icon'
      viewBox='0 0 24 24'
      width='24'
      height='24'
      aria-hidden
    >
      <path
        fill='currentColor'
        d='M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'
      />
    </svg>
  );
}

function ReadOnlyPiece({
  piece,
  boardSize,
}: {
  piece: Piece;
  boardSize: number;
}) {
  const size = getShapeSize(piece);
  const cells = getShapeCells(piece);
  const style = {
    '--piece-color': COLOR_HEX[piece.color],
    left: `${(piece.col * 100) / boardSize}%`,
    top: `${(piece.row * 100) / boardSize}%`,
    width: `${(size.width * 100) / boardSize}%`,
    height: `${(size.height * 100) / boardSize}%`,
    zIndex: 2,
  };
  return (
    <div
      style={{
        ...(style as CSSProperties),
        position: 'absolute',
        display: 'grid',
        gridTemplateColumns: `repeat(${size.width}, 1fr)`,
        gridTemplateRows: `repeat(${size.height}, 1fr)`,
        pointerEvents: 'none',
      }}
      className='piece'
      aria-hidden
    >
      {cells.map((cell) => (
        <span
          key={`ro-${piece.id}-${cell.row}-${cell.col}`}
          className='piece-unit'
          style={{
            gridColumn: cell.col + 1,
            gridRow: cell.row + 1,
            borderColor: COLOR_HEX[piece.color],
          }}
        >
          {pieceCellHasBooster(piece, cell) ? (
            <span className='piece-boost-icon' aria-hidden>
              {rewardBoosterLabel(piece.rewardBooster!)}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function ChallengeStagePreview({ stage }: { stage: ChallengeStage }) {
  const n = stage.size;
  const cells = useMemo(() => {
    const list: Array<{ row: number; col: number }> = [];
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        list.push({ row, col });
      }
    }
    return list;
  }, [n]);

  return (
    <div className='challenge-preview-wrap' aria-hidden>
      <div
        className='board-shell'
        style={{ gridTemplateColumns: '22px 1fr 22px' }}
      >
        <div
          className='pipes left-pipes'
          style={{ gridTemplateRows: `repeat(${n}, 1fr)` }}
        />
        <div
          className='board'
          style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
        >
          {cells.map(({ row, col }) => (
            <div key={`pv-${row}-${col}`} className='cell' />
          ))}
          <div className='pieces-layer'>
            {stage.pieces.map((piece) => (
              <ReadOnlyPiece key={piece.id} piece={piece} boardSize={n} />
            ))}
          </div>
        </div>
        <div
          className='pipes right-pipes'
          style={{ gridTemplateRows: `repeat(${n}, 1fr)` }}
        />
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

type TabId = 'home' | 'shop' | 'challenges' | 'completed';

type CompletedProgressSubTab = 'levels' | 'challenges';

type ProfileDialogProps = {
  profile: ProfileState;
  completedCount: number;
  nextLevel: number;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onPickEmoji: (emoji: string) => void;
  onPickPhoto: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  photoInputRef: RefObject<HTMLInputElement | null>;
};

function ProfileDialog({
  profile,
  completedCount,
  nextLevel,
  onClose,
  onNameChange,
  onPickEmoji,
  onPickPhoto,
  onRemovePhoto,
  photoInputRef,
}: ProfileDialogProps) {
  return (
    <div
      className='modal-backdrop profile-modal-backdrop'
      role='presentation'
      onClick={onClose}
    >
      <div
        className='modal profile-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='profile-modal-title'
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id='profile-modal-title'>Профиль</h2>

        <div className='profile-preview'>
          {profile.avatarMode === 'photo' && profile.avatarPhotoDataUrl ? (
            <img
              className='profile-preview-img'
              src={profile.avatarPhotoDataUrl}
              alt=''
            />
          ) : (
            <span className='profile-preview-emoji'>{profile.avatarEmoji}</span>
          )}
        </div>

        <label className='profile-label' htmlFor='profile-name'>
          Имя
        </label>
        <input
          id='profile-name'
          className='profile-name-input'
          type='text'
          autoComplete='nickname'
          maxLength={32}
          value={profile.displayName}
          onChange={(e) => onNameChange(e.target.value)}
        />

        <p className='profile-section-title'>Фото</p>
        <input
          ref={photoInputRef}
          type='file'
          accept='image/*'
          className='profile-file-input'
          onChange={onPickPhoto}
        />
        <div className='profile-photo-actions'>
          <button
            type='button'
            className='secondary-btn small-btn'
            onClick={() => photoInputRef.current?.click()}
          >
            Выбрать фото
          </button>
          {profile.avatarMode === 'photo' && profile.avatarPhotoDataUrl && (
            <button
              type='button'
              className='secondary-btn small-btn'
              onClick={onRemovePhoto}
            >
              Убрать фото
            </button>
          )}
        </div>

        <p className='profile-section-title'>Или смайлик</p>
        <div className='profile-emoji-grid'>
          {PROFILE_EMOJI_CHOICES.map((emoji) => (
            <button
              key={emoji}
              type='button'
              className={`profile-emoji-btn ${profile.avatarMode === 'emoji' && profile.avatarEmoji === emoji ? 'profile-emoji-btn-active' : ''}`}
              onClick={() => onPickEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className='profile-stats'>
          <div className='profile-stat'>
            <span className='profile-stat-label'>Пройдено уровней</span>
            <span className='profile-stat-value'>{completedCount}</span>
          </div>
          <div className='profile-stat'>
            <span className='profile-stat-label'>Текущий уровень</span>
            <span className='profile-stat-value'>{nextLevel}</span>
          </div>
        </div>

        <button
          type='button'
          className='primary-btn profile-close-btn'
          onClick={onClose}
        >
          Готово
        </button>
      </div>
    </div>
  );
}

function HomeBubbles() {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const near = i % 3 === 0;
        const left = `${(i * 37 + 11) % 100}%`;
        const delay = `${(i * 0.7) % 12}s`;
        const duration = `${18 + (i % 7) * 2}s`;
        const size = near ? `${22 + (i % 5) * 8}px` : `${10 + (i % 4) * 4}px`;
        return { key: i, near, left, delay, duration, size };
      }),
    [],
  );

  return (
    <div className='home-bubbles' aria-hidden>
      {bubbles.map((b) => (
        <div
          key={b.key}
          className={`home-bubble ${b.near ? 'home-bubble-near' : 'home-bubble-far'}`}
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDuration: b.duration,
            animationDelay: b.delay,
          }}
        />
      ))}
    </div>
  );
}

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const {
    nextLevelNumber,
    nextChallengeNumber,
    completedLevels,
    completedChallenges,
    inventory,
    lastRewardDate,
    coins,
    lives,
    nextLifeAtMs,
    profile,
  } = useSelector((state: RootState) => state.game);

  const [tab, setTab] = useState<TabId>('home');
  const [completedProgressTab, setCompletedProgressTab] =
    useState<CompletedProgressSubTab>('levels');
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [levelBase, setLevelBase] = useState<Level | null>(null);
  const [challengeRun, setChallengeRun] = useState<{
    challenge: ChallengeLevel;
    stageIndex: number;
  } | null>(null);
  const [challengeStageAnim, setChallengeStageAnim] = useState(false);
  const challengeRunRef = useRef(challengeRun);
  challengeRunRef.current = challengeRun;
  const levelBaseRef = useRef(levelBase);
  levelBaseRef.current = levelBase;

  const [boardSizeExtra, setBoardSizeExtra] = useState(0);
  const [boardShuffleAnim, setBoardShuffleAnim] = useState(false);
  const [shuffleSpentThisLevel, setShuffleSpentThisLevel] = useState(false);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const piecesRef = useRef<Piece[]>(pieces);
  piecesRef.current = pieces;
  const boardInnerRef = useRef<HTMLDivElement | null>(null);
  const boardSizeRef = useRef(5);
  const dragSessionRef = useRef<ActiveDragSession | null>(null);
  const dragMoveCleanupRef = useRef<(() => void) | null>(null);
  /** Последняя позиция указателя во время drag (activatorEvent при onDragEnd — это pointerdown, не отпускание). */
  const dragLastClientRef = useRef<{ x: number; y: number } | null>(null);
  const [moves, setMoves] = useState(0);
  const [timeLeftSec, setTimeLeftSec] = useState(CAMPAIGN_TIMER_SEC);
  const [showDailyModal, setShowDailyModal] = useState(false);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const statusRef = useRef(status);
  statusRef.current = status;
  const [dragStartCell, setDragStartCell] = useState<{
    id: string;
    row: number;
    col: number;
  } | null>(null);
  const [lifeUiTick, setLifeUiTick] = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showRestartConfirmModal, setShowRestartConfirmModal] =
    useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 0 } }),
  );

  const level: Level | null = useMemo(() => {
    if (challengeRun) {
      const st = challengeRun.challenge.stages[challengeRun.stageIndex];
      if (!st) {
        return null;
      }
      return {
        id: challengeRun.challenge.id,
        seed: 0,
        difficulty: 'hard',
        size: st.size,
        pipes: st.pipes,
        pieces,
      };
    }
    if (!levelBase) {
      return null;
    }
    return { ...levelBase, pieces };
  }, [challengeRun, levelBase, challengeRun?.stageIndex, pieces]);

  const boardSize = (level?.size ?? 5) + boardSizeExtra;
  boardSizeRef.current = boardSize;

  const timerAnchor =
    screen === 'game'
      ? challengeRun != null
        ? `c-${challengeRun.challenge.id}-${challengeRun.stageIndex}`
        : levelBase != null
          ? `l-${levelBase.id}`
          : ''
      : '';

  const nextDifficulty = levelDifficulty(nextLevelNumber);

  const cells = useMemo(() => {
    const list: Array<{ row: number; col: number }> = [];
    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        list.push({ row, col });
      }
    }
    return list;
  }, [boardSize]);

  const refreshLives = useCallback(() => {
    dispatch(tickLives());
  }, [dispatch]);

  useEffect(() => {
    refreshLives();
    const id = window.setInterval(() => {
      refreshLives();
      setLifeUiTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [refreshLives]);

  useEffect(() => {
    if (screen !== 'game' || !timerAnchor) {
      return;
    }

    if (status !== 'playing') {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeftSec((prev) => {
        if (prev <= 1) {
          setShowRestartConfirmModal(false);
          setStatus('lost');
          dispatch(loseLife());
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [screen, status, timerAnchor, dispatch]);

  useEffect(() => {
    if (tab !== 'home' || screen !== 'home') {
      return;
    }

    const today = new Date().toDateString();
    if (lastRewardDate !== today) {
      setShowDailyModal(true);
    }
  }, [tab, screen, lastRewardDate]);

  function resetPlayFromBase(base: Level, keepExtra = boardSizeExtra) {
    setShuffleSpentThisLevel(false);
    setChallengeRun(null);
    setLevelBase(base);
    setBoardSizeExtra(keepExtra);
    setPieces(base.pieces.map((piece) => ({ ...piece })));
    setMoves(0);
    setTimeLeftSec(CAMPAIGN_TIMER_SEC);
    setStatus('playing');
  }

  function resolveBoardFullyCleared() {
    const run = challengeRunRef.current;
    if (run) {
      const lastStage = run.stageIndex >= run.challenge.stages.length - 1;
      if (lastStage) {
        setStatus('won');
        dispatch(completeChallengeWin());
      } else {
        setChallengeStageAnim(true);
        window.setTimeout(() => {
          const r = challengeRunRef.current;
          if (!r) {
            return;
          }
          const ni = r.stageIndex + 1;
          const nextSt = r.challenge.stages[ni];
          setChallengeRun({ ...r, stageIndex: ni });
          setPieces(nextSt.pieces.map((p) => ({ ...p })));
          setBoardSizeExtra(0);
          setShuffleSpentThisLevel(false);
          setChallengeStageAnim(false);
        }, 520);
      }
      return;
    }
    const lb = levelBaseRef.current;
    if (lb) {
      setStatus('won');
      const reward = lb.difficulty === 'hard' ? COIN_HARD : COIN_EASY;
      dispatch(addCoins(reward));
      dispatch(completeCurrentLevel({ id: lb.id, difficulty: lb.difficulty }));
    }
  }

  function startCampaign() {
    if (lives <= 0) {
      return;
    }
    const L = generateLevel(nextLevelNumber);
    resetPlayFromBase(L, 0);
    setScreen('game');
  }

  function startChallengePlay() {
    if (lives <= 0) {
      return;
    }
    setLevelBase(null);
    const ch = generateChallenge(nextChallengeNumber);
    setChallengeRun({ challenge: ch, stageIndex: 0 });
    setPieces(ch.stages[0]!.pieces.map((p) => ({ ...p })));
    setBoardSizeExtra(0);
    setShuffleSpentThisLevel(false);
    setMoves(0);
    setTimeLeftSec(ch.timeLimitSec);
    setStatus('playing');
    setScreen('game');
    setTab('home');
  }

  function startReplay(entry: CompletedLevelEntry) {
    if (lives <= 0) {
      return;
    }
    setChallengeRun(null);
    const L = generateLevel(entry.id);
    resetPlayFromBase(L, 0);
    setScreen('game');
    setTab('home');
  }

  function applyDailyReward() {
    dispatch(addDailyReward());
    setShowDailyModal(false);
  }

  function tryClearPiece(
    nextPieces: Piece[],
    movedPieceId: string,
    playLevel: Level,
  ) {
    const movedPiece = nextPieces.find((item) => item.id === movedPieceId);
    if (!movedPiece) {
      return;
    }

    const occupiedCells = getAbsoluteCells(movedPiece);
    const matchingPipe = playLevel.pipes.find((pipe) => {
      if (pipe.color !== movedPiece.color) {
        return false;
      }
      return occupiedCells.some((cell) => {
        if (pipe.side === 'left') {
          return cell.col === 0 && cell.row === pipe.row;
        }
        return cell.col === boardSizeRef.current - 1 && cell.row === pipe.row;
      });
    });

    if (!matchingPipe) {
      return;
    }

    setPieces((prev) =>
      prev.map((item) =>
        item.id === movedPiece.id ? { ...item, isRemoving: true } : item,
      ),
    );

    window.setTimeout(() => {
      if (movedPiece.rewardBooster) {
        dispatch(grantBooster(movedPiece.rewardBooster as BoosterId));
      }
      setPieces((prev) => {
        const updated = prev.filter((item) => item.id !== movedPiece.id);
        if (updated.length === 0) {
          resolveBoardFullyCleared();
        }
        return updated;
      });
    }, 860);
  }

  function movePieceToCell(
    pieceId: string,
    targetRow: number,
    targetCol: number,
    dragSession: ActiveDragSession | null = null,
  ) {
    const playLevel = level;
    if (!playLevel) {
      return;
    }
    const live = piecesRef.current;
    const piece = live.find((item) => item.id === pieceId);
    if (!piece) {
      return;
    }
    if (piece.row === targetRow && piece.col === targetCol) {
      return;
    }
    const bs = boardSizeRef.current;
    if (dragSession != null) {
      if (dragSession.pieceId !== pieceId) {
        return;
      }
      if (targetRow !== piece.row && targetCol !== piece.col) {
        return;
      }
    }
    if (!isPathFree(piece, targetRow, targetCol, live, bs)) {
      return;
    }
    const nextPieces = live.map((item) =>
      item.id === pieceId ? { ...item, row: targetRow, col: targetCol } : item,
    );
    if (hasAnyOverlap(nextPieces)) {
      return;
    }

    piecesRef.current = nextPieces;
    setPieces(nextPieces);
    tryClearPiece(nextPieces, pieceId, playLevel);
  }

  function clearDragPointerTracking() {
    dragMoveCleanupRef.current?.();
    dragMoveCleanupRef.current = null;
    dragSessionRef.current = null;
    dragLastClientRef.current = null;
  }

  function onDragStart(event: DragStartEvent) {
    if (statusRef.current !== 'playing' || !level) {
      return;
    }
    const pieceId = String(event.active.id);
    const piece = piecesRef.current.find((item) => item.id === pieceId);
    if (!piece || !boardInnerRef.current) {
      return;
    }
    const ev = event.activatorEvent;
    if (!(ev instanceof PointerEvent)) {
      return;
    }
    clearDragPointerTracking();
    const { row: br, col: bc } = clientToBoardCell(
      ev.clientX,
      ev.clientY,
      boardInnerRef.current,
      boardSizeRef.current,
    );
    const grab = grabCellInShapeLocal(piece, br, bc);
    dragSessionRef.current = {
      pieceId,
      grabDr: grab.row,
      grabDc: grab.col,
    };
    dragLastClientRef.current = { x: ev.clientX, y: ev.clientY };
    setDragStartCell({ id: piece.id, row: piece.row, col: piece.col });

    const onMove = (e: PointerEvent) => {
      const sess = dragSessionRef.current;
      const boardEl = boardInnerRef.current;
      if (!sess || !boardEl || statusRef.current !== 'playing') {
        return;
      }
      dragLastClientRef.current = { x: e.clientX, y: e.clientY };
      const livePiece = piecesRef.current.find((x) => x.id === sess.pieceId);
      if (!livePiece) {
        return;
      }
      const { row: pr, col: pc } = clientToBoardCell(
        e.clientX,
        e.clientY,
        boardEl,
        boardSizeRef.current,
      );
      const { width: sw, height: sh } = getShapeSize(livePiece);
      const target = projectDragTarget({
        pointerRow: pr,
        pointerCol: pc,
        curRow: livePiece.row,
        curCol: livePiece.col,
        grabDr: sess.grabDr,
        grabDc: sess.grabDc,
        shapeW: sw,
        shapeH: sh,
        boardSize: boardSizeRef.current,
      });
      movePieceToCell(sess.pieceId, target.row, target.col, sess);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    dragMoveCleanupRef.current = () =>
      window.removeEventListener('pointermove', onMove);
  }

  function onDragOver(_event: DragOverEvent) {
    /* позиция считается по pointermove, чтобы диагональ не «теряла» клетки */
  }

  function applyFinalPointerPlacement(_event: DragEndEvent) {
    const sess = dragSessionRef.current;
    if (
      statusRef.current !== 'playing' ||
      !level ||
      !sess ||
      !boardInnerRef.current
    ) {
      return;
    }
    const last = dragLastClientRef.current;
    const livePiece = piecesRef.current.find((x) => x.id === sess.pieceId);
    if (!livePiece || !last) {
      return;
    }
    const { row: pr, col: pc } = clientToBoardCell(
      last.x,
      last.y,
      boardInnerRef.current,
      boardSizeRef.current,
    );
    const { width: sw, height: sh } = getShapeSize(livePiece);
    const target = projectDragTarget({
      pointerRow: pr,
      pointerCol: pc,
      curRow: livePiece.row,
      curCol: livePiece.col,
      grabDr: sess.grabDr,
      grabDc: sess.grabDc,
      shapeW: sw,
      shapeH: sh,
      boardSize: boardSizeRef.current,
    });
    movePieceToCell(sess.pieceId, target.row, target.col, sess);
  }

  function onDragEnd(event: DragEndEvent) {
    applyFinalPointerPlacement(event);
    dragMoveCleanupRef.current?.();
    dragMoveCleanupRef.current = null;
    dragSessionRef.current = null;
    dragLastClientRef.current = null;

    if (dragStartCell) {
      const piece = piecesRef.current.find(
        (item) => item.id === dragStartCell.id,
      );
      if (
        piece &&
        (piece.row !== dragStartCell.row || piece.col !== dragStartCell.col)
      ) {
        setMoves((prev) => prev + 1);
      }
    }

    setDragStartCell(null);
  }

  function onDragCancel() {
    dragMoveCleanupRef.current?.();
    dragMoveCleanupRef.current = null;
    dragSessionRef.current = null;
    dragLastClientRef.current = null;
    setDragStartCell(null);
  }

  function useHammer() {
    if (inventory.hammer <= 0 || status !== 'playing' || !level) {
      return;
    }
    if (pieces.length === 0) {
      return;
    }
    dispatch(consumeItem('hammer'));
    setPieces((prev) => {
      const updated = prev.slice(1);
      if (updated.length === 0) {
        resolveBoardFullyCleared();
      }
      return updated;
    });
  }

  function useClock() {
    if (inventory.clock <= 0 || status !== 'playing') {
      return;
    }
    dispatch(consumeItem('clock'));
    setTimeLeftSec((prev) => prev + 60);
  }

  function useSquare() {
    if (inventory.square <= 0 || status !== 'playing') {
      return;
    }
    dispatch(consumeItem('square'));
    setBoardSizeExtra((prev) => prev + 1);
  }

  function useShuffle() {
    if (!level || status !== 'playing' || level.difficulty !== 'hard') {
      return;
    }
    if (shuffleSpentThisLevel || inventory.shuffle <= 0) {
      return;
    }
    setBoardShuffleAnim(true);
    const pipesSnapshot = level.pipes;
    const sizeSnapshot = boardSize;
    window.setTimeout(() => {
      const next = shufflePiecesOnBoard(
        piecesRef.current,
        pipesSnapshot,
        sizeSnapshot,
      );
      setBoardShuffleAnim(false);
      if (next) {
        setShuffleSpentThisLevel(true);
        dispatch(consumeItem('shuffle'));
        setPieces(next);
      }
    }, 620);
  }

  function purchaseBooster(id: BoosterId) {
    dispatch(buyBooster(id));
  }

  async function handleProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const dataUrl = await compressImageFile(file);
    if (dataUrl) {
      dispatch(setProfileAvatarPhoto(dataUrl));
    }
  }

  function backToHomeAfterWin() {
    setScreen('home');
    setLevelBase(null);
    setChallengeRun(null);
  }

  function exitToHomeFromGame() {
    setScreen('home');
    setLevelBase(null);
    setChallengeRun(null);
    setStatus('playing');
  }

  function retryLevel() {
    const run = challengeRunRef.current;
    if (run) {
      setChallengeRun({ ...run, stageIndex: 0 });
      setPieces(run.challenge.stages[0]!.pieces.map((p) => ({ ...p })));
      setBoardSizeExtra(0);
      setShuffleSpentThisLevel(false);
      setMoves(0);
      setTimeLeftSec(run.challenge.timeLimitSec);
      setStatus('playing');
      return;
    }
    if (levelBase) {
      resetPlayFromBase(levelBase, boardSizeExtra);
    }
  }

  const msToNextLife =
    lives < 5 && nextLifeAtMs != null
      ? Math.max(0, nextLifeAtMs - Date.now())
      : 0;
  void lifeUiTick;

  const gameRestartCornerBtn = (
    <button
      type='button'
      className='game-restart-corner-btn'
      disabled={status !== 'playing'}
      onClick={() => setShowRestartConfirmModal(true)}
      aria-label='Перезапустить уровень'
      title='Перезапустить уровень'
    >
      <GameRestartCornerIcon />
    </button>
  );

  const profileFab = (
    <button
      type='button'
      className='profile-corner-btn'
      onClick={() => setShowProfileModal(true)}
      aria-label='Открыть профиль'
    >
      <span className='profile-corner-avatar'>
        {profile.avatarMode === 'photo' && profile.avatarPhotoDataUrl ? (
          <img src={profile.avatarPhotoDataUrl} alt='' />
        ) : (
          profile.avatarEmoji
        )}
      </span>
    </button>
  );

  const profileModal = showProfileModal && (
    <ProfileDialog
      profile={profile}
      completedCount={completedLevels.length}
      nextLevel={nextLevelNumber}
      onClose={() => setShowProfileModal(false)}
      onNameChange={(value) => dispatch(setProfileDisplayName(value))}
      onPickEmoji={(emoji) => dispatch(setProfileAvatarEmoji(emoji))}
      onPickPhoto={handleProfilePhoto}
      onRemovePhoto={() => dispatch(setProfileAvatarPhoto(null))}
      photoInputRef={photoInputRef}
    />
  );

  const challengeLaterStages =
    challengeRun != null
      ? challengeRun.challenge.stages.slice(challengeRun.stageIndex + 1)
      : [];

  if (screen === 'game' && level) {
    return (
      <>
        {gameRestartCornerBtn}
        {profileFab}
        <div className='game-viewport-root'>
          <main className='app app-game'>
            <section className='panel game-panel'>
              <div className='game-status-card'>
                <div className='game-level-line'>
                  <strong>
                    {challengeRun ? (
                      <>
                        Челлендж {level.id}
                        <span className='diff-pill diff-pill-hard'>Этап</span>
                        <span className='muted' style={{ fontWeight: 600 }}>
                          {challengeRun.stageIndex + 1} /{' '}
                          {challengeRun.challenge.stages.length}
                        </span>
                      </>
                    ) : (
                      <>
                        Уровень {level.id}
                        <span
                          className={`diff-pill diff-pill-${level.difficulty}`}
                        >
                          {level.difficulty === 'hard' ? 'Сложно' : 'Легко'}
                        </span>
                      </>
                    )}
                  </strong>
                </div>
                <div className='game-timer-inner' aria-live='polite'>
                  Таймер: {formatTime(timeLeftSec)}
                </div>
                <div className='game-moves-line'>Ходы: {moves}</div>
              </div>

              <div className='item-actions'>
                <button
                  type='button'
                  onClick={useHammer}
                  className='action-btn'
                >
                  🔨 {inventory.hammer}
                </button>
                <button type='button' onClick={useClock} className='action-btn'>
                  ⏰ {inventory.clock}
                </button>
                <button
                  type='button'
                  onClick={useSquare}
                  className='action-btn'
                >
                  ⬜ {inventory.square}
                </button>
                {level.difficulty === 'hard' && (
                  <button
                    type='button'
                    onClick={useShuffle}
                    className='action-btn action-btn-shuffle'
                    disabled={
                      shuffleSpentThisLevel ||
                      inventory.shuffle <= 0 ||
                      boardShuffleAnim
                    }
                    title='Один раз за уровень: новые позиции фигур'
                  >
                    🔀 {inventory.shuffle}
                    {shuffleSpentThisLevel ? ' ✓' : ''}
                  </button>
                )}
              </div>

              <div
                className={`board-stage ${status === 'lost' ? 'board-stage--inactive' : ''}`}
              >
                <div
                  className={`challenge-stack ${challengeStageAnim ? 'challenge-stack-animating' : ''}`}
                >
                  {challengeLaterStages.map((st, i) => (
                    <ChallengeStagePreview
                      key={`up-${challengeRun?.stageIndex ?? 0}-${i}-${st.size}`}
                      stage={st}
                    />
                  ))}
                  <div className='board-shell'>
                    <div
                      className='pipes left-pipes'
                      style={{ gridTemplateRows: `repeat(${boardSize}, 1fr)` }}
                    >
                      {level.pipes
                        .filter((pipe) => pipe.side === 'left')
                        .map((pipe) => (
                          <div
                            key={`left-${pipe.row}-${pipe.color}`}
                            className='pipe'
                            style={{
                              gridRow: pipe.row + 1,
                              background: COLOR_HEX[pipe.color],
                            }}
                          />
                        ))}
                    </div>

                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={onDragStart}
                      onDragOver={onDragOver}
                      onDragEnd={onDragEnd}
                      onDragCancel={onDragCancel}
                    >
                      <div
                        ref={boardInnerRef}
                        className='board'
                        style={{
                          gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
                        }}
                      >
                        {cells.map(({ row, col }) => {
                          const cellId = toCellId(row, col);
                          return <DroppableCell key={cellId} id={cellId} />;
                        })}
                        <div
                          className={`pieces-layer ${boardShuffleAnim ? 'pieces-layer-shuffle' : ''}`}
                        >
                          {pieces.map((piece) => (
                            <DraggablePiece
                              key={piece.id}
                              piece={piece}
                              boardSize={boardSize}
                            />
                          ))}
                        </div>
                      </div>
                    </DndContext>

                    <div
                      className='pipes right-pipes'
                      style={{ gridTemplateRows: `repeat(${boardSize}, 1fr)` }}
                    >
                      {level.pipes
                        .filter((pipe) => pipe.side === 'right')
                        .map((pipe) => (
                          <div
                            key={`right-${pipe.row}-${pipe.color}`}
                            className='pipe'
                            style={{
                              gridRow: pipe.row + 1,
                              background: COLOR_HEX[pipe.color],
                            }}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {status !== 'lost' && (
                <button
                  type='button'
                  className='secondary-btn'
                  onClick={() => {
                    setScreen('home');
                    setLevelBase(null);
                    setChallengeRun(null);
                  }}
                >
                  На домашний экран
                </button>
              )}
            </section>
          </main>
        </div>

        {status === 'lost' && (
          <div
            className='modal-backdrop game-outcome-backdrop'
            role='presentation'
          >
            <div
              className='modal game-dialog game-time-up-dialog'
              role='dialog'
              aria-modal='true'
              aria-labelledby='time-up-title'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id='time-up-title' className='game-time-up-title'>
                Ой, время вышло ;(
              </h2>
              <p className='muted game-time-up-hint'>
                Жизнь потеряна. Можно выйти или попробовать снова.
              </p>
              <div className='game-dialog-actions game-dialog-actions--row'>
                <button
                  type='button'
                  className='secondary-btn game-dialog-btn'
                  onClick={exitToHomeFromGame}
                >
                  Выйти
                </button>
                <button
                  type='button'
                  className='primary-btn game-dialog-btn'
                  onClick={() => {
                    retryLevel();
                  }}
                >
                  Начать заново
                </button>
              </div>
            </div>
          </div>
        )}

        {showRestartConfirmModal && status === 'playing' && (
          <div
            className='modal-backdrop game-outcome-backdrop'
            role='presentation'
            onClick={() => setShowRestartConfirmModal(false)}
          >
            <div
              className='modal game-dialog game-restart-dialog'
              role='dialog'
              aria-modal='true'
              aria-labelledby='restart-dialog-title'
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type='button'
                className='game-dialog-close'
                aria-label='Закрыть'
                onClick={() => setShowRestartConfirmModal(false)}
              >
                ×
              </button>
              <h2 id='restart-dialog-title' className='game-restart-dialog-title'>
                Перезапуск уровня
              </h2>
              <p className='muted small game-restart-dialog-lead'>
                Твои бустеры сейчас (не тратятся при отмене):
              </p>
              <ul className='game-restart-boosters'>
                <li>
                  <span aria-hidden>🔨</span> Молоток —{' '}
                  <strong>{inventory.hammer}</strong>
                </li>
                <li>
                  <span aria-hidden>⏰</span> Часы —{' '}
                  <strong>{inventory.clock}</strong>
                </li>
                <li>
                  <span aria-hidden>⬜</span> Клетка —{' '}
                  <strong>{inventory.square}</strong>
                </li>
                <li>
                  <span aria-hidden>🔀</span> Перемешивание —{' '}
                  <strong>{inventory.shuffle}</strong>
                </li>
              </ul>
              <button
                type='button'
                className='primary-btn game-restart-confirm-btn'
                onClick={() => {
                  setShowRestartConfirmModal(false);
                  retryLevel();
                }}
              >
                Начать уровень заново
              </button>
            </div>
          </div>
        )}

        {status === 'won' && (
          <div className='modal-backdrop' role='presentation'>
            <div
              className='modal'
              role='dialog'
              aria-modal='true'
              aria-label='Win level'
            >
              <h2>Победа!</h2>
              {challengeRun ? (
                <>
                  <p>Челлендж пройден — все поля очищены.</p>
                  <p className='muted small'>
                    +{CHALLENGE_WIN_COINS} монет, +1 жизнь, случайный бустер в
                    инвентарь.
                  </p>
                </>
              ) : (
                <>
                  <p>Уровень пройден, ты отлично справилась.</p>
                  <p className='muted small'>
                    +{level.difficulty === 'hard' ? COIN_HARD : COIN_EASY} монет
                  </p>
                </>
              )}
              <button
                type='button'
                className='primary-btn'
                onClick={backToHomeAfterWin}
              >
                Круто!
              </button>
            </div>
          </div>
        )}
        {profileModal}
      </>
    );
  }

  return (
    <>
      {profileFab}
      <main className='app app-home-shell'>
        <HomeBubbles />

        {tab === 'shop' && (
          <section className='panel sub-screen shop-screen'>
            <h2>Магазин</h2>
            <p className='muted shop-balance'>
              У тебя <strong>{coins}</strong> монет
            </p>
            <ul className='shop-list'>
              <li className='shop-item'>
                <div>
                  <strong>🔨 Молоток</strong>
                  <p className='muted small'>Убирает одну фигуру с поля</p>
                </div>
                <button
                  type='button'
                  className='primary-btn small-btn'
                  disabled={coins < SHOP_PRICES.hammer}
                  onClick={() => purchaseBooster('hammer')}
                >
                  {SHOP_PRICES.hammer} 🪙
                </button>
              </li>
              <li className='shop-item'>
                <div>
                  <strong>⏰ Часы</strong>
                  <p className='muted small'>+60 секунд к таймеру уровня</p>
                </div>
                <button
                  type='button'
                  className='primary-btn small-btn'
                  disabled={coins < SHOP_PRICES.clock}
                  onClick={() => purchaseBooster('clock')}
                >
                  {SHOP_PRICES.clock} 🪙
                </button>
              </li>
              <li className='shop-item'>
                <div>
                  <strong>⬜ Квадратик</strong>
                  <p className='muted small'>Расширяет поле на одну клетку</p>
                </div>
                <button
                  type='button'
                  className='primary-btn small-btn'
                  disabled={coins < SHOP_PRICES.square}
                  onClick={() => purchaseBooster('square')}
                >
                  {SHOP_PRICES.square} 🪙
                </button>
              </li>
              <li className='shop-item shop-item-shuffle'>
                <div>
                  <strong>🔀 Шаффл</strong>
                  <p className='muted small'>
                    Только на сложных уровнях, 1 раз за попытку — новые позиции
                    всех фигур
                  </p>
                </div>
                <button
                  type='button'
                  className='primary-btn small-btn'
                  disabled={coins < SHOP_PRICES.shuffle}
                  onClick={() => purchaseBooster('shuffle')}
                >
                  {SHOP_PRICES.shuffle} 🪙
                </button>
              </li>
            </ul>
            <button
              type='button'
              className='secondary-btn'
              onClick={() => setTab('home')}
            >
              Назад
            </button>
          </section>
        )}

        {tab === 'challenges' && (
          <section className='panel sub-screen challenges-screen'>
            <h2>Челленджи</h2>
            <p className='muted small'>
              Серия полей подряд на время: очисти нижнее поле — стек сдвигается
              вверх, открывается следующее. В фигурах с иконкой бустера награда
              начисляется, когда фигура уходит в трубу (можно тратить сразу).
            </p>
            <div className='challenge-hero'>
              <h3>Челлендж {nextChallengeNumber}</h3>
              <p className='challenge-rewards'>
                Награда за прохождение:{' '}
                <strong>+{CHALLENGE_WIN_COINS} монет</strong>,{' '}
                <strong>+1 жизнь</strong> (до лимита),{' '}
                <strong>случайный бустер</strong>. На полях — дополнительные
                бустеры внутри фигур.
              </p>
              <button
                type='button'
                className='primary-btn home-play-btn'
                disabled={lives <= 0}
                onClick={startChallengePlay}
              >
                {lives <= 0 ? 'Нет жизней' : 'Играть челлендж'}
              </button>
            </div>
            <button
              type='button'
              className='secondary-btn'
              onClick={() => setTab('home')}
            >
              Назад
            </button>
          </section>
        )}

        {tab === 'completed' && (
          <section className='panel sub-screen completed-screen'>
            <h2 className='completed-screen-title'>Прогресс</h2>

            <div
              className='completed-tabs'
              role='tablist'
              aria-label='Раздел прогресса'
            >
              <button
                type='button'
                role='tab'
                id='completed-tab-levels'
                aria-selected={completedProgressTab === 'levels'}
                aria-controls='completed-progress-panel'
                className={`completed-tab ${completedProgressTab === 'levels' ? 'completed-tab--active' : ''}`}
                onClick={() => setCompletedProgressTab('levels')}
              >
                Уровни
              </button>
              <button
                type='button'
                role='tab'
                id='completed-tab-challenges'
                aria-selected={completedProgressTab === 'challenges'}
                aria-controls='completed-progress-panel'
                className={`completed-tab ${completedProgressTab === 'challenges' ? 'completed-tab--active' : ''}`}
                onClick={() => setCompletedProgressTab('challenges')}
              >
                Челленджи
              </button>
            </div>

            <div
              className='completed-screen-block completed-progress-panel'
              role='tabpanel'
              id='completed-progress-panel'
              aria-labelledby={
                completedProgressTab === 'levels'
                  ? 'completed-tab-levels'
                  : 'completed-tab-challenges'
              }
            >
              {completedProgressTab === 'levels' ? (
                completedLevels.length === 0 ? (
                  <p className='muted completed-section-empty'>
                    Пока пусто — сыграй первый уровень!
                  </p>
                ) : (
                  <ul className='completed-list completed-list--flush'>
                    {completedLevels.map((e) => (
                      <li
                        key={`${e.id}-${e.difficulty}`}
                        className='completed-row'
                      >
                        <span>
                          Уровень {e.id}{' '}
                          <span
                            className={`diff-pill diff-pill-${e.difficulty}`}
                          >
                            {e.difficulty === 'hard' ? 'Сложно' : 'Легко'}
                          </span>
                        </span>
                        <button
                          type='button'
                          className='primary-btn small-btn'
                          disabled={lives <= 0}
                          onClick={() => startReplay(e)}
                        >
                          Играть
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : completedChallenges.length === 0 ? (
                <p className='muted completed-section-empty'>
                  Пока пусто — открой вкладку «Челленджи» внизу!
                </p>
              ) : (
                <ul className='completed-list completed-list--flush'>
                  {completedChallenges.map((id) => (
                    <li
                      key={`challenge-${id}`}
                      className='completed-row completed-row--challenge'
                    >
                      <span>
                        Челлендж {id}{' '}
                        <span className='challenge-done-pill'>пройден</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type='button'
              className='secondary-btn'
              onClick={() => setTab('home')}
            >
              Назад
            </button>
          </section>
        )}

        {tab === 'home' && (
          <>
            <header className='home-top-bars'>
              <div className='stat-bar stat-bar-coins'>
                <span className='stat-icon' aria-hidden>
                  🪙
                </span>
                <span className='stat-value'>{coins}</span>
                <span className='stat-hint'>
                  за уровень: {COIN_EASY} / {COIN_HARD}
                </span>
              </div>
              <div className='stat-bar stat-bar-lives'>
                <span className='stat-label'>Жизни</span>
                <div
                  className='lives-dots'
                  aria-label={`Жизней: ${lives} из 5`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      className={`life-dot ${i < lives ? 'life-full' : 'life-empty'}`}
                    />
                  ))}
                </div>
                {lives < 5 && nextLifeAtMs != null && (
                  <span className='stat-hint'>
                    +1 через {formatCountdown(msToNextLife)}
                  </span>
                )}
              </div>
            </header>

            <section className='panel home-panel-new'>
              <h1 className='home-title'>Water Out</h1>

              <div className={`level-card level-card-${nextDifficulty}`}>
                <p className='level-card-label'>Следующий уровень</p>
                <p className='level-card-number'>{nextLevelNumber}</p>
                <p className='level-card-sub'>
                  {nextDifficulty === 'hard'
                    ? 'Сложный — больше фигур'
                    : 'Легкий — расслабься и играй'}
                </p>
                <button
                  type='button'
                  className='primary-btn home-play-btn'
                  disabled={lives <= 0}
                  onClick={startCampaign}
                >
                  {lives <= 0 ? 'Нет жизней' : 'Играть'}
                </button>
              </div>

              <div className='home-inventory-row'>
                <span>🔨 {inventory.hammer}</span>
                <span>⏰ {inventory.clock}</span>
                <span>⬜ {inventory.square}</span>
                <span>🔀 {inventory.shuffle}</span>
              </div>
            </section>
          </>
        )}

        <nav className='bottom-nav' aria-label='Основная навигация'>
          <button
            type='button'
            className={`nav-btn ${tab === 'shop' ? 'nav-active' : ''}`}
            onClick={() => setTab('shop')}
          >
            <span className='nav-ico' aria-hidden>
              🛒
            </span>
            <span>Магазин</span>
          </button>
          <button
            type='button'
            className={`nav-btn ${tab === 'home' ? 'nav-active' : ''}`}
            onClick={() => setTab('home')}
          >
            <span className='nav-ico' aria-hidden>
              🏠
            </span>
            <span>Дом</span>
          </button>
          <button
            type='button'
            className={`nav-btn ${tab === 'challenges' ? 'nav-active' : ''}`}
            onClick={() => setTab('challenges')}
          >
            <span className='nav-ico' aria-hidden>
              🎯
            </span>
            <span>Челленджи</span>
          </button>
          <button
            type='button'
            className={`nav-btn ${tab === 'completed' ? 'nav-active' : ''}`}
            onClick={() => setTab('completed')}
          >
            <span className='nav-ico' aria-hidden>
              ✓
            </span>
            <span>Уровни</span>
          </button>
        </nav>

        {showDailyModal && tab === 'home' && (
          <div className='modal-backdrop' role='presentation'>
            <div
              className='modal'
              role='dialog'
              aria-modal='true'
              aria-label='Daily reward'
            >
              <h2>Ежедневная награда</h2>
              <p>
                За ежедневный вход ты получаешь полезные предметы для
                прохождения уровней.
              </p>
              <ul>
                <li>🔨 Молоток: разбить одну фигуру</li>
                <li>⏰ Часы: +60 секунд к таймеру</li>
                <li>⬜ Квадратик: +1 к размеру поля</li>
              </ul>
              <button
                type='button'
                className='primary-btn'
                onClick={applyDailyReward}
              >
                Забрать награду
              </button>
            </div>
          </div>
        )}
        {profileModal}
      </main>
    </>
  );
}

export default App;
