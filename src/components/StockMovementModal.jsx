import { useEffect, useState } from 'react';
import { formatQuantity } from '../lib/format';
import { getQuantityStep, isWeightUnit, normalizeCartQuantity } from '../lib/productUnits';

const labels = {
  receipt: 'Příjem na sklad',
  writeoff: 'Odpis ze skladu',
  inventory: 'Inventura na skutečný stav',
};

export function StockMovementModal({ open, onClose, onSubmit, product, movementType }) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) {
      setQuantity('');
      setNote('');
    }
  }, [open]);

  if (!open || !product || !movementType) return null;

  const step = getQuantityStep(product.unit);
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ productId: product.id, movementType, quantity: normalizeCartQuantity(quantity, product.unit), note });
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h3>{labels[movementType]}</h3>
            <p className="muted">{product.name} · aktuálně {formatQuantity(product.stock)} {product.unit}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Zavřít</button>
        </div>
        <form className="stack" onSubmit={handleSubmit}>
          <label>
            {movementType === 'inventory' ? 'Nový skutečný stav' : `Množství (${isWeightUnit(product.unit) ? 'po 0,001 kg' : 'po kusech'})`}
            <input type="number" step={step} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </label>
          <label>
            Poznámka
            <textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. opožděná příjemka" />
          </label>
          <div className="form-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Zrušit</button>
            <button type="submit" className="primary-button">Potvrdit pohyb</button>
          </div>
        </form>
      </div>
    </div>
  );
}
