import Shell from '../Shell';
import { Catatan } from '../UI';
import Aksi from './Aksi';
import { ensureSchema, q } from '@/lib/db';
import { jam } from '@/lib/fmt';
import { IPlus } from '../Icons';

export const dynamic = 'force-dynamic';

export default async function Toko({ searchParams }) {
  await ensureSchema();
  const toko = await q(`
    SELECT s.*,
           (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.shop_id) AS pesanan
    FROM shops s ORDER BY s.shop_name NULLS LAST, s.shop_id`);
  const hasil = searchParams?.hasil;

  return (
    <Shell judul="Toko Terhubung" rute="/toko">
      {hasil === 'berhasil' && (
        <Catatan>Toko <b>{searchParams.shop}</b> berhasil dihubungkan. Tekan <b>Sinkron sekarang</b> untuk menarik pesanannya.</Catatan>
      )}
      {hasil === 'gagal' && <Catatan><b>Gagal menghubungkan toko.</b> {searchParams.pesan || ''}</Catatan>}
      {hasil === 'dicabut' && (
        <Catatan>Izin dicabut di Shopee. Toko itu sekarang tidak bisa disinkronkan sampai kamu memberi izin lagi.</Catatan>
      )}
      {!toko.length && (
        <Catatan>
          Belum ada toko. Klik <b>Hubungkan toko</b>, pilih toko di halaman Shopee, lalu setujui izinnya.
          Ulangi untuk tiap toko — izin Shopee diberikan per toko.
        </Catatan>
      )}

      <div className="shop-grid">
        {toko.map((t) => {
          const sisa = t.expires_at ? (new Date(t.expires_at) - Date.now()) / 60000 : -1;
          const sehat = t.status === 'active' && sisa > 0;
          const terputus = t.status === 'terputus';
          return (
            <div className="shop" key={t.shop_id}>
              <div className="n">{t.shop_name || `Toko ${t.shop_id}`}</div>
              <div className="i mono">shop_id {t.shop_id} · {t.platform}</div>

              <div className="r">
                {sehat ? (
                  <>
                    <span className="badge b-pos">Terhubung</span>
                    <span className="t-mute" style={{ fontSize: 12 }}>
                      token {sisa > 60 ? `${Math.floor(sisa / 60)}j ${Math.round(sisa % 60)}m` : `${Math.max(Math.round(sisa), 0)}m`}
                    </span>
                  </>
                ) : terputus ? (
                  <span className="badge b-mute">Diputuskan</span>
                ) : (
                  <span className="badge b-warn">Perlu dihubungkan ulang</span>
                )}
              </div>

              {t.last_error && <p className="err" style={{ fontSize: 12 }}>{t.last_error}</p>}

              <p className="t-mute" style={{ fontSize: 12, marginTop: 8 }}>
                {Number(t.pesanan)} pesanan tersimpan · sinkron terakhir {jam(t.last_sync_at)}
              </p>

              <Aksi shopId={String(t.shop_id)} nama={t.shop_name || `Toko ${t.shop_id}`} terhubung={sehat} />
            </div>
          );
        })}

        <a className="shop add" href="/api/auth/shopee">
          <IPlus width={22} height={22} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Hubungkan toko</span>
          <span style={{ fontSize: 12 }}>Lewat izin resmi Shopee</span>
        </a>
      </div>

      <Catatan>
        <b>Beda antara memutuskan dan mencabut.</b> <b>Hapus otorisasi</b> hanya membuang token
        dari aplikasi ini — izin di Shopee masih tercatat. <b>Cabut izin di Shopee</b> membatalkan
        persetujuannya di sisi Shopee. Keduanya tidak menghapus data penjualan yang sudah tersimpan.
      </Catatan>
    </Shell>
  );
}
