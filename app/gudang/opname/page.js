import Shell from '../../Shell';
import { Catatan } from '../../UI';
import Lembar from './Lembar';
import Mulai from './Mulai';
import { ensureSchema } from '@/lib/db';
import { bolehKoreksiStok } from '@/lib/auth';
import { opnameDraf, isiOpname, riwayatOpname } from '@/lib/opname';
import { pilihanMaster } from '@/lib/gudang';
import { num, jam } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

export default async function Opname() {
  await ensureSchema();
  const akunMaster = await bolehKoreksiStok();
  const draf = await opnameDraf();
  const [isi, foto, riwayat] = await Promise.all([
    draf ? isiOpname(draf.id) : [], draf ? pilihanMaster() : [], riwayatOpname(10),
  ]);
  const gambar = new Map(foto.map((m) => [Number(m.id), m.gambar]));
  const baris = isi.map((b) => ({ id: Number(b.id), code: b.code, kini: Number(b.kini), gambar: gambar.get(Number(b.id)) || null,
    stok_sistem: b.stok_sistem === null ? null : Number(b.stok_sistem),
    stok_fisik: b.stok_fisik === null ? null : Number(b.stok_fisik), dicatat_oleh: b.dicatat_oleh }));

  return (
    <Shell judul="Stock Opname" rute="/gudang" kanan={<a className="btn btn-sm" href="/gudang">Kembali ke Gudang</a>}>
      <Catatan>
        Isi <b>stok fisik</b> hasil hitung di rak. Selisih dihitung dari stok sistem <b>saat barang itu dicatat</b>,
        jadi pesanan yang keluar setelah dihitung tidak ikut terkoreksi. Barang yang tidak diisi tidak diubah.
        Selisih baru masuk ke stok setelah ditekan "Terapkan" oleh akun yang diizinkan mengoreksi stok.
      </Catatan>
      <div style={{ marginBottom: 'var(--s4)' }}>
        {draf ? <Lembar opname={{ id: Number(draf.id), dibuat_oleh: draf.dibuat_oleh }} baris={baris} akunMaster={akunMaster} /> : <Mulai />}
      </div>
      <div className="card">
        <div className="card-head"><h2>Riwayat opname</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Dibuka</th><th>Status</th><th className="t-right">Dihitung</th>
            <th className="t-right">Berselisih</th><th className="t-right">Total selisih</th><th>Diterapkan</th></tr></thead>
          <tbody>
            {riwayat.map((o) => (
              <tr key={o.id}>
                <td className="mono">#{o.id}</td>
                <td className="t-mute">{jam(o.dibuat_at)} · {o.dibuat_oleh || '—'}{o.catatan ? ` · ${o.catatan}` : ''}</td>
                <td><span className={'badge ' + (o.status === 'diterapkan' ? 'b-pos' : o.status === 'draf' ? 'b-warn' : 'b-mute')}>{o.status}</span></td>
                <td className="t-num">{num(o.dihitung)}</td>
                <td className="t-num">{num(o.selisih)}</td>
                <td className="t-num t-strong" style={{ color: o.net < 0 ? 'var(--neg)' : o.net > 0 ? 'var(--pos)' : undefined }}>
                  {o.net > 0 ? '+' : ''}{num(o.net)}</td>
                <td className="t-mute">{o.diterapkan_at ? `${jam(o.diterapkan_at)} · ${o.diterapkan_oleh}` : '—'}</td>
              </tr>
            ))}
            {!riwayat.length && <tr><td colSpan={7} className="t-mute">Belum pernah ada stock opname.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </Shell>
  );
}
