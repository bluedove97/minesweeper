// High Scores, Player Controls and About dialogs (high_score.cpp,
// options.cpp and winmain.cpp in the decompilation; drawn as XP dialogs).

import { openDialog } from '../../shared/js/window.js';
import { get_rc_string } from './engine/strings.js';
import { score, high_score } from './engine/pb.js';

const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function body(className, html) {
  const el = document.createElement('div');
  el.className = `dialog pinball-dialog ${className}`;
  el.innerHTML = html;
  return el;
}

function confirm(owner, title, text, onOk) {
  const content = body('pinball-dialog--confirm', `
    <p>${esc(text)}</p>
    <div class="dialog__buttons">
      <button class="xp-button" data-ok autofocus>OK</button>
      <button class="xp-button" data-cancel>Cancel</button>
    </div>`);
  const dlg = openDialog(owner, {
    title,
    content,
    onEnter: () => { dlg.close(); onOk(); },
    onCancel: () => dlg.close(),
  });
  content.querySelector('[data-ok]').addEventListener('click', () => { dlg.close(); onOk(); });
  content.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
}

// entry: { score, position, name } when a new score is being entered.
export function showHighScores(owner, table, entry, done = () => {}) {
  const rows = () => {
    let html = '';
    for (let offset = 0, row = 0; row < 5; row++) {
      const current = table[row + offset];
      let name = esc(current.Name);
      let value = current.Score;
      if (entry && entry.position === row) {
        offset = -1;
        value = entry.score;
        name = `<input type="text" maxlength="31" value="${esc(entry.name)}" autofocus>`;
      }
      html += `<tr><td>${row + 1}</td><td>${name}</td><td>${esc(score.string_format(value))}</td></tr>`;
    }
    return html;
  };
  const content = body('pinball-dialog--scores', `
    <table>
      <thead><tr><th>Rank</th><th>Name</th><th>Score</th></tr></thead>
      <tbody>${rows()}</tbody>
    </table>
    <div class="dialog__buttons">
      <button class="xp-button" data-ok>OK</button>
      <button class="xp-button" data-cancel>Cancel</button>
      <button class="xp-button" data-clear>Clear</button>
    </div>`);

  const finish = ok => {
    if (ok && entry) {
      const input = content.querySelector('input');
      high_score.place_new_score_into(table, entry.score, input ? input.value : entry.name, entry.position);
      high_score.write(table);
    }
    dlg.close();
    done();
  };
  const dlg = openDialog(owner, {
    title: 'High Scores',
    content,
    onEnter: () => finish(true),
    onCancel: () => finish(false),
  });
  content.querySelector('[data-ok]').addEventListener('click', () => finish(true));
  content.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
  content.querySelector('[data-clear]').addEventListener('click', () => {
    confirm(dlg.dialog, get_rc_string(41), get_rc_string(40), () => {
      high_score.clear_table(table);
      high_score.write(table);
      content.querySelector('tbody').innerHTML = rows();
    });
  });
  if (!entry) content.querySelector('[data-ok]').focus();
}

const CONTROLS = [
  ['LeftFlipper', 'Left Flipper'],
  ['RightFlipper', 'Right Flipper'],
  ['LeftTableBump', 'Left Table Bump'],
  ['RightTableBump', 'Right Table Bump'],
  ['BottomTableBump', 'Bottom Table Bump'],
  ['Plunger', 'Plunger'],
];
const MOUSE_NAMES = ['Mouse Left', 'Mouse Middle', 'Mouse Right', 'Mouse X1', 'Mouse X2'];

export function bindingName(binding) {
  if (!binding) return 'Unused';
  if (binding.type === 'mouse') return MOUSE_NAMES[binding.button] ?? `Mouse ${binding.button + 1}`;
  const code = binding.code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Slash: '/', Period: '.', Comma: ',', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[code] ?? code;
}

// bindings: { LeftFlipper: [binding, binding], ... }; onOk receives the new bindings.
export function showControls(owner, bindings, defaults, onOk) {
  let working = structuredClone(bindings);
  let waiting = null; // [control, slot]

  const content = body('pinball-dialog--controls', `
    <fieldset>
      <legend>Instructions</legend>
      <p>To change game controls, click the control button, press the new key, and then choose OK.</p>
      <p>To restore 3D Pinball to its original settings, choose Default, and then choose OK.</p>
    </fieldset>
    <fieldset>
      <legend>Control Options</legend>
      <table><tbody></tbody></table>
    </fieldset>
    <div class="dialog__buttons">
      <button class="xp-button" data-ok>OK</button>
      <button class="xp-button" data-cancel>Cancel</button>
      <button class="xp-button" data-default>Default</button>
    </div>`);
  const tbody = content.querySelector('tbody');

  const render = () => {
    tbody.innerHTML = CONTROLS.map(([id, label]) => `
      <tr>
        <td><button class="xp-button pinball-dialog__clear" data-clear="${id}" title="Clear">${label}</button></td>
        ${[0, 1].map(slot => {
          const isWaiting = waiting && waiting[0] === id && waiting[1] === slot;
          return `<td><button class="xp-button pinball-dialog__binding" data-bind="${id}" data-slot="${slot}">${isWaiting ? 'Press the key' : esc(bindingName(working[id][slot]))}</button></td>`;
        }).join('')}
      </tr>`).join('');
  };
  render();

  const assign = binding => {
    const [id, slot] = waiting;
    working[id][slot] = binding;
    waiting = null;
    render();
  };

  // While waiting, the next key or mouse button becomes the binding.
  const onKey = e => {
    if (!waiting) return;
    if (/^F\d+$/.test(e.code) || e.code === 'Escape' || e.code === 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    assign({ type: 'key', code: e.code });
  };
  const onMouse = e => {
    if (!waiting) return;
    const target = e.target.closest('[data-bind]');
    // A plain left click on another binding button selects that one instead.
    if (e.button === 0 && target) return;
    e.preventDefault();
    assign({ type: 'mouse', button: e.button });
  };
  window.addEventListener('keydown', onKey, true);
  content.addEventListener('mousedown', onMouse);

  tbody.addEventListener('click', e => {
    const bind = e.target.closest('[data-bind]');
    if (bind) {
      waiting = [bind.dataset.bind, Number(bind.dataset.slot)];
      render();
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      working[clear.dataset.clear] = [null, null];
      waiting = null;
      render();
    }
  });

  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    dlg.close();
  };
  const ok = () => {
    close();
    onOk(working);
  };
  const dlg = openDialog(owner, { title: '3D Pinball: Player Controls', content, onEnter: ok, onCancel: close });
  content.querySelector('[data-ok]').addEventListener('click', ok);
  content.querySelector('[data-cancel]').addEventListener('click', close);
  content.querySelector('[data-default]').addEventListener('click', () => {
    working = structuredClone(defaults);
    waiting = null;
    render();
  });
}

export function showAbout(owner, iconUrl) {
  const lines = get_rc_string(101).split('\n').map(esc).join('<br>');
  const content = body('pinball-dialog--about', `
    <img src="${iconUrl}" alt="">
    <div>
      <p><b>${esc(get_rc_string(38))}</b></p>
      <p>${lines}</p>
      <p>JavaScript port of the SpaceCadetPinball decompilation (MIT).</p>
    </div>
    <div class="dialog__buttons"><button class="xp-button" data-ok autofocus>OK</button></div>`);
  const dlg = openDialog(owner, { title: get_rc_string(103), content, onEnter: () => dlg.close(), onCancel: () => dlg.close() });
  content.querySelector('[data-ok]').addEventListener('click', () => dlg.close());
}
