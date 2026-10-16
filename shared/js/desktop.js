// Desktop shell: one icon per registered app. Double-clicking an icon opens
// the app's window, or restores it if it was minimized. Closing a window
// unmounts the app, so the next open starts a fresh instance.
//
// An app entry (see apps/registry.js) is
//   { id, label, title, icon, style, x, y, load: () => import(...) }
// and the loaded module exports mount(body, ctx) -> { unmount() }, where
// ctx = { window, close() }.

import { createWindow } from './window.js';

const loadedStyles = new Map();

function loadStyle(href) {
  if (!loadedStyles.has(href)) {
    loadedStyles.set(href, new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    }));
  }
  return loadedStyles.get(href);
}

export function startDesktop(apps) {
  const running = new Map(); // id -> { win, instance }
  const opening = new Set();

  const iconBar = document.createElement('div');
  iconBar.className = 'desktop-icons';
  document.body.appendChild(iconBar);

  function closeApp(id) {
    const entry = running.get(id);
    if (!entry) return;
    running.delete(id);
    entry.instance.unmount();
    entry.win.destroy();
  }

  async function openApp(app) {
    const entry = running.get(app.id);
    if (entry) {
      entry.win.show();
      return;
    }
    if (opening.has(app.id)) return;
    opening.add(app.id);
    try {
      const [module] = await Promise.all([app.load(), app.style && loadStyle(app.style)]);
      const win = createWindow({
        title: app.title,
        icon: app.icon,
        x: app.x,
        y: app.y,
        onMinimize: () => win.hide(),
        onClose: () => closeApp(app.id),
      });
      const instance = module.mount(win.body, { window: win, close: () => closeApp(app.id) });
      running.set(app.id, { win, instance });
    } finally {
      opening.delete(app.id);
    }
  }

  for (const app of apps) {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.title = 'Double-click to open';
    icon.innerHTML = `<img src="${app.icon}" alt=""><span></span>`;
    icon.querySelector('span').textContent = app.label;
    // Mobile browsers don't fire dblclick (double-tap zooms instead), so a
    // touch/pen tap opens the app with a single tap; mice keep double-click.
    let lastPointerType = 'mouse';
    icon.addEventListener('pointerdown', e => {
      lastPointerType = e.pointerType;
      iconBar.querySelectorAll('.desktop-icon').forEach(i => i.classList.toggle('selected', i === icon));
    });
    icon.addEventListener('click', () => {
      if (lastPointerType !== 'mouse') openApp(app);
    });
    icon.addEventListener('dblclick', () => {
      if (lastPointerType === 'mouse') openApp(app);
    });
    iconBar.appendChild(icon);
  }

  document.addEventListener('pointerdown', e => {
    if (!iconBar.contains(e.target)) {
      iconBar.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
    }
  });

  return { open: id => openApp(apps.find(a => a.id === id)) };
}
