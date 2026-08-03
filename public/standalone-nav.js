document.addEventListener('DOMContentLoaded', () => {
  const groups = [...document.querySelectorAll('.nav-group')];
  const openGroup = (selected) => groups.forEach((group) => group.classList.toggle('collapsed', group !== selected));
  groups.forEach((group) => group.querySelector('.nav-group-title')?.addEventListener('click', () => openGroup(group)));
  const toggle = document.getElementById('menu-toggle'), overlay = document.getElementById('sidebar-overlay');
  const menu = (open) => { document.body.classList.toggle('menu-open', open); toggle?.setAttribute('aria-expanded', String(open)); if (toggle) toggle.textContent = open ? '×' : '☰'; };
  toggle?.addEventListener('click', () => menu(!document.body.classList.contains('menu-open'))); overlay?.addEventListener('click', () => menu(false));
  document.querySelectorAll('.sidebar-nav a').forEach((link) => link.addEventListener('click', () => menu(false)));
  const themeToggle = document.getElementById('theme-toggle'), themeLabel = document.getElementById('theme-label'), themeIcon = document.getElementById('theme-icon');
  const applyTheme = (theme) => { const light=theme==='light';document.documentElement.dataset.theme=light?'light':'dark';if(themeToggle)themeToggle.checked=!light;if(themeLabel)themeLabel.textContent=light?'Aydınlık tema':'Karanlık tema';if(themeIcon)themeIcon.textContent=light?'☀':'☾';localStorage.setItem('netrelay-theme',light?'light':'dark'); };
  themeToggle?.addEventListener('change', () => applyTheme(themeToggle.checked?'dark':'light')); applyTheme(document.documentElement.dataset.theme||'dark');
});
