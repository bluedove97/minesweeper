// Pure game logic. Mirrors GameForm.vb in DualBrain/Solitaire.
//
// card: { suit: 0..3 (spades, diamonds, clubs, hearts; odd = red), value: 0..12 (A..K) }
// state: {
//   settings: { drawOne, scoring, timed, statusBar, outline, cardBack },
//   stacks: 7 tableau piles of { suit, value, y, up } (y: pixel offset inside the pile),
//   deck: cards still to deal, top = last,
//   deckEmpty: Boolean, deck shows the empty slot and the next click turns the
//              waste over (the original's m_deckLength = -1),
//   waste: dealt cards { suit, value, x, y }, top = last (x/y: draw-three fan offset),
//   foundations: 4 piles of cards (the original's ace stacks),
//   score, time: Number,
//   timerOn: Boolean,
//   cycle: Number, times the deck has been turned over, starting at 1,
//   undo: null | { kind: 'draw' | 'recycle' | 'move' | 'auto', snapshot, from?, to? },
//   won: Boolean,
// }
// Every function returns a new state; arrays are never mutated in place, so
// undo snapshots can share them.

export const SCORING = ['None', 'Standard', 'Vegas', 'VegasCumulative'];

export const defaultSettings = {
  cardBack: 3,
  drawOne: false,
  outline: false,
  scoring: 'Standard',
  timed: true,
  statusBar: true,
};

const SMALL = 3; // y step between face-down tableau cards
const LARGE = 15; // y step for cards dropped onto a tableau pile
const X_BIG_SHIFT = 15; // draw-three fan, x step
const Y_SHIFT = 1; // draw-three fan, y step

const isStandard = s => s.settings.scoring === 'Standard';
const isVegas = s => s.settings.scoring === 'Vegas' || s.settings.scoring === 'VegasCumulative';
const isRed = card => card.suit % 2 === 1;
const plain = ({ suit, value }) => ({ suit, value });

// The original clamps a negative Standard score to 0 whenever it refreshes the status bar.
function clampScore(state) {
  return isStandard(state) && state.score < 0 ? { ...state, score: 0 } : state;
}

function snapshot(s) {
  return {
    stacks: s.stacks,
    deck: s.deck,
    deckEmpty: s.deckEmpty,
    waste: s.waste,
    foundations: s.foundations,
    cycle: s.cycle,
  };
}

function shuffle(cards, random) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Deal(): pile k gets k face-down cards and one face-up card; 24 cards stay in the deck.
export function deal(settings = defaultSettings, previousScore = 0, random = Math.random) {
  const all = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let value = 0; value < 13; value++) all.push({ suit, value });
  }
  const cards = shuffle(all, random);
  let n = 0;
  const stacks = [];
  for (let k = 0; k < 7; k++) {
    const pile = [];
    for (let j = 0; j < k; j++) pile.push({ ...cards[n++], y: j * SMALL, up: false });
    pile.push({ ...cards[n++], y: k * SMALL, up: true });
    stacks.push(pile);
  }
  const score = {
    Standard: 0,
    Vegas: -52,
    VegasCumulative: previousScore - 52,
  }[settings.scoring] ?? previousScore;
  return {
    settings,
    stacks,
    deck: cards.slice(n),
    deckEmpty: false,
    waste: [],
    foundations: [[], [], [], []],
    score,
    time: 0,
    timerOn: false,
    cycle: 1,
    undo: null,
    won: false,
  };
}

// The game timer starts on the first deal from the deck or the first drag attempt.
export function startTimer(state) {
  if (state.timerOn || state.won || state.time !== 0 || !state.settings.timed) return state;
  return { ...state, timerOn: true };
}

// GameTimer_Tick: one second; every 10 seconds costs 2 points.
export function tick(state) {
  if (!state.timerOn) return state;
  const time = state.time + 1;
  const score = time % 10 === 0 ? state.score - 2 : state.score;
  return clampScore({ ...state, time, score });
}

// Click on the deck (DeckToDealPictureBox_MouseDown + DropPanelPictureBox_Paint).
export function drawFromDeck(state) {
  if (state.won) return state;
  let s = state;
  if (!s.deckEmpty && s.deck.length > 0) {
    const limit = s.settings.drawOne ? 1 : Math.min(3, s.deck.length);
    const deck = [...s.deck];
    const waste = [...s.waste];
    for (let i = 0; i < limit; i++) {
      waste.push({ ...plain(deck.pop()), x: i * X_BIG_SHIFT, y: i * Y_SHIFT });
      // Only the newest three cards stay fanned out.
      const n = waste.length;
      if (n > 3 && waste[n - 3].y !== 0) waste[n - 3] = { ...waste[n - 3], x: 0, y: 0 };
      if (n > 4 && waste[n - 4].y !== 0) waste[n - 4] = { ...waste[n - 4], x: 0, y: 0 };
    }
    s = startTimer({ ...s, deck, waste, undo: { kind: 'draw', snapshot: snapshot(state) } });
  }
  if (s.deck.length === 0) {
    if (s.deckEmpty) {
      // Turn the waste over into the deck.
      const cycle = s.cycle + 1;
      let score = s.score;
      if (isStandard(s) && cycle > 3 && !s.settings.drawOne) score -= 20;
      else if (isStandard(s) && cycle > 1 && s.settings.drawOne) score -= 100;
      s = {
        ...s,
        deck: [...s.waste].reverse().map(plain),
        waste: [],
        deckEmpty: false,
        cycle,
        score,
        undo: { kind: 'recycle', snapshot: snapshot(state) },
      };
    } else {
      s = { ...s, deckEmpty: true };
    }
  }
  return clampScore(s);
}

// ---------- moving cards ----------

const sameSource = (a, b) => a.pile === b.pile && (a.pile === 'waste' || a.index === b.index);

// Cards picked up from `source`, or null when nothing can be dragged there.
// source: { pile: 'stack', index, card } | { pile: 'waste' } | { pile: 'foundation', index }
export function liftCards(state, source) {
  if (source.pile === 'stack') {
    const pile = state.stacks[source.index];
    const card = pile[source.card];
    return card && card.up ? pile.slice(source.card) : null;
  }
  const pile = source.pile === 'waste' ? state.waste : state.foundations[source.index];
  return pile.length ? pile.slice(-1) : null;
}

// State without the top `count` cards of `source` (no scoring).
export function takeCards(state, source, count) {
  if (source.pile === 'stack') {
    const stacks = [...state.stacks];
    stacks[source.index] = stacks[source.index].slice(0, -count);
    return { ...state, stacks };
  }
  if (source.pile === 'waste') return { ...state, waste: state.waste.slice(0, -count) };
  const foundations = [...state.foundations];
  foundations[source.index] = foundations[source.index].slice(0, -count);
  return { ...state, foundations };
}

function fitsFoundation(foundation, card) {
  if (foundation.length === 0) return card.value === 0;
  return card.suit === foundation[0].suit && card.value === foundation.length;
}

function checkWon(state) {
  const total = state.foundations.reduce((n, f) => n + f.length, 0);
  return total === 52 ? { ...state, won: true, undo: null, timerOn: false } : state;
}

// Drop the cards lifted from `source` onto target { pile: 'stack' | 'foundation', index }.
// Returns the same state when the drop is not allowed (HandleMouseUp).
export function dropCards(state, source, target) {
  if (state.won || sameSource(source, target)) return state;
  const cards = liftCards(state, source);
  if (!cards) return state;
  const first = cards[0];
  const undo = { kind: 'move', from: source.pile, to: target.pile, snapshot: snapshot(state) };
  let s = takeCards(state, source, cards.length);

  if (target.pile === 'stack') {
    const pile = s.stacks[target.index];
    const top = pile[pile.length - 1];
    const fits = (first.value === 12 && pile.length === 0)
      || (top && top.up && isRed(top) !== isRed(first) && first.value === top.value - 1);
    if (!fits) return state;
    const next = [...pile];
    for (const card of cards) {
      const y = card.value !== 12 ? next[next.length - 1].y + LARGE : 0;
      next.push({ ...plain(card), y, up: true });
    }
    const stacks = [...s.stacks];
    stacks[target.index] = next;
    let score = s.score;
    if (isStandard(s) && source.pile === 'waste') score += 5;
    else if (isStandard(s) && source.pile === 'foundation') score -= 15;
    return clampScore({ ...s, stacks, score, undo });
  }

  const foundation = s.foundations[target.index];
  const fits = foundation.length === 0
    ? first.value === 0
    : cards.length === 1 && fitsFoundation(foundation, first);
  if (!fits) return state;
  const foundations = [...s.foundations];
  foundations[target.index] = [...foundation, plain(first)];
  const score = s.score + (isStandard(s) ? 10 : isVegas(s) ? 5 : 0);
  return checkWon(clampScore({ ...s, foundations, score, undo }));
}

// Click on a tableau pile turns its face-down top card over. Not undoable.
export function flipTop(state, index) {
  const pile = state.stacks[index];
  const top = pile[pile.length - 1];
  if (state.won || !top || top.up) return state;
  const stacks = [...state.stacks];
  stacks[index] = [...pile.slice(0, -1), { ...top, up: true }];
  return clampScore({ ...state, stacks, score: state.score + (isStandard(state) ? 5 : 0), undo: null });
}

function topOf(state, source) {
  const pile = source.pile === 'waste' ? state.waste : state.stacks[source.index];
  return pile[pile.length - 1];
}

function moveToFoundation(state, source, index) {
  const card = topOf(state, source);
  const s = takeCards(state, source, 1);
  const foundations = [...s.foundations];
  foundations[index] = [...foundations[index], plain(card)];
  return { ...s, foundations, undo: { kind: 'auto', snapshot: snapshot(state) } };
}

// Double click on the top card of a tableau pile or the waste (DoDoubleClick).
// An ace goes to the first empty foundation, anything else onto its suit.
export function sendToFoundation(state, source) {
  if (state.won) return state;
  const card = topOf(state, source);
  if (!card) return state;
  const index = card.value === 0
    ? state.foundations.findIndex(f => f.length === 0)
    : state.foundations.findIndex(f => f.length !== 0 && fitsFoundation(f, card));
  if (index === -1) return state;
  const s = moveToFoundation(state, source, index);
  const score = s.score + (isStandard(s) ? 10 : isVegas(s) ? 5 : 0);
  return checkWon(clampScore({ ...s, score }));
}

// Right click: move everything possible to the foundations (MoveAllPossibleCardsUp).
// Only the last card moved can be undone, as in the original.
export function moveAllUp(state) {
  if (state.won) return state;
  let s = state;
  let moved = 0;
  let working = true;
  while (working) {
    working = false;
    for (let i = 0; i < 4; i++) {
      const wasteTop = s.waste[s.waste.length - 1];
      if (wasteTop && fitsFoundation(s.foundations[i], wasteTop)) {
        s = moveToFoundation(s, { pile: 'waste' }, i);
        moved += 1;
        working = true;
      }
      for (let j = 0; j < 7; j++) {
        const top = s.stacks[j][s.stacks[j].length - 1];
        if (top && top.up && fitsFoundation(s.foundations[i], top)) {
          s = moveToFoundation(s, { pile: 'stack', index: j }, i);
          moved += 1;
          working = true;
        }
      }
    }
  }
  if (moved === 0) return state;
  if (isStandard(s)) s = { ...s, score: s.score + 10 * moved };
  return checkWon(clampScore(s));
}

// Undo the last move. The score adjustments are the original's, which do not
// always mirror what the move scored.
export function undo(state) {
  const u = state.undo;
  if (!u || state.won) return state;
  const s = { ...state, ...u.snapshot, undo: null };
  const std = isStandard(s);
  const vegas = isVegas(s);
  let delta = 0;
  if (u.kind === 'move') {
    if (u.to === 'foundation' && u.from !== 'foundation') delta = std ? -10 : vegas ? -5 : 0;
    else if (u.from === 'waste' && u.to === 'stack') delta = std ? -5 : 0;
    else if (u.from === 'foundation' && u.to === 'stack') delta = std ? 15 : vegas ? 5 : 0;
  } else if (u.kind === 'auto') {
    delta = std ? -10 : vegas ? -5 : 0;
  } else if (u.kind === 'recycle') {
    if (std && s.cycle > 2 && !s.settings.drawOne) delta = 20;
    else if (std && s.cycle > 0 && s.settings.drawOne) delta = 100;
  }
  return clampScore({ ...s, score: s.score + delta });
}

// ---------- options ----------

// OptionsDialog.Redeal: draw mode, timing or scoring changed (switching
// between Vegas and cumulative Vegas does not count).
export function needsRedeal(oldSettings, newSettings) {
  if (oldSettings.drawOne !== newSettings.drawOne || oldSettings.timed !== newSettings.timed) return true;
  if (oldSettings.scoring === newSettings.scoring) return false;
  const vegasPair = [oldSettings.scoring, newSettings.scoring].every(x => x === 'Vegas' || x === 'VegasCumulative');
  return !vegasPair;
}

export function applyOptions(state, settings, random = Math.random) {
  if (needsRedeal(state.settings, settings)) return deal(settings, state.score, random);
  return clampScore({ ...state, settings });
}

// Choosing a card back always deals a new game.
export function applyCardBack(state, cardBack, random = Math.random) {
  return deal({ ...state.settings, cardBack }, state.score, random);
}

// Status bar text; `negative` marks a Vegas debt, shown in red.
export function scoreText(state) {
  const { scoring } = state.settings;
  if (scoring === 'None') return { text: '', negative: false };
  if (scoring === 'Standard') return { text: `Score: ${state.score}`, negative: false };
  return state.score < 0
    ? { text: `Score: -$${-state.score}`, negative: true }
    : { text: `Score: $${state.score}`, negative: false };
}
