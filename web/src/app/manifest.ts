import type { MetadataRoute } from 'next';

// Permite instalar la app en el celular ("Agregar a la pantalla de inicio"), con su ícono y sin la barra del navegador
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OmniCapital',
    short_name: 'OmniCapital',
    description: 'Tus inversiones, su diagnóstico y las ideas del Top en un solo lugar.',
    start_url: '/',
    display: 'standalone',
    background_color: '#040706',
    theme_color: '#09090b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
