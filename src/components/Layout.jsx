import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Přehled', icon: 'P' },
  { to: '/pokladna', label: 'Pokladna', icon: 'K' },
  { to: '/trzby', label: 'Tržby', icon: 'T' },
  { to: '/produkty', label: 'Produkty', icon: 'Pr' },
  { to: '/sklad', label: 'Sklad', icon: 'S' },
  { to: '/naskladneni', label: 'Naskladnění', icon: 'N' },
  { to: '/analytika', label: 'Analytika', icon: 'A' },
  { to: '/zarizeni', label: 'Zařízení', icon: 'Z' },
];

export function Layout({ children, syncStatus }) {
  const location = useLocation();
  const isCashier = location.pathname === '/pokladna';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('pos-sidebar-collapsed') === '1');

  useEffect(() => {
    localStorage.setItem('pos-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  return (
    <div className={`app-frame ${isCashier ? 'cashier-shell-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-badge">PS</div>
          <div>
            <strong>Pokladní systém</strong>
            <p>Šumperská Špajzka · webové MVP</p>
          </div>
        </div>
        <div className="topbar-status">
          <span className={`badge ${syncStatus?.state === 'online' ? 'accent-badge' : syncStatus?.state === 'error' ? 'danger-badge' : ''}`} title={syncStatus?.message || ''}>{syncStatus?.mode || 'Lokální režim'}</span>
          <span className="badge accent-badge">Dotypay ready</span>
          <span className="badge">USB tisk připraven</span>
        </div>
      </header>
      <div className="app-shell">
        <aside className="sidebar">
          <button
            className="sidebar-collapse-button"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? 'Rozbalit menu' : 'Sbalit menu'}
          >
            {sidebarCollapsed ? '☰' : '←'}
          </button>
          <nav className="nav-list">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                title={item.label}
              >
                <span className="nav-dot nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-note">
            Světlý kontrastní styl pro obsluhu, přehledy inspirované Dotykačkou a příprava na terminál i tiskárnu.
          </div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
