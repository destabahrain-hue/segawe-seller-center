import Shell from '../../Shell';
import { Galat } from '../../UI';
import Scanner from './Scanner';
import { ensureSchema } from '@/lib/db';
import { ringkasScan, riwayatScan } from '@/lib/scan';

export const dynamic = 'force-dynamic';

/**
 * Rutenya sengaja di bawah /pesanan. Izin peran diperiksa lewat awalan
 * rute, jadi siapa pun yang sudah boleh membuka Pesanan langsung boleh
 * memakai layar scan ini — tidak perlu mengubah peran satu per satu.
 */
export default async function Scan() {
  let awal = { ringkas: { berhasil: 0, gagal: 0 }, riwayat: [] };
  let galat = null;
  try {
    await ensureSchema();
    const [ringkas, riwayat] = await Promise.all([ringkasScan(), riwayatScan({ batas: 50 })]);
    awal = { ringkas, riwayat: JSON.parse(JSON.stringify(riwayat)) };
  } catch (e) {
    galat = { pesan: e.message, detail: [e.code && `kode: ${e.code}`, e.detail, e.hint]
      .filter(Boolean).join('\n') || null };
  }

  return (
    <Shell judul="Scan & Kirim" rute="/pesanan"
           kanan={<a className="btn btn-sm" href="/pesanan?s=proses">Kembali ke Sedang dikemas</a>}>
      {galat
        ? <Galat judul="Layar Scan gagal dimuat" pesan={galat.pesan} detail={galat.detail} />
        : <Scanner awal={awal} />}
    </Shell>
  );
}
