import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Přehled' },
  { to: '/pokladna', label: 'Pokladna' },
  { to: '/trzby', label: 'Tržby' },
  { to: '/produkty', label: 'Produkty' },
  { to: '/sklad', label: 'Sklad' },
  { to: '/naskladneni', label: 'Naskladnění' },
  { to: '/analytika', label: 'Analytika' },
  { to: '/zarizeni', label: 'Zařízení' },
];

export function Layout({ children, syncStatus }) {
  return (
    <div className="app-frame">
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
          <nav className="nav-list">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <span className="nav-dot" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-note">
            Světlejší kontrastní styl pro obsluhu, přehledy inspirované Dotykačkou a příprava na terminál i tiskárnu.
          </div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
