import type { NextConfig } from "next";

// Cabeceras de seguridad para toda la app: nadie puede mostrarla dentro de otra página (clickjacking sobre "registrar
// operación"), el navegador no adivina tipos de archivo y no se filtra la dirección completa a otros sitios.
//
// La política de contenido solo restringe lo que se revisó contra lo que la app carga de verdad: todas las imágenes son
// propias (íconos de /public, SVG en línea), no incrusta páginas ni plugins, y sus formularios no envían a otro sitio.
// Así una respuesta manipulada no puede sacar datos de la cartera cargando una imagen o un marco externo. Scripts,
// estilos y conexiones (Supabase, el propio Next) quedan sin restringir a propósito: una regla equivocada ahí rompe la app.
const CSP = [
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
