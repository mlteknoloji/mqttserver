document.addEventListener('DOMContentLoaded', () => {
  const groups = [...document.querySelectorAll('.nav-group')];
  const openGroup = (selected) => groups.forEach((group) => {const open=group===selected;group.classList.toggle('collapsed',!open);group.querySelector('.nav-group-title')?.setAttribute('aria-expanded',String(open))});
  groups.forEach((group) => {const title=group.querySelector('.nav-group-title');title?.setAttribute('aria-expanded',String(!group.classList.contains('collapsed')));title?.addEventListener('click',()=>{openGroup(group);localStorage.setItem('netrelay-nav-group',group.dataset.navGroup||'')})});
  const saved=groups.find(group=>group.dataset.navGroup===localStorage.getItem('netrelay-nav-group'));
  if(saved&&!groups.some(group=>!group.classList.contains('collapsed')))openGroup(saved);
  const toggle = document.getElementById('menu-toggle'), overlay = document.getElementById('sidebar-overlay');
  const menu = (open) => { document.body.classList.toggle('menu-open', open); toggle?.setAttribute('aria-expanded', String(open)); if (toggle) toggle.textContent = open ? '×' : '☰'; };
  toggle?.addEventListener('click', () => menu(!document.body.classList.contains('menu-open'))); overlay?.addEventListener('click', () => menu(false));
  document.querySelectorAll('.sidebar-nav a').forEach((link) => link.addEventListener('click', () => menu(false)));
  const themeToggle = document.getElementById('theme-toggle'), themeLabel = document.getElementById('theme-label'), themeIcon = document.getElementById('theme-icon');
  const applyTheme = (theme) => { const light=theme==='light';document.documentElement.dataset.theme=light?'light':'dark';if(themeToggle)themeToggle.checked=!light;if(themeLabel)themeLabel.textContent=light?'Aydınlık tema':'Karanlık tema';if(themeIcon)themeIcon.textContent=light?'☀':'☾';localStorage.setItem('netrelay-theme',light?'light':'dark'); };
  themeToggle?.addEventListener('change', () => applyTheme(themeToggle.checked?'dark':'light')); applyTheme(document.documentElement.dataset.theme||'dark');
});
