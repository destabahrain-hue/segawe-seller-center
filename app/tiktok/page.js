import Shell from '../Shell';
import { Kpi, Catatan, Kosong } from '../UI';
import { ensureSchema } from '@/lib/db';
import { tokoTiktok, linkOtorisasi } from '@/lib/tiktok';
import { ringkasTiktok, statusTarikTiktok } from '@/lib/tiktok-sync';
import { daftarIklanTiktok } from '@/lib/tiktok-laporan';
import Tarik from './Tarik';
import Iklan from './Iklan';
import { jam, rp, num, tgl } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function TikTok({ searchParams }) {
  await ensureSchema();
  const adaLink = !!linkOtorisasi();
  const [toko, r] = await Promise.all([tokoTiktok(), ringkasTiktok()]);
  const status = Object.fromEntries(await Promise.all(
    toko.map(async (t) => [t.shop_id, await statusTarikTiktok(t.shop_id)])));
  const iklan = Object.fromEntries(await Promise.all(
    toko.map(async (t) => [t.shop_id, await daftarIklanTiktok(t.shop_id, { hari: 60 })])));
  const siap = !!process.env.TIKTOK_APP_KEY && !!process.env.TIKTOK_APP_SECRET;
  const aktif = toko.filter((t) => t.status === 'active').length;

  return (
    <Shell judul="TikTok Shop" rute="/toko"
           kanan={<a className="btn btn-sm" href="/toko">Toko Shopee</a>}>
      <div className="kpi-row">
        <Kpi label="Toko terhubung" nilai={String(aktif)} sub={`${toko.length} tercatat`} />
        <Kpi label="Kunci aplikasi" nilai={siap ? 'Terisi' : 'Belum diisi'}
             warna={siap ? undefined : 'var(--neg)'} sub="TIKTOK_APP_KEY & SECRET" />
        <Kpi label="Pesanan tersimpan" nilai={num(r.pesanan)}
             sub={r.terawal ? `sejak ${tgl(r.terawal)}` : 'belum ditarik'} />
        <Kpi label="Omzet bulan ini" nilai={rp(Number(r.omzet_bulan_ini))}
             sub="pesanan sah, sebelum potongan" />
        <Kpi label="Cair bulan ini" nilai={rp(Number(r.cair_bulan_ini))}
             sub={`${num(r.statement)} statement · ${num(r.retur)} retur`} />
      </div>

      {!siap && (
        <Catatan>
          Isi <b>TIKTOK_APP_KEY</b> dan <b>TIKTOK_APP_SECRET</b> di Railway lebih dulu. Tanpa
          keduanya, otorisasi toko akan gagal saat menukar code jadi token.
        </Catatan>
      )}
      {(searchParams?.hubungkan === 'belum' || !adaLink) && (
        <Catatan>
          Supaya tombol <b>Hubungkan toko</b> jalan, isi salah satu di Railway:{' '}
          <b>TIKTOK_AUTH_LINK</b> (tempel utuh hasil tombol <i>Copy authorization link</i> di
          Partner Center — sumber paling pasti) atau <b>TIKTOK_SERVICE_ID</b> (Service ID
          aplikasi, deretan angka panjang di halaman App &amp; Service).
        </Catatan>
      )}

      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between' }}>
          <h2>Toko TikTok</h2>
          <a className="btn btn-primary btn-sm" href="/api/tiktok/hubungkan">Hubungkan toko</a>
        </div>
        {!toko.length ? (
          <div className="card-body">
            <Kosong judul="Belum ada toko terhubung"
                    anak="Tekan tombol Hubungkan toko di atas, masuk dengan akun TikTok Shop, lalu pilih tokonya.
                          Setelah disetujui, TikTok mengarahkan kembali ke aplikasi ini dan tokonya tersimpan sendiri.
                          Ulangi untuk tiap toko." />
          </div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Toko</th><th>Shop ID</th><th>Region</th><th>Status</th>
              <th>Token sampai</th><th>Terhubung</th></tr></thead>
            <tbody>
              {toko.flatMap((t) => [
                <tr key={t.shop_id}>
                  <td className="t-strong">{t.shop_name || '—'}
                    {!t.shop_cipher && <span className="badge b-warn" style={{ marginLeft: 6 }}>tanpa cipher</span>}</td>
                  <td className="mono t-mute">{t.shop_id}</td>
                  <td className="t-mute">{t.region || '—'}</td>
                  <td><span className={'badge ' + (t.status === 'active' ? 'b-pos' : 'b-warn')}>{t.status}</span>
                    {t.last_error && <div className="st t-mute">{t.last_error}</div>}</td>
                  <td className="t-mute">{jam(t.expires_at)}</td>
                  <td className="t-mute">{jam(t.connected_at)}</td>
                </tr>,
                <tr key={t.shop_id + '-tarik'}>
                  <td colSpan={6} style={{ background: 'var(--surface-sunken)' }}>
                    <Tarik shopId={t.shop_id} awal={status[t.shop_id] || null} />
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <Iklan shopId={t.shop_id} baris={iklan[t.shop_id] || []} />
                    </div>
                  </td>
                </tr>,
              ])}
            </tbody>
          </table></div>
        )}
      </div>

      <Catatan>
        Token TikTok berumur <b>7 hari</b> dan disegarkan sendiri sebelum habis, memakai refresh token
        yang berlaku setahun. Untuk memastikan sambungannya benar-benar hidup, buka{' '}
        <a href="/api/tiktok/diagnosa">/api/tiktok/diagnosa</a> — rute itu memanggil TikTok sungguhan
        dan menampilkan balasannya apa adanya.
      </Catatan>
    </Shell>
  );
}
