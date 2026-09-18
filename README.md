# Segawe Seller Center

Pusat kendali toko Shopee PT Segawe Jaya Mulia.
Next.js + Postgres, satu aplikasi, deploy di Railway.

**Fase 1 (yang aktif sekarang):** hubungkan toko → tarik pesanan → Master SKU & HPP →
laba realtime → laporan toko → laporan keuangan → gudang.
**Fase 3 (kerangka sudah ada, belum dihidupkan):** produk massal.

---

## Langkah pasang — ikuti berurutan

### 1. Buat repo GitHub

Buat repo **kosong** (tanpa README, tanpa .gitignore), lalu unggah **ISI** folder ini —
bukan folder pembungkusnya, bukan file zip-nya. GitHub tidak mengekstrak zip otomatis.

Yang harus terlihat di halaman depan repo: `app`, `lib`, `db`, `Dockerfile`,
`package.json`, `next.config.js`, `middleware.js`, `jsconfig.json`.

> `package-lock.json` sengaja **tidak** disertakan. Lockfile lama pernah mengunci
> versi Next.js yang rentan dan membuat Railway menolak build berulang kali.

### 2. Buat proyek Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → pilih repo tadi.
2. Di proyek yang sama: **New** → **Database** → **Add PostgreSQL**.
   Variabel `DATABASE_URL` terisi otomatis.
3. Settings → pastikan Railway memakai **Dockerfile** (bukan Railpack/Nixpacks).

### 3. Isi Variables

Salin dari `.env.example`. Yang wajib:

| Variabel | Isi |
|---|---|
| `SHOPEE_PARTNER_ID` | **Live Partner ID milik PT Segawe** — bukan `1239240` (app Numedix), bukan juga Test Partner ID `1241774` |
| `SHOPEE_PARTNER_KEY` | dari Open Platform Console |
| `SHOPEE_HOST` | `https://partner.shopeemobile.com` (produksi) |
| `APP_URL` | alamat publik Railway, tanpa garis miring di akhir |
| `APP_PASSWORD` | kata sandi masuk |
| `APP_SESSION_TOKEN` | teks acak panjang |
| `CRON_SECRET` | teks acak panjang lain |

`APP_URL` **harus** alamat publik. Jangan localhost — `request.url` di Railway
berisi `localhost:8080` dan membuat redirect OAuth gagal.

### 4. Buat domain publik

Settings → Networking → **Generate Domain** → isi port **8080**.
Salin alamatnya ke `APP_URL`, lalu Redeploy.

### 5. Daftarkan alamat callback di Shopee

Open Platform Console → app **inhouse seller** → App Settings →
isi redirect domain dengan `APP_URL` kamu. Harus **cocok persis**.

Alamat callback aplikasi ini: `APP_URL` + `/api/auth/callback`

### 6. Masuk & hubungkan toko

Buka `APP_URL`, masuk dengan `APP_PASSWORD`, lalu **Toko Terhubung → Hubungkan toko**.
Ulangi untuk tiap toko — izin Shopee diberikan per toko.

Tabel database dibuat otomatis saat halaman pertama dibuka.

### 7. Pasang cron

Daftar di cron-job.org, arahkan ke `APP_URL/api/cron`,
tambahkan header `x-cron-secret` berisi `CRON_SECRET`.
Jadwal yang wajar: tiap 5 menit.

Cron mengerjakan antrean tugas lalu menyinkronkan pesanan semua toko.

---

## Yang WAJIB diperiksa sebelum dipakai serius

Beberapa endpoint belum pernah kita uji lewat **API Test Tool**. Semuanya
dikumpulkan di satu berkas: **`lib/endpoints.js`**.

Yang bertanda `TERKONFIRMASI` sudah terbukti jalan di proyek Ad Storm.
Yang bertanda `PERIKSA` perlu dicocokkan: buka Open Platform Console →
API Test Tool → Partner ID milik PT Segawe → pilih endpoint → **View API Details**,
lalu samakan path dan nama parameternya.

Kalau ada yang meleset, perbaiki **hanya di berkas itu** — file lain tidak perlu disentuh.

---

## Cara kerja perhitungan laba

```
laba = omzet − HPP − biaya platform − iklan
```

- **HPP** diambil dari Master SKU, memakai tarif yang berlaku pada tanggal pesanan.
  Paket bundling diuraikan ke komponennya; HPP paket dihitung otomatis, tidak diinput.
- **Biaya platform** memakai angka nyata dari rincian dana Shopee bila sudah tersedia.
  Kalau belum, dipakai persentase perkiraan `EST_PLATFORM_FEE_PCT`.
  Halaman menandai berapa pesanan yang masih perkiraan.
- **Iklan** diambil dari tabel `ad_spend`.

Stok gudang **tidak** disinkronkan ke Shopee. Stok keluar dipotong saat pesanan
berstatus **dikirim**, dan bundling diuraikan ke komponen.

---

## Struktur berkas

```
lib/endpoints.js   satu-satunya tempat path & parameter Shopee
lib/shopee.js      tanda tangan HMAC-SHA256 + pemanggil API
lib/tokens.js      simpan & segarkan token (refresh_token dijaga COALESCE)
lib/sync.js        tarik pesanan, dana, potong stok, tautkan SKU otomatis
lib/report.js      seluruh perhitungan laba, HPP, saldo gudang
lib/queue.js       antrean tugas massal dengan jeda antar panggilan
db/schema.sql      skema, aman dijalankan berulang
```

## Menjalankan di komputer sendiri

```bash
npm install
cp .env.example .env.local   # isi seperlunya
npm run dev
```
