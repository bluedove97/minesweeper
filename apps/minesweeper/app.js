import {
  getInitState,
  getNearIndexes,
  openCeil,
  openCeils,
  changeCeilState,
  setOpening,
  remainMines,
  digitString,
} from './game.js';

const A = name => `assets/${name}.png`;
const numberImgs = ['empty', 'open1', 'open2', 'open3', 'open4', 'open5', 'open6', 'open7', 'open8'];

const $ = sel => document.querySelector(sel);
const win = $('.window');
const content = $('.mine__content');
const grid = $('.mine__content__inner');
const faceBtn = $('.mine__face');
const faceImg = $('.mine__face img:first-child');
const mineDigits = $('#mine-digits');
const timeDigits = $('#time-digits');
const desktopIcon = $('.desktop-icon');

let state = getInitState('Beginner');
let rendered = []; // last rendered ceil objects, for cheap diffing
let mouseDownContent = false;
let openBehavior = { index: -1, behavior: '' };
let seconds = 0;
let timer = null;
let lastStatus = null;

// ---------- state / effects ----------

function setState(next) {
  if (next === state) return;
  state = next;
  if (state.status !== lastStatus) onStatusChange(state.status);
  render();
}

function onStatusChange(status) {
  lastStatus = status;
  clearInterval(timer);
  timer = null;
  if (status === 'started') {
    timer = setInterval(() => {
      seconds += 1;
      renderDigits(timeDigits, seconds);
    }, 1000);
  } else if (status === 'new') {
    seconds = 0;
  }
}

function setOpenBehavior(next) {
  const changed = next.index !== openBehavior.index || next.behavior !== openBehavior.behavior;
  openBehavior = next;
  if (!changed) return;
  const { index, behavior } = next;
  if (behavior === 'single') {
    setState(setOpening(state, [index]));
  } else if (behavior === 'multi') {
    setState(setOpening(state, [index, ...getNearIndexes(index, state.rows, state.columns)]));
  } else {
    setState(setOpening(state, []));
  }
}

function setMouseDownContent(value) {
  mouseDownContent = value;
  renderFace();
}

function reset(difficulty) {
  setState(getInitState(difficulty || state.difficulty));
}

// ---------- rendering ----------

function ceilHTML({ state: s, minesAround, opening }) {
  const cover = '<div class="ceil-bg cover"></div>';
  const open = '<div class="ceil-bg open"></div>';
  const img = name => `<img alt="${name}" src="${A(name)}">`;
  switch (s) {
    case 'open': return open + img(numberImgs[minesAround]);
    case 'flag': return cover + img('flag');
    case 'misflagged': return open + img('misflagged');
    case 'mine': return open + img('mine-ceil');
    case 'die': return open + img('mine-death');
    case 'unknown': return (opening ? open : cover) + img('question');
    default: return opening ? open : cover;
  }
}

function buildGrid() {
  grid.style.gridTemplateColumns = `repeat(${state.columns}, 16px)`;
  grid.style.gridTemplateRows = `repeat(${state.rows}, 16px)`;
  grid.innerHTML = '';
  state.ceils.forEach(() => {
    const el = document.createElement('div');
    el.className = 'mine__ceil';
    grid.appendChild(el);
  });
  rendered = [];
}

function renderDigits(el, number) {
  el.innerHTML = digitString(number)
    .split('')
    .map(d => `<img alt="${d}" src="${A('digit' + d)}">`)
    .join('');
}

function renderFace() {
  let face = 'smile';
  if (mouseDownContent) face = 'ohh';
  else if (state.status === 'died') face = 'dead';
  else if (state.status === 'won') face = 'win';
  faceImg.src = A(face);
  faceImg.alt = face;
}

function renderMenuChecks() {
  document.querySelectorAll('[data-difficulty]').forEach(row => {
    row.classList.toggle('checked', row.dataset.difficulty === state.difficulty);
  });
}

function render() {
  if (grid.children.length !== state.ceils.length) buildGrid();
  const cells = grid.children;
  state.ceils.forEach((ceil, i) => {
    if (rendered[i] !== ceil) cells[i].innerHTML = ceilHTML(ceil);
  });
  rendered = state.ceils;
  renderDigits(mineDigits, remainMines(state));
  renderDigits(timeDigits, seconds);
  renderFace();
  renderMenuChecks();
}

// ---------- mouse handling (same rules as MinesweeperView) ----------

function ceilIndex(e) {
  return Array.prototype.indexOf.call(grid.children, e.target.closest('.mine__ceil'));
}

content.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (faceBtn.contains(e.target) || state.status === 'won' || state.status === 'died') return;
  setMouseDownContent(true);
});

grid.addEventListener('mousedown', e => {
  const index = ceilIndex(e);
  if (e.button === 2 && e.buttons === 2 && index !== -1) {
    setState(changeCeilState(state, index));
  } else if (e.button === 0 && e.buttons === 1) {
    setOpenBehavior({ index, behavior: 'single' });
  } else if (e.buttons === 3) {
    setOpenBehavior({ index, behavior: 'multi' });
  }
});

grid.addEventListener('mouseover', e => {
  setOpenBehavior({ index: ceilIndex(e), behavior: openBehavior.behavior });
});

grid.addEventListener('mouseup', () => {
  const { behavior, index } = openBehavior;
  if (index === -1) return;
  if (behavior === 'single') setState(openCeil(state, index));
  else if (behavior === 'multi') setState(openCeils(state, index));
});

window.addEventListener('mouseup', () => {
  setOpenBehavior({ index: -1, behavior: '' });
  setMouseDownContent(false);
});

faceBtn.addEventListener('click', () => reset());

win.addEventListener('contextmenu', e => e.preventDefault());

// ---------- menu bar ----------

const menuBar = $('.mine__options');
let openMenu = '';

function setOpenMenu(name) {
  openMenu = name;
  menuBar.querySelectorAll('.drop-down').forEach(dd => {
    dd.classList.toggle('open', dd.dataset.menu === name);
  });
}

menuBar.querySelectorAll('.drop-down').forEach(dd => {
  const label = dd.querySelector('.drop-down__label');
  label.addEventListener('mousedown', () => setOpenMenu(dd.dataset.menu));
  label.addEventListener('mouseenter', () => {
    if (openMenu) setOpenMenu(dd.dataset.menu);
  });
});

menuBar.addEventListener('click', e => {
  const row = e.target.closest('.drop-down__row');
  if (!row) return;
  setOpenMenu('');
  switch (row.dataset.item) {
    case 'Exit': closeWindow(); break;
    case 'Beginner':
    case 'Intermediate':
    case 'Expert': reset(row.dataset.item); break;
    case 'New': reset(); break;
    default:
  }
});

window.addEventListener('mouseup', e => {
  if (!menuBar.contains(e.target)) setOpenMenu('');
});

// ---------- window chrome ----------

function closeWindow() {
  win.hidden = true;
  setState(getInitState('Beginner')); // reopening starts a fresh instance, as in winXP
}

function minimizeWindow() {
  win.hidden = true;
}

$('.title-bar__close').addEventListener('click', closeWindow);
$('.title-bar__min').addEventListener('click', minimizeWindow);
desktopIcon.addEventListener('dblclick', () => { win.hidden = false; });

// Drag by title bar.
const titleBar = $('.title-bar');
titleBar.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  const startX = e.clientX - win.offsetLeft;
  const startY = e.clientY - win.offsetTop;
  const move = ev => {
    win.style.left = `${ev.clientX - startX}px`;
    win.style.top = `${Math.max(0, ev.clientY - startY)}px`;
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

onStatusChange(state.status);
render();
