import './globals.css';

export const metadata = {
  title: 'Segawe Seller Center',
  description: 'Pusat kendali toko Shopee PT Segawe Jaya Mulia',
  manifest: '/manifest.webmanifest',
  // Supaya saat dipasang di iPhone judulnya pendek dan bar statusnya menyatu.
  appleWebApp: { capable: true, title: 'Segawe', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};
export const viewport = {
  width: 'device-width', initialScale: 1,
  // viewportFit cover + padding aman di CSS = konten tidak tertutup notch.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2952E3' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1320' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
        {/* Cegah kedip tema sebelum React jalan */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{var t=localStorage.getItem('nsc.theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
