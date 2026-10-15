// Pure game logic. Mirrors the reducer in winXP/src/WinXP/apps/Minesweeper/index.js.
//
// state: {
//   difficulty: 'Beginner' | 'Intermediate' | 'Expert',
//   status: 'new' | 'started' | 'died' | 'won',
//   rows, columns, mines: Number,
//   ceils: Array<{
//     state: 'cover' | 'flag' | 'unknown' | 'open' | 'mine' | 'die' | 'misflagged',
//     minesAround: Number (negative for a mine),
//     opening: Boolean (rendered as pressed while the mouse is held)
//   }>
// }

export const Config = {
  Beginner: { rows: 9, columns: 9, mines: 10 },
  Intermediate: { rows: 16, columns: 16, mines: 40 },
  Expert: { rows: 16, columns: 30, mines: 99 },
};

const MINE = -10;

export function getInitState(difficulty = 'Beginner') {
  const { rows, columns, mines } = Config[difficulty];
  const ceils = Array.from({ length: rows * columns }, () => ({
    state: 'cover',
    minesAround: 0,
    opening: false,
  }));
  return { difficulty, status: 'new', rows, columns, mines, ceils };
}

export function getNearIndexes(index, rows, columns) {
  if (index < 0 || index >= rows * columns) return [];
  const row = Math.floor(index / columns);
  const column = index % columns;
  return [
    index - columns - 1,
    index - columns,
    index - columns + 1,
    index - 1,
    index + 1,
    index + columns - 1,
    index + columns,
    index + columns + 1,
  ].filter((_, i) => {
    if (row === 0 && i < 3) return false;
    if (row === rows - 1 && i > 4) return false;
    if (column === 0 && [0, 3, 5].includes(i)) return false;
    if (column === columns - 1 && [2, 4, 7].includes(i)) return false;
    return true;
  });
}

// Uniform random subset of `size` items (same contract as lodash.samplesize).
function sampleSize(array, size, random) {
  const copy = [...array];
  const n = Math.min(size, copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Only the first-clicked cell is excluded, so the first click is never a mine
// but may still land on a number.
export function insertMines(state, exclude, random = Math.random) {
  const { rows, columns, mines } = state;
  const ceils = state.ceils.map(ceil => ({ ...ceil }));
  const candidates = [...Array(rows * columns).keys()].filter(i => i !== exclude);
  sampleSize(candidates, mines, random).forEach(chosen => {
    ceils[chosen].minesAround = MINE;
    getNearIndexes(chosen, rows, columns).forEach(near => {
      ceils[near].minesAround += 1;
    });
  });
  return { ...state, ceils, status: 'started' };
}

// Flood fill: stops at mines and flags, expands through zeros.
// '?' (unknown) cells are opened like covered ones.
function autoCeils(state, index) {
  const { rows, columns } = state;
  const walked = new Set();
  const result = [];
  const stack = [index];
  while (stack.length) {
    const i = stack.pop();
    const ceil = state.ceils[i];
    if (walked.has(i) || ceil.minesAround < 0 || ceil.state === 'flag') continue;
    walked.add(i);
    result.push(i);
    if (ceil.minesAround === 0) stack.push(...getNearIndexes(i, rows, columns));
  }
  return result;
}

export function openCeilAt(state, index) {
  const ceils = [...state.ceils];
  autoCeils(state, index).forEach(i => {
    ceils[i] = { ...ceils[i], state: 'open' };
  });
  return { ...state, ceils };
}

// Right click cycles cover -> flag -> ? -> cover.
export function changeCeilState(state, index) {
  const ceil = state.ceils[index];
  if (ceil.state === 'open' || ['won', 'died'].includes(state.status)) return state;
  const next = { cover: 'flag', flag: 'unknown', unknown: 'cover' }[ceil.state];
  if (!next) return state;
  const ceils = [...state.ceils];
  ceils[index] = { ...ceil, state: next };
  return { ...state, ceils };
}

export function gameOver(state, index) {
  const ceils = state.ceils.map(ceil => {
    if (ceil.minesAround < 0 && ceil.state !== 'flag') return { ...ceil, state: 'mine' };
    if (ceil.state === 'flag' && ceil.minesAround >= 0) return { ...ceil, state: 'misflagged' };
    return { ...ceil, opening: false };
  });
  ceils[index] = { ...ceils[index], state: 'die' };
  return { ...state, status: 'died', ceils };
}

export function won(state) {
  const ceils = state.ceils.map(ceil => ({
    ...ceil,
    state: ceil.minesAround >= 0 ? 'open' : 'flag',
  }));
  return { ...state, status: 'won', ceils };
}

// Left click release.
export function openCeil(state, index, random = Math.random) {
  switch (state.status) {
    case 'new':
      return checkWon(openCeilAt(insertMines(state, index, random), index));
    case 'started': {
      const ceil = state.ceils[index];
      if (['flag', 'open'].includes(ceil.state)) return state;
      if (ceil.minesAround < 0) return gameOver(state, index);
      return checkWon(openCeilAt(state, index));
    }
    default:
      return state;
  }
}

// Left+right release on an open number: opens neighbours when the number of
// adjacent flags matches; a wrongly placed flag means hitting the unflagged mine.
export function openCeils(state, index) {
  const ceil = state.ceils[index];
  if (ceil.state !== 'open' || ceil.minesAround <= 0 || state.status !== 'started') {
    return state;
  }
  const indexes = getNearIndexes(index, state.rows, state.columns);
  const flags = indexes.filter(i => state.ceils[i].state === 'flag').length;
  if (flags !== ceil.minesAround) return state;
  const mineIndex = indexes.find(
    i => state.ceils[i].minesAround < 0 && state.ceils[i].state !== 'flag',
  );
  // The original checks `if (mineIndex)`, which misses a mine at index 0.
  if (mineIndex !== undefined) return gameOver(state, mineIndex);
  return checkWon(indexes.reduce((s, i) => openCeilAt(s, i), state));
}

export function remainSafeCeils(state) {
  return state.ceils.filter(c => c.state !== 'open' && c.minesAround >= 0).length;
}

function checkWon(state) {
  return state.status === 'started' && remainSafeCeils(state) === 0 ? won(state) : state;
}

// Pressed-cell preview while a button is held.
export function setOpening(state, indexes) {
  if (['died', 'won'].includes(state.status)) return state;
  const set = new Set(indexes.filter(i => i >= 0 && i < state.ceils.length));
  const ceils = state.ceils.map((ceil, i) => {
    const opening = set.has(i);
    return ceil.opening === opening ? ceil : { ...ceil, opening };
  });
  return { ...state, ceils };
}

export function remainMines(state) {
  return (
    state.mines -
    state.ceils.filter(c => c.state === 'flag' || c.state === 'misflagged').length
  );
}

// 3-digit LED text: negatives as '-NN' (mod 100), positives capped at 999.
export function digitString(number) {
  if (number < 0) return '-' + String(-number % 100).padStart(2, '0');
  return String(Math.min(number, 999)).padStart(3, '0');
}
