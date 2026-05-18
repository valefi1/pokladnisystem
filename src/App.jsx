import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { CashierPage } from './pages/CashierPage';
import { ProductsPage } from './pages/ProductsPage';
import { StockPage } from './pages/StockPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReceivingPage } from './pages/ReceivingPage';
import { DevicesPage } from './pages/DevicesPage';
import { SalesPage } from './pages/SalesPage';
import { usePosStore } from './lib/posStore';
import { AuthGate } from './components/AuthGate';

function PosApp() {
  const {
    state,
    derived,
    addProduct,
    updateProduct,
    importStockSnapshot,
    importDotykackaCsv,
    importMovementHistory,
    applyStockMovement,
    completeSale,
    addSupplier,
    saveStockReceiptDraft,
    clearStockReceiptDraft,
    completeStockReceipt,
    openCashRegister,
    closeCashRegister,
    closeDay,
    addParkedTicket,
    renameParkedTicket,
    updateParkedTicketItems,
    deleteParkedTicket,
    resetDemo,
    syncStatus,
    remoteReady,
    remoteLoadOk,
  } = usePosStore();

  if (!remoteReady) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <div className="brand-badge">PS</div>
          <h1>Načítám pokladnu…</h1>
          <p className="muted">Stahuji produkty, otevřenou kasu a účty ze Supabase.</p>
        </div>
      </div>
    );
  }

  if (!remoteLoadOk) {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <div className="brand-badge danger">!</div>
          <h1>Nepodařilo se načíst Supabase</h1>
          <p className="muted">{syncStatus.message}</p>
          <p className="muted">Zkontroluj, že je spuštěné aktuální <code>supabase/schema.sql</code> a že existuje tabulka <code>pos_settings</code>.</p>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Layout syncStatus={syncStatus}>
        <Routes>
          <Route path="/" element={<DashboardPage state={state} derived={derived} onResetDemo={resetDemo} />} />
          <Route
            path="/pokladna"
            element={
              <CashierPage
                products={derived.visibleProducts}
                categories={derived.categories}
                nextDocumentSequence={state.sales.length + 1}
                activeCashSession={derived.activeCashSession}
                cashSessions={state.cashSessions}
                parkedTickets={state.parkedTickets}
                onOpenCashRegister={openCashRegister}
                onCompleteSale={completeSale}
                onAddParkedTicket={addParkedTicket}
                onRenameParkedTicket={renameParkedTicket}
                onUpdateParkedTicketItems={updateParkedTicketItems}
                onDeleteParkedTicket={deleteParkedTicket}
              />
            }
          />
          <Route
            path="/produkty"
            element={
              <ProductsPage
                products={state.products}
                categories={derived.categories}
                analyticsMap={derived.daysToZeroMap}
                onAddProduct={addProduct}
                onUpdateProduct={updateProduct}
                onImportStockSnapshot={importStockSnapshot} onImportDotykackaCsv={importDotykackaCsv}
                onImportMovementHistory={importMovementHistory}
              />
            }
          />
          <Route
            path="/sklad"
            element={<StockPage products={state.products} movements={state.movements} analyticsMap={derived.daysToZeroMap} onApplyMovement={applyStockMovement} />}
          />
          <Route
            path="/naskladneni"
            element={
              <ReceivingPage
                products={state.products}
                suppliers={state.suppliers}
                receipts={state.stockReceipts}
                draft={state.stockReceiptDraft}
                onSaveDraft={saveStockReceiptDraft}
                onClearDraft={clearStockReceiptDraft}
                onCompleteReceipt={completeStockReceipt}
                onAddSupplier={addSupplier}
              />
            }
          />
          <Route path="/analytika" element={<AnalyticsPage state={state} derived={derived} />} />
          <Route path="/trzby" element={<SalesPage sales={state.sales} dayClosures={state.dayClosures} cashSessions={state.cashSessions} activeCashSession={derived.activeCashSession} activeCashSessionSummary={derived.activeCashSessionSummary} onOpenCashRegister={openCashRegister} onCloseCashRegister={closeCashRegister} onCloseDay={closeDay} />} />
          <Route path="/zarizeni" element={<DevicesPage />} />
        </Routes>
      </Layout>
      </HashRouter>
  );
}

export default function App() {
  return (
    <AuthGate>
      <PosApp />
    </AuthGate>
  );
}
