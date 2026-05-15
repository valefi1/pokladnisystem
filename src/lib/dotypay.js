/**
 * Dotypay – reálná integrace přes Nexo protokol (HTTP/JSON, port 7500)
 * Dokumentace: https://integrace.dotypay.com/payment-protocol/
 *
 * Komunikace:
 *   POST http://<terminalHost>:7500/
 *   Headers: Content-Type: application/json
 *            Authorization: Bearer <apiKey>
 *   Body: Nexo JSON (SaleToPOIRequest)
 *
 * Terminál = server (POI), pokladna = klient (POS/ECR).
 */

import { addDeviceLog } from './deviceDebug';
import { loadDevicePrefs } from './devicePrefs';

const DOTYPAY_PORT = 7500;

function fmtAmount(czk) {
  return Number(czk).toFixed(2);
}

function serviceId() {
  return Math.random().toString(36).slice(2, 12).toUpperCase();
}

function terminalUrl(host) {
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `http://${cleanHost}:${DOTYPAY_PORT}/`;
}

function buildSaleRequest({ amount, documentNumber, saleId, serviceID }) {
  return {
    SaleToPOIRequest: {
      MessageHeader: {
        MessageClass: 'Service',
        MessageCategory: 'Payment',
        MessageType: 'Request',
        ServiceID: serviceID,
        SaleID: saleId,
        POIID: '',
      },
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: {
            TransactionID: documentNumber,
            TimeStamp: new Date().toISOString(),
          },
          SaleReferenceID: documentNumber,
        },
        PaymentTransaction: {
          AmountsReq: {
            Currency: 'CZK',
            RequestedAmount: fmtAmount(amount),
          },
        },
        PaymentData: {
          PaymentType: 'Normal',
        },
      },
    },
  };
}

function buildDiagnosisRequest({ saleId }) {
  return {
    SaleToPOIRequest: {
      MessageHeader: {
        MessageClass: 'Service',
        MessageCategory: 'Diagnosis',
        MessageType: 'Request',
        ServiceID: serviceId(),
        SaleID: saleId,
        POIID: '',
      },
      DiagnosisRequest: {
        HostDiagnosisFlag: false,
      },
    },
  };
}

async function nexoPost(url, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const bodyStr = JSON.stringify(body);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(new TextEncoder().encode(bodyStr).length),
        Authorization: `Bearer ${apiKey}`,
      },
      body: bodyStr,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parsePaymentResponse(data) {
  const resp =
    data?.SaleToPOIResponse?.PaymentResponse ??
    data?.SaleToPOIRequest?.PaymentResponse;

  if (!resp) {
    return { status: 'error', message: 'Neočekávaný formát odpovědi terminálu.' };
  }

  const result = resp.Response?.Result;
  const errorCondition = resp.Response?.ErrorCondition;
  const additionalResponse = resp.Response?.AdditionalResponse ?? '';
  const paymentResult = resp.PaymentResult;
  const referenceId =
    paymentResult?.PaymentAcquirerData?.AcquirerTransactionID?.TransactionID ?? '';
  const approvalCode =
    paymentResult?.PaymentAcquirerData?.ApprovalCode ?? '';
  const authorizedAmount = paymentResult?.AmountsResp?.AuthorizedAmount;

  if (result === 'Success') {
    return { status: 'approved', message: 'Platba schválena terminálem.', referenceId, approvalCode, authorizedAmount };
  }
  if (errorCondition === 'Cancel' || errorCondition === 'UserCancelled') {
    return { status: 'cancelled', message: 'Platba byla zrušena na terminálu.', referenceId };
  }
  if (errorCondition === 'PaymentRestriction' || errorCondition === 'Refusal') {
    return { status: 'declined', message: `Platba zamítnuta terminálem. ${additionalResponse}`.trim(), referenceId };
  }
  return {
    status: 'error',
    message: `Chyba terminálu: ${errorCondition ?? 'neznámá'}. ${additionalResponse}`.trim(),
    referenceId,
  };
}

export async function runDotypayPayment({ amount, documentNumber }) {
  const prefs = loadDevicePrefs();
  const { terminalMode, terminalHost, terminalLabel, terminalApiKey, terminalSaleId, terminalTimeoutSec, terminalScenario } = prefs;

  const deviceLabel = terminalLabel || 'Dotypay terminál';
  const timeoutMs = (Number(terminalTimeoutSec) || 45) * 1000;

  // Simulace – zachována beze změny
  if (terminalMode === 'dotypay-sim') {
    return _runSimulation({ amount, documentNumber, prefs, deviceLabel, timeoutMs });
  }

  // Ostré napojení přes Nexo HTTP
  if (terminalMode === 'dotypay-live') {
    const host = terminalHost?.trim();
    const apiKey = terminalApiKey?.trim();
    const saleId = terminalSaleId?.trim() || 'NEZAVISLA-POS';

    if (!host) {
      addDeviceLog('dotypay', 'Chybí IP adresa terminálu.', {}, 'error');
      return { provider: 'Dotypay', mode: terminalMode, deviceLabel, status: 'error', message: 'IP adresa terminálu není nastavena. Vyplň ji na stránce Zařízení.' };
    }
    if (!apiKey) {
      addDeviceLog('dotypay', 'Chybí API klíč (Bearer token) pro terminál.', {}, 'error');
      return { provider: 'Dotypay', mode: terminalMode, deviceLabel, status: 'error', message: 'API klíč (Bearer token) terminálu není nastaven. Vyplň ho na stránce Zařízení.' };
    }

    const url = terminalUrl(host);
    const currentServiceId = serviceId();

    addDeviceLog('dotypay', 'Odesílám Nexo PaymentRequest.', { url, amount, documentNumber, serviceID: currentServiceId });

    try {
      const body = buildSaleRequest({ amount, documentNumber, saleId, serviceID: currentServiceId });
      addDeviceLog('dotypay', 'Čekám na výsledek platby z terminálu…', { timeoutSec: timeoutMs / 1000 });

      const data = await nexoPost(url, apiKey, body, timeoutMs);
      addDeviceLog('dotypay', 'Přijata odpověď terminálu.', { raw: JSON.stringify(data).slice(0, 300) });

      const result = parsePaymentResponse(data);
      addDeviceLog('dotypay', `Výsledek: ${result.status}. ${result.message}`, { referenceId: result.referenceId, approvalCode: result.approvalCode }, result.status === 'approved' ? 'info' : 'warning');

      return { provider: 'Dotypay', mode: terminalMode, deviceLabel, ...result };

    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      const status = isTimeout ? 'timeout' : 'error';
      const message = isTimeout
        ? `Terminál neodpověděl do ${timeoutMs / 1000} s.`
        : `Chyba spojení s terminálem: ${err.message}`;

      addDeviceLog('dotypay', message, { error: err.message }, 'error');
      return { provider: 'Dotypay', mode: terminalMode, deviceLabel, status, message };
    }
  }

  // Ruční potvrzení
  addDeviceLog('dotypay', 'Karetní platba v ručním režimu.', { documentNumber });
  return { provider: 'Dotypay', mode: terminalMode, deviceLabel, status: 'manual', message: 'Zkontroluj terminál a potvrď platbu ručně.' };
}

export async function runDotypayConnectivityTest() {
  const prefs = loadDevicePrefs();
  const { terminalMode, terminalHost, terminalApiKey, terminalSaleId } = prefs;

  if (terminalMode === 'dotypay-sim') {
    addDeviceLog('dotypay', 'Test konektivity (simulace) proběhl.', { mode: terminalMode });
    return { ok: true, message: 'Simulační test terminálu proběhl v pořádku.' };
  }

  const host = terminalHost?.trim();
  const apiKey = terminalApiKey?.trim();
  const saleId = terminalSaleId?.trim() || 'NEZAVISLA-POS';

  if (!host || !apiKey) {
    return { ok: false, message: 'Chybí IP adresa nebo API klíč. Nastav je na stránce Zařízení.' };
  }

  const url = terminalUrl(host);
  addDeviceLog('dotypay', 'Spouštím Nexo Diagnosis request.', { url, saleId });

  try {
    const body = buildDiagnosisRequest({ saleId });
    const data = await nexoPost(url, apiKey, body, 10_000);
    const diagResp = data?.SaleToPOIResponse?.DiagnosisResponse;
    const result = diagResp?.Response?.Result;

    if (result === 'Success') {
      addDeviceLog('dotypay', 'Terminál dostupný – spojení OK.', { result });
      return { ok: true, message: 'Terminál je dostupný a komunikace funguje.' };
    }

    addDeviceLog('dotypay', 'Terminál odpověděl chybou.', { result, diagResp }, 'warning');
    return { ok: false, message: `Terminál odpověděl: ${result ?? 'neznámý výsledek'}.` };

  } catch (err) {
    addDeviceLog('dotypay', `Test konektivity selhal: ${err.message}`, {}, 'error');
    return { ok: false, message: `Nepodařilo se spojit s terminálem: ${err.message}` };
  }
}

// ─── Interní simulace ─────────────────────────────────────────────────────────

async function _runSimulation({ amount, documentNumber, prefs, deviceLabel, timeoutMs }) {
  const scenario = prefs.terminalScenario || 'approved';
  addDeviceLog('dotypay', 'Simulace: zahajuji platební požadavek.', { amount, documentNumber, scenario });
  await _wait(400);
  addDeviceLog('dotypay', 'Simulace: terminál připraven.', { deviceLabel });
  await _wait(550);
  addDeviceLog('dotypay', 'Simulace: odesílám částku.', { amount });
  await _wait(850);
  addDeviceLog('dotypay', 'Simulace: čekám na dokončení transakce.', { timeoutSec: timeoutMs / 1000 });

  if (scenario === 'timeout') {
    await _wait(1200);
    addDeviceLog('dotypay', 'Simulace: timeout.', {}, 'warning');
    return { provider: 'Dotypay', mode: 'dotypay-sim', deviceLabel, status: 'timeout', message: 'Terminál neodpověděl (simulace).' };
  }
  if (scenario === 'declined') {
    await _wait(900);
    addDeviceLog('dotypay', 'Simulace: zamítnuto.', {}, 'warning');
    return { provider: 'Dotypay', mode: 'dotypay-sim', deviceLabel, status: 'declined', message: 'Platba zamítnuta (simulace).', referenceId: _rid() };
  }
  if (scenario === 'cancelled') {
    await _wait(700);
    addDeviceLog('dotypay', 'Simulace: zrušeno.', {}, 'warning');
    return { provider: 'Dotypay', mode: 'dotypay-sim', deviceLabel, status: 'cancelled', message: 'Platba zrušena (simulace).', referenceId: _rid() };
  }

  await _wait(900);
  const referenceId = _rid();
  const approvalCode = _rid().slice(-6);
  addDeviceLog('dotypay', 'Simulace: schváleno.', { referenceId, approvalCode, amount });
  return { provider: 'Dotypay', mode: 'dotypay-sim', deviceLabel, status: 'approved', message: 'Platba schválena (simulace).', referenceId, approvalCode, amount };
}

const _wait = (ms) => new Promise((r) => setTimeout(r, ms));
const _rid = () => `DTPREF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
