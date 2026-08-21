import Shell from '../../Shell';
import { Kosong } from '../../UI';
import Penyusun, { DaftarTemplate } from './Penyusun';
import { ensureSchema, q } from '@/lib/db';
import { KATALOG, KELOMPOK, TEMPLATE_BAWAAN } from '@/lib/kolom-ekspor';

export const dynamic = 'force-dynamic';

/**
 * Rutenya di bawah /pesanan supaya izin peran ikut otomatis — siapa pun
 * yang boleh membuka Pesanan boleh menyusun template ekspornya.
 */
export default async function TemplateEkspor() {
  await ensureSchema();
  let tersimpan = [];
  try {
    tersimpan = await q(
      `SELECT id, nama, kunci, dibuat_oleh FROM export_template ORDER BY lower(nama)`);
  } catch { /* tabel baru; halaman tetap bisa dipakai */ }

  // Fungsi pengambil data tidak boleh ikut ke peramban — yang dikirim
  // hanya keterangannya.
  const katalog = KATALOG.map(([kunci, nama, kel, ada]) => ({ kunci, nama, kel, ada }));

  return (
    <Shell judul="Template Ekspor" rute="/pesanan"
           kanan={<a className="btn btn-sm" href="/pesanan">Kembali ke Pesanan</a>}>

      <div className="note">
        <div>
          Susunan kolom untuk ekspor Excel di halaman Pesanan. Bentuk barisnya
          <b> satu baris per SKU</b> — pesanan berisi tiga barang menghasilkan tiga baris,
          sama seperti ekspor BigSeller, jadi bisa langsung dipakai untuk sortir maupun pivot.
        </div>
      </div>

      <Penyusun katalog={katalog} kelompok={KELOMPOK}
                bawaan={TEMPLATE_BAWAAN.map(({ kode, nama, kunci }) => ({ kode, nama, kunci }))} />

      <div className="card" style={{ marginTop: 'var(--s4)' }}>
        <div className="card-head"><h2>Template buatan sendiri</h2></div>
        {tersimpan.length ? <DaftarTemplate template={JSON.parse(JSON.stringify(tersimpan))} />
          : <div className="card-body">
              <Kosong judul="Belum ada template buatan sendiri"
                      anak="Pilih kolomnya di atas, beri nama, lalu Simpan." />
            </div>}
      </div>
    </Shell>
  );
}
