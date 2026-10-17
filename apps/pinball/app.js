// 3D Pinball for Windows - Space Cadet, running the ported engine in an XP
// window. Game data comes from the user's own PINBALL.DAT (apps/pinball/data/).

import { createMenuBar } from '../../shared/js/menu.js';
import { loadRecords, rgba } from './engine/dat.js';
import { loader } from './engine/loader.js';
import { findMessageFont } from './engine/pe.js';
import { render } from './engine/render.js';
import { pb } from './engine/pb.js';
import { control } from './engine/control.js';
import { textFallback } from './engine/components.js';
import { showHighScores, showControls, showAbout } from './dialogs.js';

const dataUrl = name => new URL(`./data/${name}`, import.meta.url).href;
const ICON = new URL('./assets/pinball-icon.png', import.meta.url).href;
const WIDTH = 600;
const HEIGHT = 416;
const UPDATE_MS = 1000 / 120; // options::DefUps

const OPTIONS_KEY = 'pinball.options';
const SCORES_KEY = 'pinball.highscores';

const DEFAULT_BINDINGS = {
  LeftFlipper: [{ type: 'key', code: 'KeyZ' }, { type: 'mouse', button: 0 }],
  RightFlipper: [{ type: 'key', code: 'Slash' }, { type: 'mouse', button: 2 }],
  Plunger: [{ type: 'key', code: 'Space' }, { type: 'mouse', button: 1 }],
  LeftTableBump: [{ type: 'key', code: 'KeyX' }, null],
  RightTableBump: [{ type: 'key', code: 'Period' }, null],
  BottomTableBump: [{ type: 'key', code: 'ArrowUp' }, null],
};

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not persisted.
  }
}

function loadOptions() {
  const saved = readJson(OPTIONS_KEY) || {};
  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (saved.bindings) {
    for (const id of Object.keys(bindings)) {
      if (Array.isArray(saved.bindings[id])) bindings[id] = [saved.bindings[id][0] ?? null, saved.bindings[id][1] ?? null];
    }
  }
  const players = Number(saved.players);
  return { players: players >= 1 && players <= 4 ? players : 1, bindings };
}

// ---------- game data ----------

class MissingData extends Error {}

let dataCache = null;

async function fetchOptional(name) {
  try {
    const res = await fetch(dataUrl(name));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// WAV clip lengths drive some game timers (e.g. how long a hole holds the ball).
function wavDuration(bytes) {
  if (!bytes || bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  const samples = dataSize / (channels * (bits / 8));
  return Number.isFinite(samples / sampleRate) ? samples / sampleRate : 0;
}

// Windows file names are case-insensitive; a web server may not be.
async function fetchAnyCase(name) {
  // Lower case first: the usual spelling of the copied files.
  for (const candidate of new Set([name.toLowerCase(), name, name.toUpperCase()])) {
    const bytes = await fetchOptional(candidate);
    if (bytes) return bytes;
  }
  return null;
}

async function loadData() {
  if (dataCache) return dataCache;
  const dat = await fetchAnyCase('PINBALL.DAT');
  if (!dat) throw new MissingData();
  // The message font is the PBMSG_FT resource of pinball.exe.
  const exe = await fetchAnyCase('PINBALL.EXE');
  const font = exe ? findMessageFont(exe) : null;

  const probe = loadRecords(dat.buffer.slice(0), null);
  if (!probe) throw new Error('PINBALL.DAT is not a 3D Pinball data file.');
  const names = [...new Set(loader.soundFileNames(probe))];
  const durations = new Map();
  if (names.length && (await fetchAnyCase(names[0]))) {
    const clips = await Promise.all(names.map(fetchAnyCase));
    names.forEach((name, i) => durations.set(name, wavDuration(clips[i])));
  }
  dataCache = { dat, font, durations };
  return dataCache;
}

// ---------- app ----------

export function mount(root, ctx) {
  const options = loadOptions();
  const menu = createMenuBar([
    {
      label: 'Game',
      items: [
        { id: 'NewGame', text: 'New Game', hotKey: 'F2' },
        { id: 'LaunchBall', text: 'Launch Ball' },
        { id: 'Pause', text: 'Pause/Resume Game', hotKey: 'F3' },
        '-',
        { id: 'HighScores', text: 'High Scores...' },
        { id: 'Demo', text: 'Demo' },
        { id: 'Exit', text: 'Exit' },
      ],
    },
    {
      label: 'Options',
      items: [
        {
          id: 'Players',
          text: 'Select Players',
          items: [1, 2, 3, 4].map(n => ({ id: `Players${n}`, text: n === 1 ? '1 Player' : `${n} Players` })),
        },
        '-',
        { id: 'Controls', text: 'Player Controls...', hotKey: 'F8' },
      ],
    },
    {
      label: 'Help',
      items: [{ id: 'About', text: 'About 3D Pinball' }],
    },
  ], onMenu);

  const el = document.createElement('div');
  el.className = 'pinball';
  el.innerHTML = `
    <div class="pinball__screen">
      <canvas width="${WIDTH}" height="${HEIGHT}"></canvas>
      <div class="pinball__touch-zones"></div>
      <div class="pinball__message">Loading...</div>
    </div>`;
  el.prepend(menu.el);
  root.appendChild(el);

  const canvas = el.querySelector('canvas');
  const message = el.querySelector('.pinball__message');
  const zoneLayer = el.querySelector('.pinball__touch-zones');
  const g = canvas.getContext('2d');
  const image = g.createImageData(WIDTH, HEIGHT);
  const pixels = new Uint32Array(image.data.buffer);
  const BLACK = rgba(0, 0, 0);

  let started = false;
  let disposed = false;
  let frame = 0;
  let last = 0;
  let acc = 0;
  let noTimeLoss = true;
  const menuState = {};

  // ---------- engine host ----------

  pb.host = {
    players: () => options.players,
    loadHighScores: () => readJson(SCORES_KEY),
    saveHighScores: table => writeJson(SCORES_KEY, table),
    showHighScores: table => showHighScores(ctx.window, table, null),
    showHighScoreEntry: (table, value, position, name, done) => showHighScores(ctx.window, table, { score: value, position, name }, done),
  };

  // gdrv::grtext_draw_ttext_in_box: plain white text when there is no bitmap font.
  textFallback.draw = (text, x, y, w, h) => {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    c.font = '11px Tahoma, Arial, sans-serif';
    c.fillStyle = '#fff';
    c.textBaseline = 'top';
    let lineY = 0;
    for (const paragraph of text.split('\n')) {
      let lineText = '';
      for (const word of paragraph.split(' ')) {
        const candidate = lineText ? `${lineText} ${word}` : word;
        if (lineText && c.measureText(candidate).width > w) {
          c.fillText(lineText, 0, lineY);
          lineY += 13;
          lineText = word;
        } else {
          lineText = candidate;
        }
      }
      c.fillText(lineText, 0, lineY);
      lineY += 13;
    }
    const data = c.getImageData(0, 0, w, h).data;
    const dst = render.vscreen.BmpBufPtr1;
    const white = rgba(255, 255, 255);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (data[(row * w + col) * 4 + 3] >= 128) dst[(y + row) * render.vscreen.Stride + x + col] = white;
      }
    }
  };

  async function start() {
    let data;
    try {
      data = await loadData();
    } catch (err) {
      if (disposed) return;
      message.innerHTML = err instanceof MissingData
        ? '<div><b>PINBALL.DAT not found.</b><br>Copy PINBALL.DAT from Windows XP<br>(Program Files\\Windows NT\\Pinball)<br>into apps/pinball/data/ and reopen.</div>'
        : `<div><b>Could not load the table.</b><br>${String(err.message)}</div>`;
      return;
    }
    if (disposed) return;
    const datFile = loadRecords(data.dat.buffer.slice(0), data.font);
    loader.setSoundDurations(data.durations);
    control.reset();
    pb.init(datFile);
    pb.reset_table();
    pb.firsttime_setup();
    pb.replay_level(0);
    buildTouchZones();
    message.hidden = true;
    started = true;
    present();
    last = performance.now();
    frame = requestAnimationFrame(loop);
  }

  // ---------- frame loop (winmain::WinMain) ----------

  function running() {
    return started && ctx.window.isActive();
  }

  function loop(now) {
    frame = requestAnimationFrame(loop);
    let dt = now - last;
    last = now;
    if (!running()) {
      noTimeLoss = true;
      return;
    }
    if (noTimeLoss) {
      dt = 0;
      acc = 0;
      noTimeLoss = false;
    }
    if (!pb.single_step) {
      acc += Math.min(dt, 250);
      let steps = 0;
      while (acc >= UPDATE_MS && steps < 10) {
        pb.frame(UPDATE_MS);
        acc -= UPDATE_MS;
        steps++;
      }
      if (steps === 10) acc = 0;
    }
    present();
    syncMenu();
  }

  // render::PresentVScreen: the board shifts when the table is nudged, the
  // score panel does not.
  function present() {
    const src = render.vscreen.BmpBufPtr1;
    const ox = render.offset_x;
    const oy = render.offset_y;
    if (ox === 0 && oy === 0) {
      for (let i = 0; i < src.length; i++) pixels[i] = src[i] || BLACK;
    } else {
      pixels.fill(BLACK);
      const boardWidth = pb.MainTable.Width;
      for (let y = 0; y < HEIGHT; y++) {
        const row = y * WIDTH;
        for (let x = boardWidth; x < WIDTH; x++) pixels[row + x] = src[row + x] || BLACK;
        const dy = y + oy;
        if (dy < 0 || dy >= HEIGHT) continue;
        for (let x = 0; x < boardWidth; x++) {
          const dx = x + ox;
          if (dx >= 0 && dx < boardWidth) pixels[dy * WIDTH + dx] = src[row + x] || BLACK;
        }
      }
    }
    g.putImageData(image, 0, 0);
  }

  function setMenu(id, key, value) {
    if (menuState[id + key] === value) return;
    menuState[id + key] = value;
    if (key === 'checked') menu.setChecked(id, value);
    else menu.setDisabled(id, value);
  }

  function syncMenu() {
    setMenu('LaunchBall', 'disabled', !pb.LaunchBallEnabled);
    setMenu('HighScores', 'disabled', !pb.HighScoresEnabled);
    setMenu('Demo', 'checked', pb.DemoActive);
    for (let n = 1; n <= 4; n++) setMenu(`Players${n}`, 'checked', options.players === n);
  }
  syncMenu();

  // ---------- commands (winmain) ----------

  function endPause() {
    if (pb.single_step) {
      pb.pause_continue();
      noTimeLoss = true;
    }
  }

  function pause() {
    pb.pause_continue();
    noTimeLoss = true;
  }

  function newGame() {
    endPause();
    pb.replay_level(0);
  }

  function saveOptions() {
    writeJson(OPTIONS_KEY, { players: options.players, bindings: options.bindings });
  }

  function onMenu(item) {
    if (item === 'Exit') {
      ctx.close();
      return;
    }
    if (item === 'About') {
      showAbout(ctx.window, ICON);
      return;
    }
    if (!started) return;
    switch (item) {
      case 'NewGame':
        newGame();
        break;
      case 'LaunchBall':
        endPause();
        pb.launch_ball();
        break;
      case 'Pause':
        pause();
        break;
      case 'HighScores':
        pb.high_scores();
        break;
      case 'Demo':
        endPause();
        pb.toggle_demo();
        break;
      case 'Controls':
        openControls();
        break;
      default:
        if (item.startsWith('Players')) {
          options.players = Number(item.slice(7));
          saveOptions();
          newGame();
        }
    }
    syncMenu();
  }

  function openControls() {
    showControls(ctx.window, options.bindings, DEFAULT_BINDINGS, bindings => {
      options.bindings = bindings;
      saveOptions();
    });
  }

  // ---------- input (winmain::event_handler, pb::InputDown/InputUp) ----------

  function matching(test) {
    const input = {};
    let any = false;
    for (const [id, slots] of Object.entries(options.bindings)) {
      if (slots.some(b => b && test(b))) {
        input[id] = true;
        any = true;
      }
    }
    return any ? input : null;
  }

  const onKeyDown = e => {
    if (!started || !ctx.window.isActive()) return;
    const input = matching(b => b.type === 'key' && b.code === e.code);
    if (!e.repeat) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : '';
      pb.InputDown(input || {}, key);
    }
    switch (e.code) {
      case 'Escape':
        ctx.window.hide(); // The original minimizes on Esc.
        break;
      case 'F2':
        newGame();
        break;
      case 'F3':
        pause();
        break;
      case 'F8':
        openControls();
        break;
      default:
        if (!input) return;
    }
    e.preventDefault();
  };

  const onKeyUp = e => {
    if (!started) return;
    const input = matching(b => b.type === 'key' && b.code === e.code);
    if (input) {
      pb.InputUp(input);
      e.preventDefault();
    }
  };

  const onMouseDown = e => {
    if (!started || !ctx.window.isActive()) return;
    e.preventDefault();
    pb.InputDown(matching(b => b.type === 'mouse' && b.button === e.button) || {}, '');
  };

  const onMouseUp = e => {
    if (!started) return;
    const input = matching(b => b.type === 'mouse' && b.button === e.button);
    if (input) pb.InputUp(input);
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ---------- touch controls ----------
  // Rectangles in canvas pixels, built from the flipper and plunger sprites
  // once the table has loaded: the lower table left of the gap between the
  // flippers works the left flipper, from the gap to the plunger lane the
  // right flipper, and the plunger lane pulls the plunger back while held and
  // launches on release, so a longer press launches harder (like holding Space).
  // Each finger is tracked separately, so both flippers can be held at once.

  const FLIPPER_ZONE_ABOVE = 60;
  const PLUNGER_ZONE_ABOVE = 80;
  let zones = [];
  const touches = new Map(); // pointerId -> input id

  function buildTouchZones() {
    const table = pb.MainTable;
    const left = table.FlipperL.RenderSprite.BoundingRect;
    const right = table.FlipperR.RenderSprite.BoundingRect;
    const plunger = table.Plunger.RenderSprite.BoundingRect;
    const flipperTop = Math.min(left.YPosition, right.YPosition) - FLIPPER_ZONE_ABOVE;
    const gap = Math.round((left.XPosition + left.Width + right.XPosition) / 2);
    const lane = plunger.XPosition - 8;
    const plungerTop = plunger.YPosition - PLUNGER_ZONE_ABOVE;
    zones = [
      { id: 'LeftFlipper', x: 0, y: flipperTop, w: gap, h: HEIGHT - flipperTop },
      { id: 'RightFlipper', x: gap, y: flipperTop, w: lane - gap, h: HEIGHT - flipperTop },
      { id: 'Plunger', x: lane, y: plungerTop, w: table.Width - lane, h: HEIGHT - plungerTop },
    ];
    zoneLayer.innerHTML = zones
      .map(z => `<div class="pinball__touch-zone" style="left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px"></div>`)
      .join('');
  }

  function zoneAt(e) {
    const box = canvas.getBoundingClientRect();
    const x = ((e.clientX - box.left) * WIDTH) / box.width;
    const y = ((e.clientY - box.top) * HEIGHT) / box.height;
    return zones.find(z => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h);
  }

  const held = id => [...touches.values()].includes(id);

  const onTouchDown = e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault(); // no emulated mousedown, which would work the left flipper
    if (!started || !ctx.window.isActive()) return;
    const zone = zoneAt(e);
    // Like a mouse press, a touch anywhere also ends the game-over countdown.
    if (!zone) {
      pb.InputDown({}, '');
      return;
    }
    const wasHeld = held(zone.id);
    touches.set(e.pointerId, zone.id);
    if (!wasHeld) pb.InputDown({ [zone.id]: true }, '');
  };

  const onTouchUp = e => {
    const id = touches.get(e.pointerId);
    if (!id) return;
    touches.delete(e.pointerId);
    if (started && !held(id)) pb.InputUp({ [id]: true });
  };

  canvas.addEventListener('pointerdown', onTouchDown);
  window.addEventListener('pointerup', onTouchUp);
  window.addEventListener('pointercancel', onTouchUp);

  // Losing focus releases the flippers and plunger and stops the clock.
  const offActive = ctx.window.onActiveChange(isActive => {
    if (!started) return;
    if (isActive) noTimeLoss = true;
    else {
      touches.clear();
      pb.loose_focus();
    }
  });

  start();

  return {
    unmount() {
      disposed = true;
      cancelAnimationFrame(frame);
      offActive();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onTouchDown);
      window.removeEventListener('pointerup', onTouchUp);
      window.removeEventListener('pointercancel', onTouchUp);
      menu.destroy();
      if (started) pb.uninit();
      control.reset();
      textFallback.draw = null;
      pb.host = null;
      el.remove();
    },
  };
}
