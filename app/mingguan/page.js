import { redirect } from 'next/navigation';

/**
 * Alamat lama Laporan Mingguan. Halamannya sudah pindah ke
 * /keuangan/mingguan; tautan atau bookmark lama dialihkan beserta
 * pilihan minggu & tokonya.
 */
export default function MingguanLama({ searchParams }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) if (v) p.set(k, String(v));
  redirect('/keuangan/mingguan' + (p.toString() ? `?${p}` : ''));
}
