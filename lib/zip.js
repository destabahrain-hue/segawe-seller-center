import zlib from 'node:zlib';

/**
 * Penulis ZIP minimal tanpa dependensi. Dipakai dua tempat: membungkus
 * .xlsx (yang memang berformat ZIP) dan menggabungkan beberapa PDF label
 * dari toko berbeda jadi satu berkas unduhan.
 *
 * Alasan tidak memakai pustaka: Railway menolak build kalau ada dependensi
 * bercelah keamanan, dan pustaka arsip termasuk yang sering kena.
 */
// ── penulis ZIP minimal (deflate mentah) ──
function crc32(buf) {
  let c, tabel = crc32.t;
  if (!tabel) {
    tabel = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tabel[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ tabel[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

export function zip(berkas) {
  const lokal = [], pusat = [];
  let offset = 0;
  for (const { nama, isi } of berkas) {
    const namaBuf = Buffer.from(nama, 'utf8');
    const mentah = Buffer.isBuffer(isi) ? isi : Buffer.from(isi, 'utf8');
    const padat = zlib.deflateRawSync(mentah, { level: 9 });
    const crc = crc32(mentah);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(padat.length, 18); lh.writeUInt32LE(mentah.length, 22);
    lh.writeUInt16LE(namaBuf.length, 26); lh.writeUInt16LE(0, 28);
    lokal.push(lh, namaBuf, padat);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(padat.length, 20); ch.writeUInt32LE(mentah.length, 24);
    ch.writeUInt16LE(namaBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    pusat.push(ch, namaBuf);

    offset += lh.length + namaBuf.length + padat.length;
  }
  const isiPusat = Buffer.concat(pusat);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(berkas.length, 8); eocd.writeUInt16LE(berkas.length, 10);
  eocd.writeUInt32LE(isiPusat.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, isiPusat, eocd]);
}


/** Bungkus daftar {nama, isi} — isi boleh string atau Buffer. */
export function bungkusZip(berkas) {
  return zip(berkas);
}
