'use client';
/**
 * Saringan Data Pelanggan. Dibuat sebagai form biasa (GET) supaya hasilnya
 * bisa ditandai/di-bookmark dan tombol kembali browser bekerja apa adanya.
 */
export default function Filter({ toko = [], nilai = {} }) {
  return (
    <form action="/pelanggan" className="filter-bar" style={{ display: 'grid', gap: 'var(--s3)' }}>
      <input type="hidden" name="r" value={nilai.r || ''} />
      <input type="hidden" name="dari" value={nilai.dari || ''} />
      <input type="hidden" name="sampai" value={nilai.sampai || ''} />
      <input type="hidden" name="tab" value={nilai.tab || 'semua'} />
      <div className="form-row" style={{ gap: 'var(--s3)', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2, minWidth: 220 }}><label>Cari</label>
          <input name="q" defaultValue={nilai.q || ''} placeholder="username pembeli…" /></div>
        <div className="field"><label>Toko</label>
          <select name="toko" defaultValue={nilai.toko || ''}>
            <option value="">Semua toko</option>
            {toko.map((t) => <option key={t.shop_id} value={t.shop_id}>{t.shop_name || t.shop_id}</option>)}
          </select></div>
        <button className="btn btn-primary">Terapkan</button>
        <a className="btn" href="/pelanggan">Atur ulang</a>
      </div>
    </form>
  );
}
