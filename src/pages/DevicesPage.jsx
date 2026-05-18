import { useEffect, useMemo, useState } from 'react';
import { clearDeviceLogs, exportDeviceLogs, formatLogDetails, loadDeviceLogs } from '../lib/deviceDebug';
import { runDotypayConnectivityTest, runDotypayPayment } from '../lib/dotypay';
import { getDeviceCapabilities, loadDevicePrefs, saveDevicePrefs } from '../lib/devicePrefs';
import { printTestDocument } from '../lib/receiptPrint';

function CapabilityBadge({ enabled, label }) {
  return <span className={`badge ${enabled ? 'accent-badge' : 'danger-badge'}`}>{label}</span>;
}

function LogTable({ logs }) {
  if (logs.length === 0) {
    return <p className="muted">Zatím tu nejsou žádné debug logy. Zkus test tisku nebo test Dotypay.</p>;
  }
  return (
    <div className="log-list">
      {logs.map((log) => (
        <div key={log.id} className={`log-entry ${log.level || 'info'}`}>
          <div className="list-row align-start">
            <div>
              <strong>{log.scope}</strong>
              <p className="muted no-margin">{new Date(log.at).toLocaleString('cs-CZ')}</p>
            </div>
            <span className={`badge ${log.level === 'warning' ? 'warning-badge' : log.level === 'error' ? 'danger-badge' : 'accent-badge'}`}>{log.level || 'info'}</span>
          </div>
          <p className="no-margin">{log.message}</p>
          {log.details ? <pre className="log-details">{formatLogDetails(log.details)}</pre> : null}
        </div>
      ))}
    </div>
  );
}

export function DevicesPage() {
  const [prefs, setPrefs] = useState(loadDevicePrefs);
  const [logs, setLogs] = useState(loadDeviceLogs);
  const [testingTerminal, setTestingTerminal] = useState(false);
  const capabilities = useMemo(() => getDeviceCapabilities(), []);

  useEffect(() => {
    saveDevicePrefs(prefs);
  }, [prefs]);

  const refreshLogs = () => setLogs(loadDeviceLogs());
  const handleChange = (field, value) => setPrefs((current) => ({ ...current, [field]: value }));

  const handleTestPrint = () => {
    printTestDocument();
    setTimeout(refreshLogs, 100);
  };

  const handleTerminalConnectTest = async () => {
    setTestingTerminal(true);
    try {
      const result = await runDotypayConnectivityTest();
      window.alert(result.message);
    } finally {
      setTestingTerminal(false);
      refreshLogs();
    }
  };

  const handleTestPayment = async () => {
    setTestingTerminal(true);
    try {
      const result = await runDotypayPayment({ amount: 249, documentNumber: 'TEST-DOTYPAY' });
      window.alert(`Výsledek testu: ${result.status}\n${result.message}`);
    } finally {
      setTestingTerminal(false);
      refreshLogs();
    }
  };

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>Tiskárna a terminál</h1>
          <p className="muted">Příprava pro USB termální tiskárnu podobnou Epson TM‑T20III a Wi‑Fi terminál Dotypay na N86 Pro. Tahle verze má simulaci, stavy a debug logy pro testování.</p>
        </div>
      </section>

      <section className="card">
        <div className="section-title-row">
          <h2>Diagnostika prohlížeče</h2>
          <div className="inline-actions compact-actions">
            <CapabilityBadge enabled={capabilities.print} label="window.print" />
            <CapabilityBadge enabled={capabilities.serial} label="Web Serial" />
            <CapabilityBadge enabled={capabilities.usb} label="WebUSB" />
            <CapabilityBadge enabled={capabilities.hid} label="WebHID" />
            <CapabilityBadge enabled={capabilities.online} label="online" />
          </div>
        </div>
        <p className="muted">Secure context: <strong>{capabilities.secureContext ? 'ano' : 'ne'}</strong>. Přímé USB / hardware API z browseru jsou zatím jen příprava, ale test tisku a Dotypay simulace už můžeš používat pro debug workflow.</p>
      </section>

      <div className="split-grid device-grid">
        <section className="card stack">
          <div className="section-title-row">
            <h2>Tiskárna</h2>
            <div className="inline-actions compact-actions">
              <button className="ghost-button" onClick={handleTestPrint}>Test tisku</button>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Režim tisku
              <select value={prefs.printerMode} onChange={(e) => handleChange('printerMode', e.target.value)}>
                <option value="browser-print">Systémový dialog prohlížeče</option>
                <option value="usb-bridge-prep">USB bridge · příprava</option>
                <option value="escpos-prep">ESC/POS · příprava</option>
              </select>
            </label>
            <label>
              Šířka papíru
              <select value={prefs.printerPaper} onChange={(e) => handleChange('printerPaper', e.target.value)}>
                <option value="58mm">58 mm</option>
                <option value="80mm">80 mm</option>
              </select>
            </label>
            <label className="full-row">
              Model / popis tiskárny
              <input value={prefs.printerLabel} onChange={(e) => handleChange('printerLabel', e.target.value)} placeholder="např. Dotykačka / Epson TM-T20III compatible" />
            </label>
            <label className="full-row">
              USB poznámka / název zařízení
              <input value={prefs.printerUsbHint} onChange={(e) => handleChange('printerUsbHint', e.target.value)} placeholder="např. Windows USB printer queue" />
            </label>
            <label>
              Počet kopií
              <input type="number" min="1" max="3" value={prefs.printerCopies} onChange={(e) => handleChange('printerCopies', Number(e.target.value) || 1)} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={prefs.printerAutoPrint} onChange={(e) => handleChange('printerAutoPrint', e.target.checked)} />
Automaticky vytisknout po prodeji
            </label>
          </div>
          <div className="inner-card">
            <strong>Jak to teď funguje</strong>
            <p className="muted">Na Androidu je automatický tisk výchozí vypnutý. Po zaplacení se zobrazí velké tlačítko pro ruční tisk poslední účtenky; systémový tisk Androidu se otevře pouze po klepnutí. Pro tichý ESC/POS tisk bez dialogu bude potřeba nativní Android bridge nebo tisková aplikace.</p>
          </div>
        </section>

        <section className="card stack">
          <div className="section-title-row">
            <h2>Dotypay / terminál</h2>
            <div className="inline-actions compact-actions">
              <button className="ghost-button" onClick={handleTerminalConnectTest} disabled={testingTerminal}>Test připojení</button>
              <button className="primary-button" onClick={handleTestPayment} disabled={testingTerminal}>Test platby</button>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Režim terminálu
              <select value={prefs.terminalMode} onChange={(e) => handleChange('terminalMode', e.target.value)}>
                <option value="dotypay-live">Dotypay LIVE – reálný terminál (Nexo HTTP)</option>
                <option value="dotypay-sim">Dotypay simulace / debug</option>
                <option value="manual-card-confirm">Ruční potvrzení kartou</option>
              </select>
            </label>
            <label className="full-row">
              Model / název terminálu
              <input value={prefs.terminalLabel} onChange={(e) => handleChange('terminalLabel', e.target.value)} placeholder="např. Dotypay · N86 Pro" />
            </label>
            <label>
              IP adresa terminálu
              <input value={prefs.terminalHost} onChange={(e) => handleChange('terminalHost', e.target.value)} placeholder="např. 192.168.1.120" />
            </label>
            <label className="full-row">
              API klíč (Bearer token)
              <input
                type="password"
                value={prefs.terminalApiKey || ''}
                onChange={(e) => handleChange('terminalApiKey', e.target.value)}
                placeholder="Bearer token z certifikace Dotypay"
                autoComplete="off"
              />
            </label>
            <label>
              Sale ID (ECR identifikátor)
              <input value={prefs.terminalSaleId || 'NEZAVISLA-POS'} onChange={(e) => handleChange('terminalSaleId', e.target.value)} placeholder="NEZAVISLA-POS" />
            </label>
            <label>
              Timeout terminálu (s)
              <input type="number" min="5" max="120" value={prefs.terminalTimeoutSec} onChange={(e) => handleChange('terminalTimeoutSec', Number(e.target.value) || 45)} />
            </label>
            {prefs.terminalMode === 'dotypay-sim' ? (
              <label>
                Debug scénář
                <select value={prefs.terminalScenario} onChange={(e) => handleChange('terminalScenario', e.target.value)}>
                  <option value="approved">Schváleno</option>
                  <option value="declined">Zamítnuto</option>
                  <option value="timeout">Timeout</option>
                  <option value="cancelled">Zrušeno</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="inner-card">
            <strong>Jak to funguje</strong>
            {prefs.terminalMode === 'dotypay-live' ? (
              <p className="muted">
                Pokladna komunikuje přímo s terminálem přes <strong>Nexo HTTP protokol</strong> (port 7500).
                Zadej IP adresu terminálu v lokální Wi‑Fi síti a Bearer token z certifikace Dotypay.
                Po kliknutí "Test připojení" se pošle Diagnosis request – terminál musí být online a mít token aktivní.
              </p>
            ) : prefs.terminalMode === 'dotypay-sim' ? (
              <p className="muted">Simulace bez fyzického terminálu – vhodné pro testování. Přepni na LIVE až budeš mít terminál.</p>
            ) : (
              <p className="muted">Karetní platba se zaznamená jako zaplacená, ale terminál se neovládá automaticky – obsluha potvrdí ručně.</p>
            )}
          </div>
        </section>
      </div>

      <section className="card stack">
        <div className="section-title-row">
          <h2>Debug logy zařízení</h2>
          <div className="inline-actions compact-actions">
            <button className="ghost-button" onClick={refreshLogs}>Obnovit</button>
            <button className="ghost-button" onClick={exportDeviceLogs}>Stáhnout JSON</button>
            <button className="ghost-button danger-outline" onClick={() => { clearDeviceLogs(); refreshLogs(); }}>Vymazat log</button>
          </div>
        </div>
        <p className="muted">Sem se zapisují tiskové požadavky, testy terminálu, simulace chyb a výsledky plateb. Až budeš testovat, pošli mi ideálně screenshot nebo export JSON.</p>
        <LogTable logs={logs.slice(0, 40)} />
      </section>
    </div>
  );
}
