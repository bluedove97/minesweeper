// XP-style window chrome shared by every app: title bar dragging, minimize,
// close, z-order on focus, and modal dialogs owned by a window.

let topZ = 10;

function bringToFront(el) {
  topZ += 1;
  el.style.zIndex = topZ;
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

  el.querySelector('.title-bar__min')?.addEventListener('click', () => onMinimize?.());
  el.querySelector('.title-bar__close')?.addEventListener('click', () => onClose?.());
  el.addEventListener('mousedown', () => bringToFront(el), true);
  el.addEventListener('contextmenu', e => e.preventDefault());
  makeDraggable(el, el.querySelector('.title-bar'));

  document.body.appendChild(el);
  bringToFront(el);

  return {
    el,
    body,
    show() { el.hidden = false; bringToFront(el); },
    hide() { el.hidden = true; },
    destroy() { el.remove(); },
  };
}

// Modal dialog centred over `owner` (a createWindow result). `content` is the
// dialog body element. Enter triggers `onEnter`, Escape and the close button
// trigger `onCancel`. Returns { close }.
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
  return { close };
}
