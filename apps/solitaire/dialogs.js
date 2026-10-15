// Options, Select Card Back, Deal Again and About dialogs. Control positions
// follow the original designer files (client coordinates in pixels).

import { openDialog } from '../../shared/js/window.js';

const asset = name => new URL(`./assets/${name}.png`, import.meta.url).href;

function dialogBody(width, height, html) {
  const el = document.createElement('div');
  el.className = 'dialog sol-dialog';
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.innerHTML = html;
  return el;
}

function show(owner, title, content, { onOk, onCancel }) {
  const dialog = openDialog(owner, {
    title,
    content,
    onEnter: () => { dialog.close(); onOk(); },
    onCancel: () => { dialog.close(); onCancel?.(); },
  });
  content.querySelector('[data-ok]')?.addEventListener('click', () => { dialog.close(); onOk(); });
  content.querySelector('[data-cancel]')?.addEventListener('click', () => { dialog.close(); onCancel?.(); });
  return dialog;
}

// onOk receives the new settings.
export function showOptions(owner, settings, onOk) {
  const vegas = settings.scoring === 'Vegas' || settings.scoring === 'VegasCumulative';
  const content = dialogBody(260, 224, `
    <fieldset style="left:6px;top:14px;width:127px;height:71px">
      <legend>Draw</legend>
      <label><input type="radio" name="draw" value="one"> Draw One</label>
      <label><input type="radio" name="draw" value="three"> Draw Three</label>
    </fieldset>
    <fieldset style="left:140px;top:14px;width:115px;height:96px">
      <legend>Scoring</legend>
      <label><input type="radio" name="scoring" value="Standard"> Standard</label>
      <label><input type="radio" name="scoring" value="Vegas"> Vegas</label>
      <label><input type="radio" name="scoring" value="None"> None</label>
    </fieldset>
    <label style="left:15px;top:93px"><input type="checkbox" name="timed"> Timed game</label>
    <label style="left:15px;top:120px"><input type="checkbox" name="statusBar"> Status bar</label>
    <label style="left:15px;top:144px"><input type="checkbox" name="outline"> Outline dragging</label>
    <label style="left:140px;top:122px" data-cumulative><input type="checkbox" name="cumulative"> Cumulative Score</label>
    <button class="xp-button" data-ok autofocus style="left:63px;top:181px;width:67px;height:30px">OK</button>
    <button class="xp-button" data-cancel style="left:140px;top:181px;width:72px;height:30px">Cancel</button>`);

  const input = name => content.querySelector(`[name="${name}"]`);
  const radio = (name, value) => content.querySelector(`[name="${name}"][value="${value}"]`);
  radio('draw', settings.drawOne ? 'one' : 'three').checked = true;
  radio('scoring', vegas ? 'Vegas' : settings.scoring).checked = true;
  input('timed').checked = settings.timed;
  input('statusBar').checked = settings.statusBar;
  input('outline').checked = settings.outline;
  input('cumulative').checked = settings.scoring === 'VegasCumulative';

  // Cumulative Score only applies to Vegas scoring.
  const cumulativeLabel = content.querySelector('[data-cumulative]');
  const syncCumulative = () => {
    const enabled = radio('scoring', 'Vegas').checked;
    input('cumulative').disabled = !enabled;
    cumulativeLabel.classList.toggle('disabled', !enabled);
  };
  content.querySelectorAll('[name="scoring"]').forEach(r => r.addEventListener('change', syncCumulative));
  syncCumulative();

  show(owner, 'Options', content, {
    onOk: () => {
      let scoring = content.querySelector('[name="scoring"]:checked').value;
      if (scoring === 'Vegas' && input('cumulative').checked) scoring = 'VegasCumulative';
      onOk({
        ...settings,
        drawOne: radio('draw', 'one').checked,
        scoring,
        timed: input('timed').checked,
        statusBar: input('statusBar').checked,
        outline: input('outline').checked,
      });
    },
  });
}

// Button grid from CardBackDialog: backs 0-5 on the top row, 6-11 below.
const BACK_X = [18, 66, 114, 162, 210, 258];

// onOk receives the chosen card back index.
export function showCardBacks(owner, cardBack, onOk) {
  const buttons = Array.from({ length: 12 }, (_, i) => {
    const x = BACK_X[i % 6];
    const y = i < 6 ? 14 : 92;
    return `<button class="sol-dialog__back" data-back="${i}" style="left:${x}px;top:${y}px">`
      + `<img src="${asset(`CardBack_${i}`)}" alt="Card back ${i + 1}"></button>`;
  }).join('');
  const content = dialogBody(314, 224, `${buttons}
    <button class="xp-button" data-ok style="left:75px;top:181px;width:77px;height:29px">OK</button>
    <button class="xp-button" data-cancel style="left:171px;top:181px;width:77px;height:29px">Cancel</button>`);

  let selected = cardBack;
  const select = i => {
    selected = i;
    content.querySelectorAll('[data-back]').forEach(b => b.classList.toggle('selected', Number(b.dataset.back) === i));
  };
  content.querySelectorAll('[data-back]').forEach(b => {
    b.addEventListener('click', () => select(Number(b.dataset.back)));
    b.addEventListener('dblclick', () => content.querySelector('[data-ok]').click());
  });
  select(cardBack);
  show(owner, 'Select Card Back', content, { onOk: () => onOk(selected) });
}

export function showDealAgain(owner, onYes) {
  const content = dialogBody(214, 121, `
    <img src="${asset('sol-icon')}" alt="" style="left:32px;top:15px;width:34px;height:35px">
    <span style="left:77px;top:27px">Deal Again?</span>
    <button class="xp-button" data-ok autofocus style="left:16px;top:76px;width:86px;height:29px">Yes</button>
    <button class="xp-button" data-cancel style="left:112px;top:76px;width:86px;height:29px">No</button>`);
  show(owner, "'Classic' Solitaire", content, { onOk: onYes });
}

// Stands in for the Windows ShellAbout box the original opens.
export function showAbout(owner) {
  const content = dialogBody(320, 130, `
    <img src="${asset('sol-icon')}" alt="" style="left:16px;top:16px;width:32px;height:32px">
    <span style="left:64px;top:16px;font-weight:bold">'Classic' Solitaire</span>
    <span style="left:64px;top:38px;width:240px;white-space:normal">Developed by Cory Smith; portions by Christine Morin and Chris Sells.</span>
    <button class="xp-button" data-ok autofocus style="left:124px;top:90px;width:72px;height:23px">OK</button>`);
  show(owner, "About 'Classic' Solitaire", content, { onOk: () => {} });
}
