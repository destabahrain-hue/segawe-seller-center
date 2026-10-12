/** Rentang waktu baku, selalu dihitung dalam zona Asia/Jakarta. */
const TZ = 'Asia/Jakarta';

function jakartaMidnight(offsetHari = 0) {
  const kini = new Date();
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(kini); // yyyy-mm-dd
  const d = new Date(`${s}T00:00:00+07:00`);
  d.setDate(d.getDate() + offsetHari);
  return d;
}

export const PILIHAN = [
  ['hari-ini',   'Hari ini'],
  ['kemarin',    'Kemarin'],
  ['7h',         '7 hari'],
  ['30h',        '30 hari'],
  ['bulan-ini',  'Bulan ini'],
  ['bulan-lalu', 'Bulan lalu'],
  ['custom',     'Pilih tanggal'],
];

const jkt = (ymd) => new Date(`${ymd}T00:00:00+07:00`);
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

export function rentang(kode = 'hari-ini', dari = null, sampai = null) {
  const h0 = jakartaMidnight(0);
  const besok = jakartaMidnight(1);

  // Rentang tanggal bebas. Batas akhir digeser ke awal hari berikutnya
  // supaya tanggal terakhir ikut terhitung penuh.
  if (kode === 'custom' && dari) {
    const a = jkt(dari);
    const b = jkt(sampai || dari);
    b.setDate(b.getDate() + 1);
    const panjangHari = Math.round((b - a) / 86400000);
    return {
      dari: a, sampai: b,
      satuan: panjangHari <= 2 ? 'hour' : 'day',
      label: (sampai && sampai !== dari)
        ? `${teks(dari)} – ${teks(sampai)}`
        : teks(dari),
      custom: true, awal: dari, akhir: sampai || dari,
    };
  }

  switch (kode) {
    case 'kemarin':    return { dari: jakartaMidnight(-1), sampai: h0, satuan: 'hour', label: 'Kemarin' };
    case '7h':         return { dari: jakartaMidnight(-6), sampai: besok, satuan: 'day', label: '7 hari terakhir' };
    case '14h':        return { dari: jakartaMidnight(-13), sampai: besok, satuan: 'day', label: '14 hari terakhir' };
    case '30h':        return { dari: jakartaMidnight(-29), sampai: besok, satuan: 'day', label: '30 hari terakhir' };
    case '90h':        return { dari: jakartaMidnight(-89), sampai: besok, satuan: 'day', label: '90 hari terakhir' };
    /**
     * Awal bulan dihitung dari TANGGAL JAKARTA, bukan dari objek Date.
     * Dulu memakai setDate(1) pada h0 — tapi h0 (00:00 WIB) adalah 17:00
     * UTC hari SEBELUMNYA, dan server berjalan di UTC. Akibatnya "Bulan
     * ini" dimulai tanggal 2 (tanggal 1 hilang), dan pada tanggal 1 sendiri
     * malah melompat ke bulan lalu.
     */
    case 'bulan-ini':
      return { dari: awalBulan(0), sampai: besok, satuan: 'day', label: 'Bulan ini' };
    case 'bulan-lalu':
      return { dari: awalBulan(-1), sampai: awalBulan(0), satuan: 'day', label: 'Bulan lalu' };
    default:           return { dari: h0, sampai: besok, satuan: 'hour', label: 'Hari ini' };
  }
}

/** 00:00 WIB tanggal 1, `geser` bulan dari bulan berjalan di Jakarta. */
function awalBulan(geser = 0) {
  const [y, m] = ymd(new Date()).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + geser, 1));
  return jkt(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`);
}

// timeZone WAJIB: tanpa itu tanggal diformat di zona server (UTC), dan
// 00:00 WIB tanggal 9 terbaca "08 Sep".
const teks = (x) => new Date(`${x}T00:00:00+07:00`)
  .toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });

/** Kunci tanggal hari ini di Jakarta, untuk nilai awal input tanggal. */
export const hariIniYmd = () => ymd(new Date());

/** Rentang pembanding dengan panjang yang sama, tepat sebelumnya. */
export function sebelumnya({ dari, sampai }) {
  const panjang = sampai.getTime() - dari.getTime();
  return { dari: new Date(dari.getTime() - panjang), sampai: new Date(dari.getTime()) };
}
