import type { NextConfig } from "next";

// Cabeceras de seguridad para toda la app: nadie puede mostrarla dentro de otra página (clickjacking sobre "registrar
// operación"), el navegador no adivina tipos de archivo y no se filtra la dirección completa a otros sitios.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
