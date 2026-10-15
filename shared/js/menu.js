// Menu bar with drop-down menus, ported from winXP's DropDowns component.
//
// menus: [{ label, items: [{ id, text, hotKey?, checked?, disabled? } | '-'] }]
// onSelect(id) is called for enabled items. Returns
// { el, setChecked(id, bool), setDisabled(id, bool), destroy() }.

const CHECK_IMG = new URL('../assets/checked.png', import.meta.url).href;

function rowHTML(item) {
  if (item === '-') return '<div class="drop-down__separator"></div>';
  const cls = ['drop-down__row', item.checked && 'checked', item.disabled && 'disabled'].filter(Boolean).join(' ');
  return `<div class="${cls}" data-item="${item.id}">`
    + `<div class="drop-down__check"><img src="${CHECK_IMG}" alt=""></div>`
    + `<div class="drop-down__text">${item.text}</div>`
    + `<span class="drop-down__hot-key">${item.hotKey || ''}</span>`
    + '<div class="drop-down__arrow"></div></div>';
}

export function createMenuBar(menus, onSelect) {
  const el = document.createElement('div');
  el.className = 'menu-bar';
  el.innerHTML = menus.map(menu => `
    <div class="drop-down" data-menu="${menu.label}">
      <div class="drop-down__label">${menu.label}</div>
      <div class="drop-down__menu">${menu.items.map(rowHTML).join('')}</div>
    </div>`).join('');

  let openMenu = '';
  const setOpenMenu = name => {
    openMenu = name;
    el.querySelectorAll('.drop-down').forEach(dd => {
      dd.classList.toggle('open', dd.dataset.menu === name);
    });
  };

  el.querySelectorAll('.drop-down').forEach(dd => {
    const label = dd.querySelector('.drop-down__label');
    label.addEventListener('mousedown', () => setOpenMenu(dd.dataset.menu));
    label.addEventListener('mouseenter', () => {
      if (openMenu) setOpenMenu(dd.dataset.menu);
    });
  });

  el.addEventListener('click', e => {
    const row = e.target.closest('.drop-down__row');
    if (!row || row.classList.contains('disabled')) return;
    setOpenMenu('');
    onSelect(row.dataset.item);
  });

  const closeOutside = e => {
    if (!el.contains(e.target)) setOpenMenu('');
  };
  window.addEventListener('mouseup', closeOutside);

  const row = id => el.querySelector(`[data-item="${CSS.escape(id)}"]`);
  return {
    el,
    setChecked(id, value) { row(id)?.classList.toggle('checked', value); },
    setDisabled(id, value) { row(id)?.classList.toggle('disabled', value); },
    destroy() { window.removeEventListener('mouseup', closeOutside); },
  };
}
