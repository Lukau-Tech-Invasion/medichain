// Shared patient chrome: <div class="phone" data-tab="health"> gets the bottom bar.
const TABS = [
  ['home', 'home', 'Home'],
  ['health', 'heart', 'My health'],
  ['visits', 'calendar', 'Visits'],
  ['messages', 'message', 'Messages', 2],
  ['me', 'user', 'Me'],
];
document.querySelectorAll('.phone[data-tab]').forEach((phone) => {
  const current = phone.dataset.tab;
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = TABS.map(([id, icon, label, count]) =>
    `<a class="tab${id === current ? ' on' : ''}"${id === current ? ' aria-current="page"' : ''}>` +
    `<span class="pill"><i data-i="${icon}"></i></span>${label}${count ? `<span class="count">${count}</span>` : ''}</a>`).join('');
  phone.querySelector('main').after(nav);
});
