import {
  defaultSettings,
  deal,
  startTimer,
  tick,
  drawFromDeck,
  liftCards,
  takeCards,
  dropCards,
  flipTop,
  sendToFoundation,
  moveAllUp,
  undo,
  applyOptions,
  applyCardBack,
  scoreText,
} from './game.js';
import {
  BOARD_W,
  BOARD_H,
  CARD_W,
  DECK,
  WASTE,
  FOUNDATIONS,
  stackRect,
  pileRect,
  pileAt,
  deckHit,
  findHit,
  overTopCard,
  dragBox,
  dropTargets,
} from './layout.js';
import { createWinEffect } from './win-effect.js';
import { showOptions, showCardBacks, showDealAgain, showAbout } from './dialogs.js';
import { createMenuBar } from '../../shared/js/menu.js';

const SUIT_NAMES = ['Spade', 'Diamond', 'Club', 'Heart'];
const asset = name => new URL(`./assets/${name}.png`, import.meta.url).href;
const faceUrl = card => asset(`${SUIT_NAMES[card.suit]}_${card.value}`);
const backUrl = cardBack => asset(`CardBack_${cardBack}`);

const SETTINGS_KEY = 'solitaire.settings';

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { ...defaultSettings, ...saved };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings simply won't persist.
  }
}

const MENUS = [
  {
    label: 'Game',
    items: [
      { id: 'Deal', text: 'Deal' },
      '-',
      { id: 'Undo', text: 'Undo', disabled: true },
      { id: 'Deck', text: 'Deck...' },
      { id: 'Options', text: 'Options...' },
      '-',
      { id: 'Exit', text: 'Exit' },
    ],
  },
  {
    label: 'Help',
    items: [
      { id: 'Contents', text: 'Contents' },
      { id: 'Search', text: 'Search for Help on...' },
      { id: 'HowTo', text: 'How to Use Help' },
      '-',
      { id: 'About', text: "About 'Classic' Solitaire..." },
    ],
  },
];

export function mount(root, ctx) {
  const menu = createMenuBar(MENUS, onMenu);
  const sol = document.createElement('div');
  sol.className = 'sol';
  sol.innerHTML = `
    <div class="sol__board" style="width:${BOARD_W}px;height:${BOARD_H}px">
      <div class="sol__cards"></div>
      <div class="sol__drag" hidden></div>
      <canvas class="sol__win" width="${BOARD_W}" height="${BOARD_H}" hidden></canvas>
    </div>
    <div class="sol__status">
      <span class="sol__status-info"></span>
      <span class="sol__status-score"></span>
      <span class="sol__status-time"></span>
    </div>`;
  sol.prepend(menu.el);
  root.appendChild(sol);

  const board = sol.querySelector('.sol__board');
  const cardsLayer = sol.querySelector('.sol__cards');
  const dragLayer = sol.querySelector('.sol__drag');
  const winCanvas = sol.querySelector('.sol__win');
  const status = sol.querySelector('.sol__status');
  const scoreLabel = sol.querySelector('.sol__status-score');
  const timeLabel = sol.querySelector('.sol__status-time');

  let state = deal(loadSettings());
  let timer = null;
  let press = null; // { pile, button } of the mouse press on the board
  let drag = null; // { source, cards, box: { x, y, h } }
  let last = { x: 0, y: 0 }; // last mouse position, board coordinates
  let winFrame = null;

  // ---------- state / effects ----------

  function setState(next) {
    if (next === state) return;
    const wasWon = state.won;
    if (next.settings !== state.settings) saveSettings(next.settings);
    state = next;
    syncTimer();
    if (state.won && !wasWon) startWinEffect();
    if (!state.won) stopWinEffect();
    render();
  }

  function syncTimer() {
    if (state.timerOn && !timer) {
      timer = setInterval(() => setState(tick(state)), 1000);
    } else if (!state.timerOn && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function newDeal(next = deal(state.settings, state.score)) {
    drag = null;
    setState(next);
  }

  // ---------- rendering ----------

  function cardImg(src, x, y) {
    return `<img src="${src}" alt="" style="left:${x}px;top:${y}px">`;
  }

  function pileHTML(rect, inner) {
    return `<div class="sol__pile" style="left:${rect.x}px;top:${rect.y}px">${inner}</div>`;
  }

  function render() {
    // Non-outline dragging takes the cards out of their pile while they move.
    const view = drag && !state.settings.outline ? takeCards(state, drag.source, drag.cards.length) : state;
    const back = backUrl(view.settings.cardBack);
    let html = '';

    // Deck: empty slot, or one to three backs for its thickness.
    if (view.deckEmpty || (view.deck.length === 0 && view.waste.length === 0)) {
      html += pileHTML(DECK, cardImg(asset('CardSlot_0'), 0, 0));
    } else {
      let inner = cardImg(back, 0, 0);
      if (view.deck.length > 10) inner += cardImg(back, 2, 1);
      if (view.deck.length > 20) inner += cardImg(back, 4, 2);
      html += pileHTML(DECK, inner);
    }

    // Waste: draw one shows a thickening pile, draw three the stored fan.
    let x = 0;
    let y = 0;
    html += pileHTML(WASTE, view.waste.map((card, j) => {
      if (view.settings.drawOne) {
        if (j === 11 || j === 21) { x += 2; y += 1; }
        return cardImg(faceUrl(card), x, y);
      }
      return cardImg(faceUrl(card), card.x, card.y);
    }).join(''));

    view.foundations.forEach((f, i) => {
      const top = f[f.length - 1];
      html += pileHTML(FOUNDATIONS[i], cardImg(top ? faceUrl(top) : asset('CardSlot_2'), 0, 0));
    });

    view.stacks.forEach((pile, i) => {
      html += pileHTML(stackRect(view, i), pile.map(c => cardImg(c.up ? faceUrl(c) : back, 0, c.y)).join(''));
    });
    cardsLayer.innerHTML = html;

    renderDrag();
    renderStatus();
    menu.setDisabled('Undo', !state.undo);
  }

  function renderDrag() {
    dragLayer.hidden = !drag;
    if (!drag) return;
    const { box, cards } = drag;
    dragLayer.style.left = `${box.x}px`;
    dragLayer.style.top = `${box.y}px`;
    dragLayer.classList.toggle('outline', state.settings.outline);
    if (state.settings.outline) {
      dragLayer.style.width = `${CARD_W + 1}px`;
      dragLayer.style.height = `${box.h + 1}px`;
      dragLayer.innerHTML = '';
    } else {
      dragLayer.style.width = '';
      dragLayer.style.height = '';
      const y0 = cards[0].y || 0;
      dragLayer.innerHTML = cards
        .map(c => cardImg(faceUrl(c), 0, drag.source.pile === 'stack' ? c.y - y0 : 0))
        .join('');
    }
  }

  function renderStatus() {
    status.hidden = !state.settings.statusBar;
    const score = scoreText(state);
    scoreLabel.textContent = score.text;
    scoreLabel.classList.toggle('negative', score.negative);
    timeLabel.textContent = state.settings.timed ? `Time: ${state.time}` : '';
  }

  // ---------- win effect ----------

  const imageCache = new Map();
  function cardImage(suit, value) {
    const src = faceUrl({ suit, value });
    if (!imageCache.has(src)) {
      const img = new Image();
      img.src = src;
      imageCache.set(src, img);
    }
    return imageCache.get(src);
  }

  function startWinEffect() {
    const effect = createWinEffect({
      width: BOARD_W,
      height: BOARD_H,
      foundations: FOUNDATIONS.map((f, i) => ({ x: f.x, y: f.y, suit: state.foundations[i][0].suit })),
    });
    const g = winCanvas.getContext('2d');
    // The effect paints over the board's background (gray with outline dragging).
    g.fillStyle = state.settings.outline ? '#808080' : '#008000';
    g.fillRect(0, 0, BOARD_W, BOARD_H);
    winCanvas.hidden = false;
    const frame = () => {
      // The original paints one card position every ~7 ms.
      for (let i = 0; i < 2; i++) {
        if (!effect.step(g, cardImage)) {
          winFrame = null;
          winCanvas.hidden = true;
          showDealAgain(ctx.window, () => newDeal());
          return;
        }
      }
      winFrame = requestAnimationFrame(frame);
    };
    // Make sure the card faces are loaded before painting.
    const images = state.foundations.flatMap(f => f.map(c => cardImage(c.suit, c.value)));
    Promise.all(images.map(img => img.decode().catch(() => {}))).then(() => {
      if (state.won && winFrame === null) winFrame = requestAnimationFrame(frame);
    });
    winFrame = null;
  }

  function stopWinEffect() {
    if (winFrame !== null) cancelAnimationFrame(winFrame);
    winFrame = null;
    winCanvas.hidden = true;
  }

  // ---------- mouse handling (same rules as GameForm) ----------

  function boardPoint(e) {
    const r = board.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const insideBoard = p => p.x >= 0 && p.y >= 0 && p.x < BOARD_W && p.y < BOARD_H;

  board.addEventListener('mousedown', e => {
    const p = boardPoint(e);
    last = p;
    if (state.won) return;
    const pile = pileAt(state, p.x, p.y);
    press = { pile, button: e.button };
    if (pile?.pile === 'deck' && e.button === 0 && deckHit(state, p.x - DECK.x, p.y - DECK.y)) {
      setState(drawFromDeck(state));
    }
  });

  const onMouseMove = e => {
    const p = boardPoint(e);
    if (drag) {
      drag.box.x += p.x - last.x;
      drag.box.y += p.y - last.y;
      renderDrag();
    } else if (press && press.button === 0 && (e.buttons & 1) && press.pile && press.pile.pile !== 'deck') {
      // DoMouseMove: the first move with the button down starts the clock and
      // tries to pick up the card under the previous mouse position.
      setState(startTimer(state));
      const rect = pileRect(state, press.pile);
      const source = findHit(state, press.pile, last.x - rect.x, last.y - rect.y);
      const cards = source && liftCards(state, source);
      if (cards) {
        const box = dragBox(state, source);
        box.x += p.x - last.x;
        box.y += p.y - last.y;
        drag = { source, cards, box };
        render();
      }
    }
    last = p;
  };

  const onMouseUp = e => {
    const p = boardPoint(e);
    if (drag) {
      const { source, box } = drag;
      drag = null;
      let next = state;
      for (const target of dropTargets(state, box, source)) {
        next = dropCards(state, source, target);
        if (next !== state) break;
      }
      if (next !== state) setState(next);
      else render();
    } else if (e.button === 2 && press && insideBoard(p)) {
      setState(moveAllUp(state));
    }
    // WinForms Click on a tableau pile: pressed and released over the same
    // pile. The second click of a double click raises DoubleClick instead.
    if (press?.pile?.pile === 'stack' && e.button === 0 && e.detail !== 2) {
      const r = stackRect(state, press.pile.index);
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) {
        setState(flipTop(state, press.pile.index));
      }
    }
    press = null;
    last = p;
  };

  board.addEventListener('dblclick', e => {
    const p = boardPoint(e);
    const pile = pileAt(state, p.x, p.y);
    if (!pile || (pile.pile !== 'stack' && pile.pile !== 'waste')) return;
    const r = pileRect(state, pile);
    if (overTopCard(state, pile, p.x - r.x, p.y - r.y)) setState(sendToFoundation(state, pile));
  });

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ---------- menu bar ----------

  function onMenu(item) {
    switch (item) {
      case 'Deal': newDeal(); break;
      case 'Undo': setState(undo(state)); break;
      case 'Deck':
        showCardBacks(ctx.window, state.settings.cardBack, cardBack => newDeal(applyCardBack(state, cardBack)));
        break;
      case 'Options':
        showOptions(ctx.window, state.settings, settings => newDeal(applyOptions(state, settings)));
        break;
      case 'About': showAbout(ctx.window); break;
      case 'Exit': ctx.close(); break;
      default: // Help files are not available.
    }
  }

  render();

  return {
    unmount() {
      clearInterval(timer);
      stopWinEffect();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      menu.destroy();
      sol.remove();
    },
  };
}
