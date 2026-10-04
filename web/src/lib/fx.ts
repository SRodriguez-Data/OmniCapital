// Dólar observado (USD/CLP) publicado por el Banco Central, vía mindicador.cl.
// Funciona en navegador y en servidor (Node/Edge). Devuelve null si no se pudo obtener.
export async function fetchUsdClp(): Promise<number | null> {
  try {
    const res = await fetch('https://mindicador.cl/api/dolar', { next: { revalidate: 3600 } } as RequestInit);
    if (!res.ok) return null;
    const data = await res.json();
    const valor = Number(data?.serie?.[0]?.valor);
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  } catch {
    return null;
  }
}
