import Shell from '../../Shell';
import { Kpi, Catatan, Kosong } from '../../UI';
import { ensureSchema } from '@/lib/db';
import { detailPelanggan } from '@/lib/pelanggan';
import { rp, num, jam, tgl } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Detail({ params }) {
  await ensureSchema();
  const d = await detailPelanggan(params.id);
  const sah = d.pesanan.filter((p) => !['CANCELLED', 'UNPAID'].includes(p.status));
  const batal = d.pesanan.length - sah.length;
  const username = d.pesanan.find((p) => p.buyer_username)?.buyer_username;

  return (
    <Shell judul="Detail Pelanggan" rute="/pelanggan"
           kanan={<a className="btn btn-sm" href="/pelanggan">Kembali</a>}>
      {!d.pesanan.length && <Kosong judul="Pelanggan tidak ditemukan"
        anak="Sidik pelanggan ini tidak punya pesanan tersimpan." />}

      {d.pesanan.length > 0 && (
        <>
          <div className="kpi-row">
            <Kpi label="Total belanja" nilai={rp(d.belanja)} sub={`${num(sah.length)} pesanan sah`} />
            <Kpi label="Rata-rata" nilai={rp(sah.length ? d.belanja / sah.length : 0)} sub="per pesanan" />
            <Kpi label="Batal" nilai={num(batal)}
                 sub={d.pesanan.length ? `${((batal / d.pesanan.length) * 100).toFixed(1)}% dari pesanan` : '—'} />
            <Kpi label="Jeda antar belanja" nilai={d.jedaRata ? `${Math.round(d.jedaRata)} hari` : '—'}
                 sub={sah.length > 1 ? 'rata-rata' : 'baru sekali belanja'} />
          </div>

          <Catatan>
            {username ? <>Akun pembeli <b>{username}</b>. </> : null}
            Sidik pelanggan <span className="mono">{params.id}</span>. Nama penerima, telepon, dan alamat
            tidak tersedia — Shopee menyensornya untuk aplikasi tanpa akses data sensitif.
          </Catatan>

          <div className="card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="card-head"><h2>Barang yang dibeli</h2></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Master SKU</th><th className="t-right">Unit</th><th className="t-right">Nilai</th></tr></thead>
              <tbody>{d.sku.map((s) => (
                <tr key={s.code}><td className="mono t-strong">{s.code}</td>
                  <td className="t-num">{num(s.unit)}</td>
                  <td className="t-num">{rp(s.nilai)}</td></tr>
              ))}</tbody>
            </table></div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Riwayat pesanan</h2>
              <span className="badge b-mute">{num(d.pesanan.length)} terakhir</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Tanggal</th><th>Pesanan</th><th>Toko</th><th>Status</th>
                <th className="kol-opsional">Barang</th><th className="t-right">Nilai</th></tr></thead>
              <tbody>{d.pesanan.map((p) => (
                <tr key={p.order_sn}>
                  <td className="t-mute">{tgl(p.created_time)}</td>
                  <td className="mono">{p.order_sn}</td>
                  <td className="t-mute">{p.toko || '—'}</td>
                  <td><span className={'badge ' + (p.status === 'CANCELLED' ? 'b-warn' : 'b-mute')}>{p.status}</span></td>
                  <td className="t-mute kol-opsional" style={{ maxWidth: 320 }}>{p.barang || '—'}</td>
                  <td className="t-num">{rp(p.nilai)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        </>
      )}
    </Shell>
  );
}
