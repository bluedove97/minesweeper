// Board geometry and hit testing, taken from GameForm.Designer.vb and
// GameForm.vb (WindowSizeChanged, FindHit, HoverTest). Coordinates are
// relative to the green playing area below the menu bar.

export const CARD_W = 71;
export const CARD_H = 96;
const LARGE = 15;
const X_SHIFT = 2; // deck thickness step
const Y_SHIFT = 1;

export const BOARD_W = 694;
export const BOARD_H = 496;

// WindowSizeChanged: offset = (Width - 8 - 7 * cardWidth) \ 8 for the default 710px form.
const OFFSET = 25;
const column = k => (k + 1) * OFFSET + k * CARD_W;
const TOP_Y = 19;
const STACK_Y = 145;

// Control rectangles (designer sizes; drop tests use the card width instead).
export const DECK = { x: column(0), y: TOP_Y, w: 96, h: 122 };
export const WASTE = { x: column(1), y: TOP_Y, w: 124, h: 122 };
export const FOUNDATIONS = [3, 4, 5, 6].map(k => ({ x: column(k), y: TOP_Y, w: 86, h: 118 }));
const STACK_X = [0, 1, 2, 3, 4, 5, 6].map(column);
const STACK_W = 85;

export function stackRect(state, index) {
  const pile = state.stacks[index];
  const h = pile.length ? pile[pile.length - 1].y + CARD_H : CARD_H;
  return { x: STACK_X[index], y: STACK_Y, w: STACK_W, h };
}

export function pileRect(state, pile) {
  switch (pile.pile) {
    case 'deck': return DECK;
    case 'waste': return WASTE;
    case 'foundation': return FOUNDATIONS[pile.index];
    default: return stackRect(state, pile.index);
  }
}

const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

// The pile control under a board point, or null.
export function pileAt(state, x, y) {
  const piles = [
    { pile: 'deck' },
    { pile: 'waste' },
    ...[0, 1, 2, 3].map(index => ({ pile: 'foundation', index })),
    ...[0, 1, 2, 3, 4, 5, 6].map(index => ({ pile: 'stack', index })),
  ];
  return piles.find(p => inside(pileRect(state, p), x, y)) || null;
}

// Whether a press at (x, y) inside the deck control hits the drawn card; the
// clickable card shifts with the deck's thickness.
export function deckHit(state, x, y) {
  const n = state.deckEmpty ? -1 : state.deck.length;
  if (n < 11) return x < CARD_W && y < CARD_H;
  const shift = n < 21 ? 1 : 2;
  return x > shift * X_SHIFT && x < shift * X_SHIFT + CARD_W
    && y > shift * Y_SHIFT && y < shift * Y_SHIFT + CARD_H;
}

// FindHit: the drag source for a point (x, y) inside `pile`'s control, or null.
// Face-down cards are found here; liftCards() then refuses them.
export function findHit(state, pile, x, y) {
  if (pile.pile === 'foundation') {
    return state.foundations[pile.index].length ? { pile: 'foundation', index: pile.index } : null;
  }
  if (pile.pile === 'waste') {
    const top = state.waste[state.waste.length - 1];
    if (!top) return null;
    if (state.settings.drawOne) return x < CARD_W ? { pile: 'waste' } : null;
    // The original compares y against the card width, not its height.
    const hit = x > top.x && x < top.x + CARD_W && y > top.y && y < top.y + CARD_W;
    return hit ? { pile: 'waste' } : null;
  }
  if (pile.pile === 'stack') {
    const cards = state.stacks[pile.index];
    for (let i = 0; i < cards.length; i++) {
      const end = i === cards.length - 1 ? cards[i].y + CARD_H : cards[i + 1].y;
      if (y >= cards[i].y && y < end) return { pile: 'stack', index: pile.index, card: i };
    }
  }
  return null;
}

// Whether (x, y) inside the pile's control is over its top card (DoDoubleClick).
export function overTopCard(state, pile, x, y) {
  const cards = pile.pile === 'waste' ? state.waste : state.stacks[pile.index];
  const top = cards[cards.length - 1];
  if (!top) return false;
  const left = pile.pile === 'waste' ? top.x : 0;
  return x > left && x < left + CARD_W && y > top.y && y < top.y + CARD_H;
}

// Starting box of the dragged cards, in board coordinates.
export function dragBox(state, source) {
  if (source.pile === 'stack') {
    const cards = state.stacks[source.index];
    return {
      x: STACK_X[source.index],
      y: STACK_Y + cards[source.card].y,
      h: CARD_H + LARGE * (cards.length - source.card - 1),
    };
  }
  if (source.pile === 'waste') {
    const top = state.waste[state.waste.length - 1];
    return { x: WASTE.x + top.x, y: WASTE.y + top.y, h: CARD_H };
  }
  const f = FOUNDATIONS[source.index];
  return { x: f.x, y: f.y, h: CARD_H };
}

// Drop targets in the order HandleMouseUp walks the form's Controls collection.
const TARGET_ORDER = [
  ['stack', 6], ['stack', 5], ['stack', 4], ['stack', 2], ['stack', 1], ['stack', 0],
  ['foundation', 1], ['foundation', 0], ['stack', 3], ['foundation', 3], ['foundation', 2],
].map(([pile, index]) => ({ pile, index }));

// HoverTest, with its strict comparisons: the box must overlap the target
// horizontally and vertically.
function hovers(target, box) {
  const left = box.x;
  const right = left + CARD_W;
  const top = box.y;
  const bottom = top + box.h;
  const cleft = target.x;
  const cright = cleft + CARD_W;
  const ctop = target.y;
  const cbottom = ctop + target.h;
  const horizontal = (cleft < left && cright > left) || (cleft > left && cleft < right);
  const vertical = (ctop < top && cbottom > top) || (ctop > top && ctop < bottom);
  return horizontal && vertical;
}

// Targets under the drag box, in drop-priority order, excluding the pile the
// cards came from.
export function dropTargets(state, box, source) {
  return TARGET_ORDER.filter(t => {
    if (t.pile === source.pile && t.index === source.index) return false;
    return hovers(pileRect(state, t), box);
  });
}
