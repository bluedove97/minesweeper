import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSettings,
  deal,
  tick,
  drawFromDeck,
  liftCards,
  dropCards,
  flipTop,
  sendToFoundation,
  moveAllUp,
  undo,
  needsRedeal,
  applyOptions,
  scoreText,
  startTimer,
} from '../apps/solitaire/game.js';
import { deckHit, findHit, dropTargets, dragBox, pileAt } from '../apps/solitaire/layout.js';

const S = 0; const D = 1; const C = 2; const H = 3; // spades, diamonds, clubs, hearts
const card = (suit, value) => ({ suit, value });
const up = (suit, value, y = 0) => ({ suit, value, y, up: true });
const down = (suit, value, y = 0) => ({ suit, value, y, up: false });

// An empty board to place cards on by hand.
function board(overrides = {}, settings = {}) {
  return {
    ...deal({ ...defaultSettings, ...settings }),
    stacks: [[], [], [], [], [], [], []],
    deck: [],
    waste: [],
    foundations: [[], [], [], []],
    ...overrides,
  };
}

const suitRun = (suit, n) => Array.from({ length: n }, (_, v) => card(suit, v));

test('deal: 28 tableau cards, 24 in the deck, every card once', () => {
  const s = deal();
  s.stacks.forEach((pile, k) => {
    assert.equal(pile.length, k + 1);
    pile.forEach((c, j) => {
      assert.equal(c.up, j === k);
      assert.equal(c.y, j * 3);
    });
  });
  assert.equal(s.deck.length, 24);
  const all = [...s.stacks.flat(), ...s.deck].map(c => `${c.suit}-${c.value}`);
  assert.equal(new Set(all).size, 52);
  assert.equal(s.score, 0);
  assert.equal(s.cycle, 1);
});

test('deal: starting score per scoring mode', () => {
  assert.equal(deal({ ...defaultSettings, scoring: 'Vegas' }, 100).score, -52);
  assert.equal(deal({ ...defaultSettings, scoring: 'VegasCumulative' }, 100).score, 48);
  assert.equal(deal({ ...defaultSettings, scoring: 'None' }, 7).score, 7);
  assert.equal(deal({ ...defaultSettings, scoring: 'Standard' }, 7).score, 0);
});

test('draw three fans the newest three cards and starts the timer', () => {
  let s = board({ deck: suitRun(S, 7) });
  s = drawFromDeck(s);
  assert.deepEqual(s.waste.map(c => [c.value, c.x, c.y]), [[6, 0, 0], [5, 15, 1], [4, 30, 2]]);
  assert.equal(s.timerOn, true);
  s = drawFromDeck(s);
  assert.deepEqual(s.waste.map(c => [c.x, c.y]), [[0, 0], [0, 0], [0, 0], [0, 0], [15, 1], [30, 2]]);
  s = drawFromDeck(s); // one card left
  assert.equal(s.waste.length, 7);
  assert.deepEqual([s.waste[6].x, s.waste[6].y], [0, 0]);
  assert.equal(s.deckEmpty, true); // the same click shows the empty slot
});

test('turning the deck over: order restored, penalties from the third turn in draw three', () => {
  let s = board({ deck: suitRun(S, 3) });
  s = drawFromDeck(s);
  assert.equal(s.deckEmpty, true);
  s = { ...s, score: 100 };
  s = drawFromDeck(s); // turn over: cycle 2
  assert.equal(s.cycle, 2);
  assert.deepEqual(s.deck.map(c => c.value), [0, 1, 2]);
  assert.equal(s.waste.length, 0);
  assert.equal(s.score, 100);
  s = drawFromDeck(drawFromDeck(s)); // cycle 3
  assert.equal(s.score, 100);
  s = drawFromDeck(drawFromDeck(s)); // cycle 4
  assert.equal(s.score, 80);
});

test('draw one: every turn over costs 100 (clamped at 0)', () => {
  let s = board({ deck: [card(S, 1)] }, { drawOne: true });
  s = drawFromDeck(s);
  s = drawFromDeck({ ...s, score: 150 });
  assert.equal(s.score, 50);
  s = drawFromDeck(drawFromDeck(s));
  assert.equal(s.score, 0);
});

test('undo a draw that emptied the deck puts every card back', () => {
  let s = board({ deck: suitRun(S, 2) });
  s = drawFromDeck(s);
  assert.equal(s.deckEmpty, true);
  s = undo(s);
  assert.equal(s.deck.length, 2);
  assert.equal(s.waste.length, 0);
  assert.equal(s.deckEmpty, false);
  assert.equal(s.undo, null);
});

test('undo a turn over refunds the penalty', () => {
  let s = board({ waste: suitRun(S, 3).map(c => ({ ...c, x: 0, y: 0 })), deckEmpty: true, cycle: 3, score: 50 });
  s = drawFromDeck(s);
  assert.equal(s.score, 30);
  s = undo(s);
  assert.equal(s.score, 50);
  assert.equal(s.cycle, 3);
  assert.equal(s.deckEmpty, true);
  assert.equal(s.waste.length, 3);
});

test('tableau drop: alternate colour, one lower; kings on empty piles', () => {
  let s = board({ stacks: [[up(S, 7)], [up(H, 6)], [up(D, 6)], [up(C, 12)], [], [], []] });
  assert.equal(dropCards(s, { pile: 'stack', index: 1, card: 0 }, { pile: 'stack', index: 2 }), s);
  s = dropCards(s, { pile: 'stack', index: 1, card: 0 }, { pile: 'stack', index: 0 });
  assert.deepEqual(s.stacks[0].map(c => [c.value, c.y]), [[7, 0], [6, 15]]);
  assert.equal(s.stacks[1].length, 0);
  const s2 = dropCards(s, { pile: 'stack', index: 3, card: 0 }, { pile: 'stack', index: 4 });
  assert.deepEqual(s2.stacks[4], [up(C, 12, 0)]);
  // Only kings go on an empty pile.
  assert.equal(dropCards(s, { pile: 'stack', index: 2, card: 0 }, { pile: 'stack', index: 1 }), s);
});

test('moving a run keeps 15px steps; face-down cards cannot be lifted', () => {
  const s = board({ stacks: [[down(S, 1), up(H, 9, 3), up(C, 8, 18)], [up(S, 10)], [], [], [], [], []] });
  assert.equal(liftCards(s, { pile: 'stack', index: 0, card: 0 }), null);
  const next = dropCards(s, { pile: 'stack', index: 0, card: 1 }, { pile: 'stack', index: 1 });
  assert.deepEqual(next.stacks[1].map(c => [c.value, c.y]), [[10, 0], [9, 15], [8, 30]]);
  assert.deepEqual(next.stacks[0], [down(S, 1)]);
});

test('foundation drop: ace on empty, same suit one higher, single cards only', () => {
  let s = board({ stacks: [[up(H, 0)], [up(H, 1)], [up(S, 2), up(H, 1, 15)], [], [], [], []] });
  s = dropCards(s, { pile: 'stack', index: 0, card: 0 }, { pile: 'foundation', index: 2 });
  assert.equal(s.foundations[2].length, 1);
  assert.equal(s.score, 10);
  // Two cards at once never go up.
  assert.equal(dropCards(s, { pile: 'stack', index: 2, card: 0 }, { pile: 'foundation', index: 2 }), s);
  s = dropCards(s, { pile: 'stack', index: 1, card: 0 }, { pile: 'foundation', index: 2 });
  assert.equal(s.foundations[2].length, 2);
  assert.equal(s.score, 20);
});

test('standard scoring: waste to tableau +5, foundation to tableau -15, flip +5', () => {
  let s = board({
    stacks: [[up(S, 5)], [down(C, 1), up(S, 4, 3)], [up(D, 5)], [], [], [], []],
    waste: [{ ...card(H, 4), x: 0, y: 0 }],
    foundations: [[card(D, 0), card(D, 1), card(D, 2), card(D, 3)], [], [], []],
    score: 20,
  });
  s = dropCards(s, { pile: 'waste' }, { pile: 'stack', index: 0 });
  assert.equal(s.score, 25);
  s = dropCards(s, { pile: 'foundation', index: 0 }, { pile: 'stack', index: 1 });
  assert.equal(s.score, 10);
  s = dropCards(s, { pile: 'stack', index: 1, card: 1 }, { pile: 'stack', index: 2 });
  assert.equal(s.stacks[1].length, 1);
  assert.equal(s.score, 10);
  s = flipTop(s, 1);
  assert.equal(s.stacks[1][0].up, true);
  assert.equal(s.score, 15);
  assert.equal(s.undo, null); // flipping is not undoable
});

test('vegas: +5 per foundation card, negative score shown as -$', () => {
  let s = board({ stacks: [[up(S, 0)], [], [], [], [], [], []] }, { scoring: 'Vegas' });
  assert.equal(s.score, -52);
  assert.deepEqual(scoreText(s), { text: 'Score: -$52', negative: true });
  s = sendToFoundation(s, { pile: 'stack', index: 0 });
  assert.equal(s.score, -47);
  assert.deepEqual(scoreText({ ...s, score: 3 }), { text: 'Score: $3', negative: false });
  assert.deepEqual(scoreText({ ...s, settings: { ...s.settings, scoring: 'None' } }), { text: '', negative: false });
});

test('double click: aces to the first empty foundation, others onto their suit', () => {
  let s = board({
    stacks: [[up(C, 0)], [up(C, 1)], [up(D, 5)], [], [], [], []],
    foundations: [[card(S, 0)], [], [], []],
  });
  s = sendToFoundation(s, { pile: 'stack', index: 0 });
  assert.equal(s.foundations[1][0].suit, C);
  s = sendToFoundation(s, { pile: 'stack', index: 1 });
  assert.equal(s.foundations[1].length, 2);
  assert.equal(sendToFoundation(s, { pile: 'stack', index: 2 }), s);
});

test('right click moves everything it can; undo restores only the last card', () => {
  let s = board({
    stacks: [[up(S, 0)], [up(S, 1)], [up(H, 0)], [down(S, 2)], [], [], []],
    waste: [{ ...card(S, 2), x: 0, y: 0 }],
  });
  s = moveAllUp(s);
  const total = s.foundations.reduce((n, f) => n + f.length, 0);
  assert.equal(total, 4); // face-down 2 of spades stays
  assert.equal(s.score, 40);
  s = undo(s);
  assert.equal(s.foundations.reduce((n, f) => n + f.length, 0), 3);
  assert.equal(s.score, 30);
});

test('undo of a move reverts the cards and applies the original score rule', () => {
  let s = board({ waste: [{ ...card(H, 0), x: 0, y: 0 }], score: 30 });
  s = dropCards(s, { pile: 'waste' }, { pile: 'foundation', index: 0 });
  assert.equal(s.score, 40);
  s = undo(s);
  assert.equal(s.waste.length, 1);
  assert.equal(s.foundations[0].length, 0);
  assert.equal(s.score, 30);
  assert.equal(undo(s), s); // single level
});

test('a failed drop leaves the undo untouched', () => {
  let s = board({ deck: [card(S, 9)], stacks: [[up(S, 3)], [up(S, 2)], [], [], [], [], []] });
  s = drawFromDeck(s);
  const before = s.undo;
  assert.equal(dropCards(s, { pile: 'stack', index: 1, card: 0 }, { pile: 'stack', index: 0 }).undo, before);
});

test('winning: last card up ends the game, stops the clock and disables input', () => {
  const foundations = [suitRun(S, 13), suitRun(D, 13), suitRun(C, 13), suitRun(H, 12)];
  let s = board({ foundations, stacks: [[up(H, 12)], [], [], [], [], [], []], timerOn: true });
  s = moveAllUp(s); // right-click finish counts too
  assert.equal(s.won, true);
  assert.equal(s.timerOn, false);
  assert.equal(s.undo, null);
  assert.equal(drawFromDeck(s), s);
});

test('timer: 2 points off every 10 seconds, only once started', () => {
  let s = board({ score: 10 });
  assert.equal(tick(s), s);
  s = startTimer(s);
  for (let i = 0; i < 10; i++) s = tick(s);
  assert.equal(s.time, 10);
  assert.equal(s.score, 8);
  assert.equal(startTimer(board({}, { timed: false })).timerOn, false);
});

test('options: redeal only when draw, timing or scoring family changes', () => {
  const base = defaultSettings;
  assert.equal(needsRedeal(base, { ...base, outline: true, statusBar: false }), false);
  assert.equal(needsRedeal(base, { ...base, drawOne: true }), true);
  assert.equal(needsRedeal(base, { ...base, timed: false }), true);
  assert.equal(needsRedeal(base, { ...base, scoring: 'Vegas' }), true);
  const vegas = { ...base, scoring: 'Vegas' };
  assert.equal(needsRedeal(vegas, { ...vegas, scoring: 'VegasCumulative' }), false);
  const s = deal(base);
  assert.equal(applyOptions(s, { ...base, outline: true }).stacks, s.stacks);
  assert.notEqual(applyOptions(s, { ...base, drawOne: true }).stacks, s.stacks);
});

// ---------- layout ----------

test('deck hit area moves with its thickness', () => {
  const s = board({ deck: suitRun(S, 5) });
  assert.equal(deckHit(s, 1, 1), true);
  assert.equal(deckHit(s, 72, 10), false);
  const thick = board({ deck: [...suitRun(S, 13), ...suitRun(H, 10)] });
  assert.equal(deckHit(thick, 3, 2), false);
  assert.equal(deckHit(thick, 74, 50), true);
});

test('findHit picks the card under the pointer in a tableau pile', () => {
  const s = board({ stacks: [[down(S, 1), up(H, 9, 3), up(C, 8, 18)], [], [], [], [], [], []] });
  const pile = { pile: 'stack', index: 0 };
  assert.deepEqual(findHit(s, pile, 10, 1), { pile: 'stack', index: 0, card: 0 });
  assert.deepEqual(findHit(s, pile, 10, 10), { pile: 'stack', index: 0, card: 1 });
  assert.deepEqual(findHit(s, pile, 10, 100), { pile: 'stack', index: 0, card: 2 });
  assert.equal(findHit(s, pile, 10, 120), null);
});

test('drop targets follow the original control order and skip the source', () => {
  const s = board({ stacks: [[up(S, 5)], [up(H, 4)], [], [], [], [], []] });
  const source = { pile: 'stack', index: 1, card: 0 };
  const box = dragBox(s, source);
  assert.deepEqual(dropTargets(s, box, source), []); // still exactly over its own pile
  // HoverTest's comparisons are strict: a box at exactly the pile's top edge misses it.
  assert.deepEqual(dropTargets(s, { ...box, x: box.x - 60 }, source), []);
  const moved = { ...box, x: box.x - 60, y: box.y + 5 };
  assert.deepEqual(dropTargets(s, moved, source), [{ pile: 'stack', index: 0 }]);
  // Straddling two piles: stack 1 is checked before stack 0.
  const straddle = { ...box, x: 70, y: box.y + 5 };
  assert.deepEqual(dropTargets(s, straddle, { pile: 'waste' }), [{ pile: 'stack', index: 1 }, { pile: 'stack', index: 0 }]);
  assert.deepEqual(pileAt(s, 30, 30), { pile: 'deck' });
});
