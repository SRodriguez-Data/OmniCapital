const PATRON_US_TRADE = /\b([A-Z]{1,5})\b(?:(?!\b(?:Buy|BUY|buy|Sell|SELL|sell|Compra|COMPRA|compra|Venta|VENTA|venta)\b).){1,100}?\b(Buy|BUY|buy|Sell|SELL|sell|Compra|COMPRA|compra|Venta|VENTA|venta)\b(?:\s+\d{1,2}:\d{2}:\d{2}\s+[APMpm]{2})?\s+([\d\.,]+)\s+([\d\.,]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/g;
const PATRON_US_DIVIDEND = /\b([A-Z]{1,5})\b(?:(?!\b(?:Cash Dividend|CDIV|CASH DIVIDEND)\b).){1,100}?\b(Cash Dividend|CDIV|CASH DIVIDEND)\b\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d\.,]+)/g;
const PATRON_CL_TRADE = /(\d{2}-\d{2}-\d{4})\s+\d{2}-\d{2}-\d{4}\s+(?:(COMPRA|VENTA|Compra|Venta)\s+)?(?:ACCIONES|FONDOS|Acciones|Fondos)(?:(?!\b(?:CLP|USD)\b).){1,100}?\s+([A-Z0-9\-]{2,10})\s+(CLP|USD)\s+([\d\.,]+)\s*\$\s*([\d\.,]+)/g;
const PATRON_VECTOR_CARTERA = /\b([A-Z0-9\-]{2,10})\s+(CLP|USD)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+([\d\.,]+)\s+[\d\.,\-]+\s+[\d\.,\-]+/g;
const PATRON_FINTUAL_COMPRA = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]{2,10})\s+(?:ETF|Acciones|Fondo)(?:(?!\bUS\s+\$\b).){1,100}?US\s+\$\s*([\d,]+)\s+([\d,]+)/g;
const PATRON_FINTUAL_DIVIDEND = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]{2,10})\s+(?:ETF|Acciones|Fondo)(?:(?!\bUS\s+\$\b).){1,100}?US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)/g;

const TICKER_ALIASES: Record<string, string> = {
  'BCHILE': 'CHILE',
  'SANTANDER': 'BSANTANDER',
  'SQMB': 'SQM-B',
  'ANDINAB': 'ANDINA-B',
  'AGUASA': 'AGUAS-A'
};

function parseNumberFintual(val: string) {
  if (!val) return 0;
  return parseFloat(val.replace(/\./g, '').replace(/,/g, '.'));
}

function parseNumberRacional(val: string) {
  if (!val) return 0;
  return parseFloat(val.replace(/,/g, ''));
}

function parseDate(val: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  if (/^\d{2}-\d{2}-\d{4}$/.test(val)) {
    const parts = val.split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
    const parts = val.split('/');
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return new Date().toISOString().split('T')[0];
}

export async function parsePdfToCartola(file: File) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str);
      text += strings.join(" ") + " ";
    }

    let broker = "Desconocido";
    if (text.toLowerCase().includes('fintual')) broker = "Fintual";
    else if (text.toLowerCase().includes('drivewealth') || text.toLowerCase().includes('alpaca') || text.toLowerCase().includes('racional') || text.toLowerCase().includes('vector capital')) broker = "Racional";

    const data: any[] = [];

    if (broker === 'Fintual') {
      const matchesDiv = Array.from(text.matchAll(PATRON_FINTUAL_DIVIDEND));
      for (const m of matchesDiv) {
        data.push({ Fecha: parseDate(m[1]), Archivo: file.name, Ticker: m[3].toUpperCase(), Tipo: 'Dividendo', Precio: parseNumberFintual(m[6]), Cantidad: 1.0, Moneda: 'USD' });
      }

      const matchesCompra = Array.from(text.matchAll(PATRON_FINTUAL_COMPRA));
      for (const m of matchesCompra) {
        data.push({ Fecha: parseDate(m[1]), Archivo: file.name, Ticker: m[3].toUpperCase(), Tipo: 'Compra', Precio: parseNumberFintual(m[4]), Cantidad: parseNumberFintual(m[5]), Moneda: 'USD' });
      }
    } else {
      const matchesUs = Array.from(text.matchAll(PATRON_US_TRADE));
      for (const m of matchesUs) {
        let ticker = m[1].toUpperCase();
        let cantidad = parseNumberRacional(m[3]);
        let precio = parseNumberRacional(m[4]);
        const fecha = parseDate(m[5]);

        // Ajuste por Stock Split de HDV (5:1) ocurrido el 29 de Abril de 2026
        if (ticker === 'HDV') {
          const splitDate = new Date('2026-04-29');
          const tradeDate = new Date(fecha);
          if (tradeDate < splitDate) {
            cantidad = cantidad * 5;
            precio = precio / 5;
          }
        }

        data.push({ Fecha: fecha, Archivo: file.name, Ticker: ticker, Tipo: m[2].toUpperCase() === 'BUY' ? 'COMPRA' : 'VENTA', Precio: precio, Cantidad: cantidad, Moneda: 'USD' });
      }

      // 1. Intentar extraer la cartera completa de Racional local (Vector Capital)
      const matchesCartera = Array.from(text.matchAll(PATRON_VECTOR_CARTERA));
      let usedCartera = false;
      if (matchesCartera.length > 0) {
        usedCartera = true;
        for (const m of matchesCartera) {
          let ticker = m[1].toUpperCase();
          const moneda = m[2].toUpperCase(); // CLP o USD
          let precio = parseNumberFintual(m[3]); // Precio Compra Promedio
          let cantidad = parseNumberFintual(m[5]); // Nominales

          // Fusión CFMDIVO -> CFMITNIPSA
          if (ticker === 'CFMDIVO') {
            ticker = 'CFMITNIPSA';
            const ratio = 0.384122446;
            cantidad = cantidad * ratio;
            precio = precio / ratio;
          }

          if (TICKER_ALIASES[ticker]) ticker = TICKER_ALIASES[ticker];
          if (moneda === 'CLP' && !ticker.endsWith('.SN')) ticker += '.SN';

          data.push({ 
            Fecha: new Date().toISOString().split('T')[0], 
            Archivo: file.name, 
            Ticker: ticker, 
            Tipo: 'COMPRA', 
            Precio: precio, 
            Cantidad: cantidad, 
            Moneda: moneda 
          });
        }
      }

      // 2. Solo si no se encontró la cartera, intentar extraer operaciones individuales
      if (!usedCartera) {
        const matchesCl = Array.from(text.matchAll(PATRON_CL_TRADE));
      for (const m of matchesCl) {
        const tipoMatch = m[2] ? m[2].toUpperCase() : 'COMPRA';
        let ticker = m[3].toUpperCase();
        const moneda = m[4].toUpperCase(); // CLP o USD
        let precio = parseNumberFintual(m[6]);
        let cantidad = parseNumberFintual(m[5]);

        // Fusión CFMDIVO -> CFMITNIPSA (Ratio: 0.384122446)
        if (ticker === 'CFMDIVO') {
          ticker = 'CFMITNIPSA';
          const ratio = 0.384122446;
          cantidad = cantidad * ratio;
          precio = precio / ratio;
        }

        // Aplicar alias si el usuario usó otro nombre
        if (TICKER_ALIASES[ticker]) {
          ticker = TICKER_ALIASES[ticker];
        }

        // Agregar .SN solo si es CLP y no lo tiene ya.
        if (moneda === 'CLP' && !ticker.endsWith('.SN')) {
          ticker += '.SN';
        }
        
        data.push({ Fecha: parseDate(m[1]), Archivo: file.name, Ticker: ticker, Tipo: tipoMatch, Precio: precio, Cantidad: cantidad, Moneda: moneda });
      }
      } // Closes if (!usedCartera)
    } // Closes else

    return { broker, file_name: file.name, data };
  } catch (err) {
    console.error("PDF parse error:", err);
    throw new Error("Error procesando PDF de forma local en el navegador.");
  }
}
