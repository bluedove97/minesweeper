// Apps shown on the desktop. To add an app, create apps/<id>/ with an app.js
// that exports mount(body, ctx) -> { unmount() }, then add an entry here.
// Paths are relative to index.html.

export const apps = [
  {
    id: 'minesweeper',
    label: 'Minesweeper',
    title: 'Minesweeper',
    icon: 'apps/minesweeper/assets/mine-icon.png',
    style: 'apps/minesweeper/style.css',
    x: 190,
    y: 180,
    load: () => import('./minesweeper/app.js'),
  },
  {
    id: 'solitaire',
    label: 'Solitaire',
    title: "'Classic' Solitaire",
    icon: 'apps/solitaire/assets/sol-icon.png',
    style: 'apps/solitaire/style.css',
    x: 260,
    y: 40,
    load: () => import('./solitaire/app.js'),
  },
];
