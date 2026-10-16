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
    x: 130,
    y: 80,
    load: () => import('./minesweeper/app.js'),
  },
  {
    id: 'solitaire',
    label: 'Solitaire',
    title: "'Classic' Solitaire",
    icon: 'apps/solitaire/assets/sol-icon.png',
    style: 'apps/solitaire/style.css',
    x: 180,
    y: 40,
    load: () => import('./solitaire/app.js'),
  },
  {
    id: 'pinball',
    label: '3D Pinball',
    title: '3D Pinball for Windows - Space Cadet',
    icon: 'apps/pinball/assets/pinball-icon.png',
    style: 'apps/pinball/style.css',
    x: 160,
    y: 170,
    load: () => import('./pinball/app.js'),
  },
  {
    id: 'about',
    label: 'About',
    title: 'About XP Games',
    icon: 'apps/about/assets/about-icon.svg',
    style: 'apps/about/style.css',
    buttons: ['close'],
    x: 200,
    y: 120,
    load: () => import('./about/app.js'),
  },
];
