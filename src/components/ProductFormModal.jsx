import { useEffect, useState } from 'react';

const emptyProduct = {
  name: '',
  category: '',
  price: 0,
  costPrice: 0,
  vatRate: 12,
  stock: 0,
  unit: 'ks',
  barcode: '',
  plu: '',
  hidden: false,
};

export function ProductFormModal({ open, onClose, onSave, product, existingCategories }) {
  const [form, setForm] = useState(emptyProduct);

  useEffect(() => {
    setForm(product ? { ...product } : emptyProduct);
  }, [product]);

  if (!open) return null;

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave({
      ...form,
      price: Number(form.price) || 0,
      costPrice: Number(form.costPrice) || 0,
      vatRate: Number(form.vatRate) || 12,
      stock: Number(form.stock) || 0,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal large-modal">
        <div className="modal-header">
          <div>
            <h3>{product ? 'Upravit produkt' : 'Nový produkt'}</h3>
            <p className="muted">Jednoduchý katalog pro pokladnu, sklad a analytiku days to zero.</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Zavřít</button>
        </div>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Název
            <input required value={form.name} onChange={(e) => handleChange('name', e.target.value)} />
          </label>
          <label>
            Kategorie
            <input list="categories" value={form.category} onChange={(e) => handleChange('category', e.target.value)} />
            <datalist id="categories">
              {existingCategories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label>
            Prodejní cena bez DPH
            <input type="number" min="0" step="0.001" value={form.price} onChange={(e) => handleChange('price', e.target.value)} />
          </label>
          <label>
            Nákupní cena bez DPH
            <input type="number" min="0" step="0.001" value={form.costPrice} onChange={(e) => handleChange('costPrice', e.target.value)} />
          </label>
          <label>
            Stav skladu
            <input type="number" step="0.001" value={form.stock} onChange={(e) => handleChange('stock', e.target.value)} />
          </label>
          <label>
            Jednotka
            <select value={form.unit} onChange={(e) => handleChange('unit', e.target.value)}>
              <option value="ks">Kusy (ks)</option>
              <option value="kg">Váha (kg)</option>
            </select>
          </label>
          <label>
            Barkód
            <input value={form.barcode} onChange={(e) => handleChange('barcode', e.target.value)} />
          </label>
          <label>
            PLU
            <input value={form.plu} onChange={(e) => handleChange('plu', e.target.value)} />
            <label>
              Sazba DPH
              <select value={form.vatRate} onChange={(e) => handleChange('vatRate', e.target.value)}>
                <option value="0">0 %</option>
                <option value="12">12 %</option>
                <option value="21">21 %</option>
              </select>
            </label>
          </label>
          <label className="checkbox-row full-row">
            <input type="checkbox" checked={form.hidden} onChange={(e) => handleChange('hidden', e.target.checked)} />
            Skrýt produkt z pokladny
          </label>
          <div className="form-actions full-row">
            <button type="button" className="ghost-button" onClick={onClose}>Zrušit</button>
            <button type="submit" className="primary-button">Uložit produkt</button>
          </div>
        </form>
      </div>
    </div>
  );
}
