/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Diperlukan agar instrumentation.js dijalankan saat server hidup (Next 14).
  experimental: { instrumentationHook: true },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};
