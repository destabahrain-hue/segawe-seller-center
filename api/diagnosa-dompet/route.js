import { NextResponse } from 'next/server';
import { call, tidur } from '@/lib/shopee';
import { tokenHidup, tokoAktif } from '@/lib/tokens';
import { peranSekarang, bolehUang } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Menguji apakah bonus saldo iklan & bonus proteksi ROAS bisa diambil
 * lewat API, bukan dari file ekspor.
 *
 * Seluruh kategori Ads sudah dipastikan TIDAK memuatnya — isinya hanya
 * performa campaign dan get_total_balance (saldo sesaat, tanpa rincian
 * asal-usulnya). Tersangka yang tersisa ada di kategori Payment.
 *
 * Rute ini hanya MEMBACA. Tidak ada yang disimpan ke database.
 *
 * Kenapa lewat rute sendiri, bukan API Test Tool: bonus iklan hanya ada
 * di toko sungguhan, dan sandbox tidak punya saldo iklan sama sekali.
 * Pola yang sama sudah dipakai untuk escrow dan retur.
 */

/**
 * Nama parameter Shopee untuk kedua endpoint ini belum pernah kita
 * lihat, dan menebaknya satu per satu mahal. Jadi dicoba beberapa
 * bentuk sekaligus: yang salah akan ditolak dengan pesan yang MENYEBUT
 * parameter yang benar — pesan galatnya justru yang kita cari, bukan
 * keberhasilannya.
 */
const EP_DOMPET = {
  path: '/api/v2/payment/get_wallet_transaction_list',
  method: 'GET', auth: 'shop',
};
const EP_TAGIHAN = {
  path: '/api/v2/payment/get_billing_transaction_info',
  method: 'GET', auth: 'shop',
};

/**
 * Jendela 14 hari.
 *
 * create_time_from/to DITOLAK untuk rentang 30 hari: "time period too
 * large". Justru penolakan itu yang membuktikan parameternya dipakai.
 *
 * Sebaliknya transaction_time_from/to DITERIMA TANPA PROTES tapi
 * DIABAIKAN — diuji dengan meminta Agustus dan yang pulang transaksi 17
 * September, dengan transaction_id yang sama persis seperti panggilan
 * tanpa saringan sama sekali. Jangan pernah pakai parameter itu.
 */
function jendela(mundurHari = 0, panjang = 14) {
  const kini = Math.floor(Date.now() / 1000);
  const sampai = kini - mundurHari * 86400;
  return { dari: sampai - panjang * 86400, sampai };
}

/**
 * Sapu beberapa halaman lalu hitung tiap jenis transaksi.
 *
 * Tiga baris contoh tidak cukup menjawab "apakah bonus iklan ada di
 * sini" — bonus muncul sesekali, bisa saja tidak kebagian di halaman
 * pertama. Yang menjawab adalah daftar LENGKAP jenis transaksi yang
 * pernah muncul beserta jumlahnya.
 */
async function sapuDompet(token, shopId, { dari, sampai }, maksHalaman = 5) {
  const jenis = new Map();
  const contohPerJenis = new Map();
  let halaman = 0, baris = 0, lagi = true, galat = null;

  for (let no = 1; no <= maksHalaman && lagi; no++) {
    try {
      const json = await call(EP_DOMPET, {
        params: { page_no: no, page_size: 100,
                  create_time_from: dari, create_time_to: sampai },
        accessToken: token, shopId,
      });
      const r = json.response || {};
      const daftar = r.transaction_list || [];
      halaman++;
      baris += daftar.length;
      for (const t of daftar) {
        const k = `${t.transaction_type} | ${t.description || ''}`;
        jenis.set(k, (jenis.get(k) || 0) + 1);
        if (!contohPerJenis.has(k)) {
          // Nama pembeli dibuang — tidak ada gunanya di sini dan tidak
          // perlu ikut tersalin ke layar atau catatan.
          const { buyer_name, ...sisa } = t;
          contohPerJenis.set(k, sisa);
        }
      }
      lagi = !!r.more;
      await tidur(400);
    } catch (e) {
      galat = e.message;
      break;
    }
  }

  return {
    halaman, baris, masihAda: lagi, galat,
    jenis: [...jenis].map(([k, n]) => ({ jenis: k, jumlah: n }))
                     .sort((a, b) => b.jumlah - a.jumlah),
    contoh: [...contohPerJenis].map(([k, v]) => ({ jenis: k, baris: v })),
  };
}

export async function GET(req) {
  if (!bolehUang(await peranSekarang())) {
    return NextResponse.json({ ok: false, error: 'Tidak punya akses' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const mintaShop = searchParams.get('shop_id');
  const mundur = Number(searchParams.get('mundur')) || 0;

  const toko = await tokoAktif();
  if (!toko.length) {
    return NextResponse.json({ ok: false, error: 'Tidak ada toko aktif' }, { status: 400 });
  }
  const t = mintaShop ? toko.find((x) => String(x.shop_id) === mintaShop) : toko[0];
  if (!t) {
    return NextResponse.json({ ok: false, error: `Toko ${mintaShop} tidak ditemukan` }, { status: 400 });
  }

  const token = await tokenHidup(t.shop_id);
  const w = jendela(mundur);

  const dompet = await sapuDompet(token, t.shop_id, w);

  /**
   * Tagihan minta `cursor` berisi string kosong untuk permintaan pertama,
   * jadi harus disebut di kosongBoleh — kalau tidak, dibuang oleh call()
   * dan Shopee mengeluh soal cursor yang sebenarnya sudah dikirim.
   *
   * Dicoba dua bentuk: dengan saringan waktu dan tanpa. Endpoint Shopee
   * sudah dua kali terbukti menerima parameter waktu lalu mengabaikannya
   * diam-diam, jadi yang tanpa saringan justru sering lebih jujur.
   */
  const cobaTagihan = async (label, params) => {
    try {
      const json = await call(EP_TAGIHAN, {
        params, accessToken: token, shopId: t.shop_id, kosongBoleh: ['cursor'],
      });
      const r = json.response || {};
      const daftar = r.transaction_list || r.list || r.billing_transaction_list || [];
      return {
        label, ok: true,
        kunci: Object.keys(r),
        jumlahBaris: Array.isArray(daftar) ? daftar.length : null,
        contoh: Array.isArray(daftar) ? daftar.slice(0, 5) : null,
        mentah: json,
      };
    } catch (e) {
      return { label, ok: false, kode: e.shopeeCode || null, pesan: e.message };
    }
  };

  const tagihan = [
    await cobaTagihan('dengan saringan waktu',
      { page_size: 20, cursor: '', create_time_from: w.dari, create_time_to: w.sampai }),
    await cobaTagihan('tanpa saringan waktu', { page_size: 20, cursor: '' }),
  ];

  return NextResponse.json({
    ok: true,
    toko: { shop_id: String(t.shop_id), shop_name: t.shop_name || null },
    jendela: {
      dari: new Date(w.dari * 1000).toISOString().slice(0, 10),
      sampai: new Date(w.sampai * 1000).toISOString().slice(0, 10),
      catatan: 'tambah ?mundur=30 untuk menggeser jendela ke belakang',
    },
    yangDicari: 'jenis transaksi bertema bonus / kredit / rebate saldo iklan',
    dompet,
    tagihan,
  });
}
