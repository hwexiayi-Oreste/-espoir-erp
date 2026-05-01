// ============================================================
//  MENU MOBILE PARTAGÉ
//  Inclus dans toutes les pages via <script src="/js/mobile-menu.js">
// ============================================================

(function() {
  'use strict';

  // Injecte le HTML du drawer dans le body
  function injectDrawerHTML() {
    if (document.getElementById('mobileDrawer')) return; // déjà injecté

    var html = '' +
      '<div class="mobile-overlay" id="mobileOverlay"></div>' +
      '<div class="mobile-drawer" id="mobileDrawer">' +
        '<div class="mobile-drawer-header">' +
          '<div class="mobile-drawer-logo">' +
            '<div style="width:34px;height:34px;background:#f5a623;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="#0b1220" stroke-width="2.5" style="width:16px;height:16px;"><path d="M2 20L12 4L22 20"/><path d="M6 20L12 10L18 20"/></svg>' +
            '</div>' +
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:1rem;letter-spacing:.05em;color:#fff;">ESPOIR ERP</div>' +
          '</div>' +
          '<button id="mobileCloseBtn" type="button" style="background:none;border:none;color:#8a9bb0;cursor:pointer;font-size:1.6rem;line-height:1;padding:0 4px;">&times;</button>' +
        '</div>' +
        '<div class="mobile-drawer-user">' +
          '<div id="drawerAvatar" style="width:36px;height:36px;border-radius:50%;background:#f5a623;display:flex;align-items:center;justify-content:center;font-family:\'Bebas Neue\',sans-serif;font-size:1rem;color:#0b1220;flex-shrink:0;">—</div>' +
          '<div>' +
            '<div id="drawerNom" style="font-size:.86rem;font-weight:600;color:#fff;">Chargement...</div>' +
            '<div id="drawerRole" style="font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#f5a623;">—</div>' +
          '</div>' +
        '</div>' +
        '<nav class="mobile-drawer-nav" id="drawerNav"></nav>' +
        '<div class="mobile-drawer-bottom">' +
          '<button id="mobileLogoutBtn" type="button" style="display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:8px;font-size:.88rem;color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);width:100%;cursor:pointer;font-family:inherit;">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
            'Déconnexion' +
          '</button>' +
        '</div>' +
      '</div>';

    var div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) document.body.appendChild(div.firstChild);
  }

  function openMenu() {
    document.getElementById('mobileOverlay').classList.add('open');
    document.getElementById('mobileDrawer').classList.add('open');
  }

  function closeMenu() {
    document.getElementById('mobileOverlay').classList.remove('open');
    document.getElementById('mobileDrawer').classList.remove('open');
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch(e) {}
    window.location.href = '/login';
  }

  function fillUser(user) {
    if (!user) return;
    var av = ((user.prenom || '?')[0] + (user.nom || '?')[0]).toUpperCase();
    var roles = {
      admin: 'Administrateur',
      directeur: 'Directeur Général',
      comptable: 'Comptable',
      technicien: 'Technicien',
      client: 'Client'
    };
    var rl = roles[user.role] || user.role;
    var a = document.getElementById('drawerAvatar');
    var n = document.getElementById('drawerNom');
    var r = document.getElementById('drawerRole');
    if (a) a.textContent = av;
    if (n) n.textContent = (user.prenom || '') + ' ' + (user.nom || '');
    if (r) r.textContent = rl;

    var allLinks = [
      { href: '/dashboard',     label: 'Dashboard',               roles: ['admin','directeur','comptable','technicien'] },
      { href: '/devis',         label: 'Devis & Offres',          roles: ['admin','directeur','comptable'] },
      { href: '/clients',       label: 'Clients',                 roles: ['admin','directeur'] },
      { href: '/chantiers',     label: 'Chantiers',               roles: ['admin','directeur','technicien'] },
      { href: '/transport',     label: 'Transport & Manutention', roles: ['admin','directeur','technicien'] },
      { href: '/comptabilite',  label: 'Comptabilité',            roles: ['admin','directeur','comptable'] },
      { href: '/utilisateurs',  label: 'Utilisateurs',            roles: ['admin'] },
      { href: '/espace-client', label: 'Mon Espace',              roles: ['client'] }
    ];

    var cur = window.location.pathname;
    var nav = document.getElementById('drawerNav');
    if (!nav) return;
    var html = '';
    for (var i = 0; i < allLinks.length; i++) {
      var l = allLinks[i];
      if (l.roles.indexOf(user.role) === -1) continue;
      var active = (cur === l.href);
      html += '<a href="' + l.href + '" style="display:block;padding:11px 14px;border-radius:8px;font-size:.88rem;color:' + (active ? '#f5a623' : '#c5d3e3') + ';background:' + (active ? 'rgba(245,166,35,.1)' : 'transparent') + ';text-decoration:none;margin-bottom:3px;border:1px solid ' + (active ? 'rgba(245,166,35,.2)' : 'transparent') + ';">' + l.label + '</a>';
    }
    nav.innerHTML = html;
  }

  // Attendre que le DOM soit prêt
  function init() {
    injectDrawerHTML();

    // Brancher les boutons
    var overlay = document.getElementById('mobileOverlay');
    var closeBtn = document.getElementById('mobileCloseBtn');
    var logoutBtn = document.getElementById('mobileLogoutBtn');
    if (overlay) overlay.addEventListener('click', closeMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Brancher les boutons hamburger et logout dans la topbar (s'ils existent)
    var hamburgers = document.querySelectorAll('.mobile-menu-btn');
    for (var i = 0; i < hamburgers.length; i++) {
      hamburgers[i].addEventListener('click', openMenu);
    }
    var topLogouts = document.querySelectorAll('.topbar-logout-btn');
    for (var j = 0; j < topLogouts.length; j++) {
      topLogouts[j].addEventListener('click', logout);
    }

    // Surveiller l'apparition de currentUser (chargé par checkAuth de la page)
    var poll = setInterval(function() {
      if (typeof window.currentUser !== 'undefined' && window.currentUser) {
        fillUser(window.currentUser);
        clearInterval(poll);
      }
    }, 100);
    setTimeout(function() { clearInterval(poll); }, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposer en global pour usage manuel
  window.openMobileMenu = openMenu;
  window.closeMobileMenu = closeMenu;
  window.mobileLogout = logout;
  window.fillMobileDrawer = fillUser;
})();
