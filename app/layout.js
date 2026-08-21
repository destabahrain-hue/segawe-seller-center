import './globals.css';

export const metadata = {
  title: 'Segawe Seller Center',
  description: 'Pusat kendali toko Shopee PT Segawe Jaya Mulia',
};
export const viewport = { width: 'device-width', initialScale: 1 };

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
