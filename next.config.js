/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Desligado: gerar source maps do navegador em produção ~dobra o uso de memória
  // e o tempo do `next build`, o que estourava OOM no container de build (EasyPanel).
  // Não são necessários em produção; religar só se precisar depurar com mapas.
  productionBrowserSourceMaps: false,
  images: {
    formats: ['image/webp'],
  },
  webpack: (config, { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }) => {
    // Important: return the modified config
    config.module.rules.push({
      test: /\.mjs$/,
      enforce: 'pre',
      use: ['source-map-loader'],
    });

    return config;
  },
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
