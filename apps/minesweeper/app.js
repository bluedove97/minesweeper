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
import { createMenuBar } from '../../shared/js/menu.js';

const A = name => new URL(`./assets/${name}.png`, import.meta.url).href;
const numberImgs = ['empty', 'open1', 'open2', 'open3', 'open4', 'open5', 'open6', 'open7', 'open8'];

const MENUS = [
  {
    label: 'Game',
    items: [
      { id: 'New', text: 'New', hotKey: 'F2' },
      '-',
      { id: 'Beginner', text: 'Beginner' },
      { id: 'Intermediate', text: 'Intermediate' },
      { id: 'Expert', text: 'Expert' },
      { id: 'Custom...', text: 'Custom...' },
      '-',
      { id: 'Marks (?)', text: 'Marks (?)', checked: true },
      { id: 'Color', text: 'Color', checked: true },
      { id: 'Sound', text: 'Sound' },
      '-',
      { id: 'Best Times...', text: 'Best Times...' },
      '-',
      { id: 'Exit', text: 'Exit' },
    ],
  },
  {
    label: 'Help',
    items: [
      { id: 'Contents', text: 'Contents', hotKey: 'F1' },
      { id: 'Search for Help on...', text: 'Search for Help on...' },
      { id: 'Using Help', text: 'Using Help' },
      '-',
      { id: 'About Minesweeper', text: 'About Minesweeper' },
    ],
  },
];
const DIFFICULTIES = ['Beginner', 'Intermediate', 'Expert'];

export function mount(root, ctx) {
  const menu = createMenuBar(MENUS, onMenu);
  const mine = document.createElement('div');
  mine.className = 'mine';
  mine.innerHTML = `
    <section class="mine__content">
      <div class="mine__score-bar">
        <div class="mine__digits__outer" data-id="mines"></div>
        <div class="mine__face__outer">
          <button class="mine__face">
            <img alt="smile" src="${A('smile')}">
            <img alt="smile" src="${A('smile')}">
          </button>
        </div>
        <div class="mine__digits__outer" data-id="time"></div>
      </div>
      <div class="mine__content__inner"></div>
    </section>`;
  mine.prepend(menu.el);
  root.appendChild(mine);

  const $ = sel => mine.querySelector(sel);
  const content = $('.mine__content');
  const grid = $('.mine__content__inner');
  const faceBtn = $('.mine__face');
  const faceImg = $('.mine__face img:first-child');
  const mineDigits = $('[data-id="mines"]');
  const timeDigits = $('[data-id="time"]');

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
    DIFFICULTIES.forEach(d => menu.setChecked(d, d === state.difficulty));
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

  const onWindowMouseUp = () => {
    setOpenBehavior({ index: -1, behavior: '' });
    setMouseDownContent(false);
  };
  window.addEventListener('mouseup', onWindowMouseUp);

  faceBtn.addEventListener('click', () => reset());

  // ---------- menu bar ----------

  function onMenu(item) {
    switch (item) {
      case 'Exit': ctx.close(); break;
      case 'Beginner':
      case 'Intermediate':
      case 'Expert': reset(item); break;
      case 'New': reset(); break;
      default:
    }
  }

  onStatusChange(state.status);
  render();

  return {
    unmount() {
      clearInterval(timer);
      window.removeEventListener('mouseup', onWindowMouseUp);
      menu.destroy();
      mine.remove();
    },
  };
}
