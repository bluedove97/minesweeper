// About XP Games: a dialog-style window opened from its desktop icon, laid
// out like the games' About dialogs (icon, text, OK button).

const ICON = new URL('./assets/about-icon.svg', import.meta.url).href;
const REPO_URL = 'https://github.com/bluedove97/xpgames';

export function mount(root, ctx) {
  const el = document.createElement('div');
  el.className = 'dialog about-dialog';
  el.innerHTML = `
    <img src="${ICON}" alt="">
    <div>
      <p><b>XP Games</b></p>
      <p>This is a recreation of some classic Windows XP games. Running entirely on HTML and JavaScript.</p>
      <p><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${REPO_URL}</a></p>
      <p>Copyright &copy; 2026 bluedove97. Released under the
        <a href="${REPO_URL}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>.</p>
    </div>
    <div class="dialog__buttons"><button class="xp-button" data-ok>OK</button></div>`;
  root.appendChild(el);

  el.querySelector('[data-ok]').addEventListener('click', () => ctx.close());
  el.querySelector('[data-ok]').focus();

  return {
    unmount() {
      el.remove();
    },
  };
}
