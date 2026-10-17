// Murni tanpa database — boleh diimpor komponen peramban (Aksi.js).

/**
 * Tahap satu pesanan, dihitung dari kolomnya sendiri (di peramban) —
 * cerminan syarat TAHAP di lib/orders.js. Dipakai untuk label per baris dan untuk
 * menentukan tombol apa yang muncul saat pesanan dicentang di Perlu Dikirim.
 */
export function tahapPesanan(o) {
  const pra = ['READY_TO_SHIP', 'RETRY_SHIP', 'PROCESSED'].includes(o.status);
  if (!pra) return null;
  if (o.packed_at) return 'pickup';
  if (o.disisihkan_at) return 'sisih';
  if (o.ship_arranged_at) return 'proses';
  if (o.pack_gagal_at) return o.pack_gagal_jenis === 'marketplace' ? 'verifikasi' : 'gagalpack';
  return 'baru';
}

export const TAHAP_LABEL = {
  baru: 'Belum diproses', gagalpack: 'Proses gagal', verifikasi: 'Menunggu marketplace',
  sisih: 'Disisihkan', proses: 'Sedang dikemas', pickup: 'Siap dijemput',
  mintabatal: 'Diminta batal pembeli',
};
