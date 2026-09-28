import type { MetadataRoute } from 'next';

// Windows and Android take an installed shortcut's icon from here, not from
// icon.png. Without it, "Install" or "Create shortcut" draws a letter "T".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'THE CALLED — Setter Dashboard',
    short_name: 'The Called',
    start_url: '/',
    display: 'standalone',
    background_color: '#101014',
    theme_color: '#101014',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
