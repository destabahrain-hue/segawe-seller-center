'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import Logo from './Logo';
import { IDash, IPulse, IChart, IMoney, IBag, IBox, ILink, IHouse, IStore, IClock, IMenu, ICopy, IUpArrow, IUser, ICalendar } from './Icons';

const MENU = [
  { grup: 'Ringkasan', item: [
    { href: '/',             label: 'Dashboard',        Icon: IDash },
    { href: '/realtime',     label: 'Laporan Realtime', Icon: IPulse },
    { href: '/laporan-toko', label: 'Laporan Toko',     Icon: IChart },
    { href: '/mingguan',     label: 'Laporan Mingguan', Icon: ICalendar },
    { href: '/keuangan',     label: 'Keuangan',         Icon: IMoney },
  ]},
  { grup: 'Operasional', item: [
    { href: '/pesanan',    label: 'Pesanan',    Icon: IBag, anak: [
        { href: '/pesanan?s=baru',       label: 'Pesanan baru',   kunci: 'baru' },
        { href: '/pesanan?s=gagalpack',  label: 'Proses gagal',   kunci: 'gagalpack' },
        { href: '/pesanan?s=verifikasi', label: 'Menunggu marketplace', kunci: 'verifikasi' },
        { href: '/pesanan?s=sisih',      label: 'Disisihkan',     kunci: 'sisih' },
        { href: '/pesanan?s=proses',     label: 'Sedang dikemas', kunci: 'proses' },
        { href: '/pesanan/scan',         label: 'Scan & Kirim' },
        { href: '/pesanan?s=pickup',     label: 'Siap dijemput',  kunci: 'pickup' },
        { href: '/pesanan?s=dikirim',    label: 'Dikirim',        kunci: 'dikirim' },
        { href: '/pesanan?s=selesai',    label: 'Selesai',        kunci: 'selesai' },
        { href: '/pesanan?s=batal',      label: 'Batal',          kunci: 'batal' },
        { href: '/pesanan?s=unpaid',     label: 'Belum dibayar',  kunci: 'unpaid' },
        { href: '/pesanan?s=semua',      label: 'Semua pesanan',  kunci: 'semua' },
        { href: '/pesanan/template',     label: 'Template Ekspor' },
      ] },
    { href: '/produk',     label: 'Produk',     Icon: IBox, anak: [
        { href: '/produk?t=live',     label: 'Aktif' },
        { href: '/produk?t=habis',    label: 'Stok habis' },
        { href: '/produk?t=nonaktif', label: 'Nonaktif' },
        { href: '/produk?t=ditolak',  label: 'Ditolak' },
        { href: '/produk?t=semua',    label: 'Semua produk' },
      ] },
    { href: '/salin-listing', label: 'Salin Listing', Icon: ICopy },
    { href: '/boost',      label: 'Boost Otomatis', Icon: IUpArrow },
    { href: '/master-sku', label: 'Master SKU', Icon: ILink },
    { href: '/gudang',     label: 'Gudang',     Icon: IHouse, anak: [
        { href: '/gudang',     label: 'Stok fisik' },
        { href: '/gudang/dos', label: 'Days of Supply' },
      ] },
  ]},
  { grup: 'Sistem', item: [
    { href: '/toko',    label: 'Toko Terhubung', Icon: IStore },
    { href: '/antrean', label: 'Antrean Tugas',  Icon: IClock },
    { href: '/pengguna', label: 'Pengguna',      Icon: IUser },
  ]},
];

/**
 * Angka ringkas untuk lencana sidebar.
 *
 * "999+" tidak berguna: tab Selesai berisi puluhan ribu, dan yang ingin
 * dilihat orang adalah SKALANYA, bukan sekadar "banyak". Ribuan diringkas
 * jadi "35,8rb" — masih muat di lencana sempit, dan jumlah persisnya tetap
 * bisa dilihat lewat tooltip.
 */
function ringkasAngka(n) {
  if (n < 1000) return String(n);
  if (n < 1000000) {
    const rb = n / 1000;
    return (rb < 10 ? rb.toFixed(1).replace('.', ',') : Math.round(rb)) + 'rb';
  }
  return (n / 1000000).toFixed(1).replace('.', ',') + 'jt';
}

export default function Sidebar({ sinkron, peran = 'pemilik', nama = '', rute = ['*'],
                                  hitung = null }) {
  const path = usePathname();
  const cari = useSearchParams();
  const [open, setOpen] = useState(false);
  const bolehLihat = (href) => rute.includes('*')
    ? true
    : rute.some((r) => (r === '/' ? href === '/' : href === r || href.startsWith(r + '/')));
  return (
    <>
      <button className="btn menu-btn" onClick={() => setOpen(!open)} aria-label="Buka menu"
              style={{ position: 'fixed', top: 15, left: 12, zIndex: 70, width: 32, padding: 0 }}>
        <IMenu width={18} height={18} />
      </button>
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand"><Logo /><span className="sub">Seller</span></div>
        <nav className="nav" aria-label="Navigasi utama">
          {MENU.map((g) => {
            const item = g.item.filter((x) => bolehLihat(x.href));
            if (!item.length) return null;
            return (
            <div className="nav-group" key={g.grup}>
              <div className="nav-label">{g.grup}</div>
              {item.map(({ href, label, Icon, anak }) => {
                const aktif = href === '/' ? path === '/' : path.startsWith(href);
                return (
                  <div key={href}>
                    <Link href={href} className="nav-item" onClick={() => setOpen(false)}
                          {...(aktif ? { 'aria-current': 'page' } : {})}>
                      <Icon /> {label}
                    </Link>
                    {aktif && anak && (
                      <div className="nav-anak">
                        {anak.map((a) => {
                          /**
                           * Sub-menu mana yang sedang dibuka.
                           *
                           * Tidak cukup membandingkan alamat, karena halaman
                           * Pesanan menyimpan tab di parameter `s` dan
                           * membawa penyaring lain (toko, urutan, rentang)
                           * di alamat yang sama. Yang dibandingkan nilai
                           * `s`-nya — dan halaman /pesanan tanpa parameter
                           * berarti tab bawaan, yaitu Pesanan baru.
                           */
                          const jalurA = a.href.split('?')[0];
                          const sSaatIni = cari?.get('s') || null;
                          const dibuka = a.kunci
                            ? path === '/pesanan'
                              && (sSaatIni ? sSaatIni.split(',')[0] === a.kunci
                                           : a.kunci === 'baru')
                            : path === jalurA;
                          const n = a.kunci && hitung ? hitung[a.kunci] : null;
                          return (
                            <Link key={a.href} href={a.href}
                                  className={'nav-sub' + (dibuka ? ' aktif' : '')}
                                  {...(dibuka ? { 'aria-current': 'page' } : {})}
                                  onClick={() => setOpen(false)}>
                              <span>{a.label}</span>
                              {n > 0 && <span className="nav-n" title={`${n.toLocaleString('id-ID')} pesanan`}>
                                {ringkasAngka(n)}
                              </span>}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ); })}
        </nav>
        <div className="sync" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="dot" aria-hidden="true" />
            <span>{sinkron || 'Belum pernah sinkron'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#B6BFD2' }}>
            <span style={{ fontWeight: 600 }}>{nama || 'Pengguna'}</span>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.09em',
                           border: '1px solid rgba(255,255,255,.16)', borderRadius: 999, padding: '1px 6px' }}>
              {peran}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
