import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { ProveedorMovimiento } from "./components/Movimiento";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { LanguageProvider } from "./context/LanguageContext";
import { PortfolioProvider } from "./context/PortfolioContext";

export const metadata: Metadata = {
  title: "OmniCapital | Wealth Management",
  description: "Institutional Wealth Management Platform",
  // En el iPhone, "Agregar a inicio" la abre como app, con su nombre y sin la barra de Safari
  appleWebApp: { capable: true, title: "OmniCapital", statusBarStyle: "black-translucent" },
};

// En el celular, la barra del navegador toma el color del fondo de la app
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-[#e4e4e7] transition-colors duration-300">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider>
            <PortfolioProvider>
              <ProveedorMovimiento>{children}</ProveedorMovimiento>
            </PortfolioProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
