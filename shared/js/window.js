// XP-style window chrome shared by every app: title bar dragging, minimize,
// close, z-order and active-window tracking, and modal dialogs owned by a window.

let topZ = 10;
let active = null; // the active window's record
// Tracked from blur/focus events; hasFocus() can be false before the first interaction.
let pageFocused = true;

function bringToFront(el) {
  topZ += 1;
  el.style.zIndex = topZ;
}

function notify(rec) {
  for (const listener of rec.listeners) listener(rec === active && pageFocused);
}

function setActive(rec) {
  if (active === rec) return;
  const prev = active;
  active = rec;
  if (prev) {
    prev.el.classList.add('inactive');
    notify(prev);
  }
  if (rec) {
    rec.el.classList.remove('inactive');
    notify(rec);
  }
}

// Clicking the desktop (outside every window) deactivates the active window,
// and so does the page losing focus.
let globalsInstalled = false;
function installGlobals() {
  if (globalsInstalled) return;
  globalsInstalled = true;
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.window')) setActive(null);
  }, true);
  window.addEventListener('blur', () => {
    pageFocused = false;
    if (active) notify(active);
  });
  window.addEventListener('focus', () => {
    pageFocused = true;
    if (active) notify(active);
  });
}

function makeDraggable(win, handle) {
  handle.addEventListener('mousedown', e => {
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
}

// buttons: any of 'min', 'max', 'close' (max is always shown disabled, as in
// the fixed-size XP game windows).
export function createWindow({ title, icon, x = 100, y = 100, buttons = ['min', 'max', 'close'], onMinimize, onClose }) {
  installGlobals();
  const el = document.createElement('div');
  el.className = 'window';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `
    <div class="title-bar">
      ${icon ? `<img class="title-bar__icon" src="${icon}" alt="">` : ''}
      <span class="title-bar__text"></span>
      <div class="title-bar__buttons">
        ${buttons.includes('min') ? '<button class="title-bar__min" aria-label="Minimize"></button>' : ''}
        ${buttons.includes('max') ? '<button class="title-bar__max" aria-label="Maximize" disabled></button>' : ''}
        ${buttons.includes('close') ? '<button class="title-bar__close" aria-label="Close"></button>' : ''}
      </div>
    </div>
    <div class="window__body"></div>`;
  el.querySelector('.title-bar__text').textContent = title;
  const body = el.querySelector('.window__body');
  const rec = { el, listeners: new Set() };

  el.querySelector('.title-bar__min')?.addEventListener('click', () => onMinimize?.());
  el.querySelector('.title-bar__close')?.addEventListener('click', () => onClose?.());
  el.addEventListener('mousedown', e => {
    // A click on a window blocked by its dialog goes to the dialog instead.
    if (e.target.closest('.window__modal-cover')) return;
    bringToFront(el);
    setActive(rec);
  }, true);
  el.addEventListener('contextmenu', e => e.preventDefault());
  makeDraggable(el, el.querySelector('.title-bar'));

  document.body.appendChild(el);
  bringToFront(el);
  setActive(rec);

  return {
    el,
    body,
    show() {
      el.hidden = false;
      bringToFront(el);
      setActive(rec);
    },
    hide() {
      el.hidden = true;
      if (active === rec) setActive(null);
    },
    activate() {
      if (!el.hidden) setActive(rec);
    },
    isActive() {
      return active === rec && pageFocused;
    },
    // listener(isActive) runs whenever the window gains or loses focus.
    onActiveChange(listener) {
      rec.listeners.add(listener);
      return () => rec.listeners.delete(listener);
    },
    destroy() {
      if (active === rec) setActive(null);
      rec.listeners.clear();
      el.remove();
    },
  };
}

// Modal dialog centred over `owner` (a createWindow result). `content` is the
// dialog body element. Enter triggers `onEnter`, Escape and the close button
// trigger `onCancel`. Closing gives the focus back to the owner. Returns { close }.
export function openDialog(owner, { title, content, onEnter, onCancel }) {
  const cover = document.createElement('div');
  cover.className = 'window__modal-cover';
  owner.el.appendChild(cover);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    cover.remove();
    dialog.destroy();
    window.removeEventListener('keydown', onKey, true);
    owner.activate();
  };
  const dialog = createWindow({ title, buttons: ['close'], onClose: () => onCancel?.() });
  dialog.body.appendChild(content);

  const ownerBox = owner.el.getBoundingClientRect();
  const box = dialog.el.getBoundingClientRect();
  dialog.el.style.left = `${Math.max(0, ownerBox.left + (ownerBox.width - box.width) / 2)}px`;
  dialog.el.style.top = `${Math.max(0, ownerBox.top + (ownerBox.height - box.height) / 2)}px`;

  // Clicking the blocked owner brings the dialog back to the front.
  cover.addEventListener('mousedown', e => {
    e.stopPropagation();
    dialog.show();
  });

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
    else if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); }
  };
  window.addEventListener('keydown', onKey, true);

  content.querySelector('[autofocus]')?.focus();
  return { close, dialog };
}
