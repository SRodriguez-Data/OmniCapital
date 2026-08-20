const PATRON_US_TRADE = /([A-Z]+)\s+.*?\s+(Buy|Sell)(?:\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M)?\s+([\d\.,]+)\s+([\d\.,]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/gi;
const PATRON_US_DIVIDEND = /([A-Z]+)\s+.*?\s+(?:Cash Dividend|CDIV)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d\.,]+)/gi;
// Capturamos el tipo (opcional), luego ACCIONES/FONDOS (con palabras extra opcionales), luego el Ticker, luego CLP/USD, luego Cantidad y Precio.
const PATRON_CL_TRADE = /(\d{2}-\d{2}-\d{4})\s+\d{2}-\d{2}-\d{4}\s+(?:(COMPRA|VENTA)\s+)?(?:ACCIONES|FONDOS)[A-Z\s]*(?:CB\s+)?([A-Z0-9\-]+)\s+(CLP|USD)\s+([\d\.,]+)\s*\$\s*([\d\.,]+)/gi;
const PATRON_FINTUAL_COMPRA = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]+)\s+(?:ETF|Acciones|Fondo).*?US\s+\$\s*([\d,]+)\s+([\d,]+)/gi;
const PATRON_FINTUAL_DIVIDEND = /(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9\-]+)\s+(?:ETF|Acciones|Fondo).*?US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)\s+US\s+\$\s*([\d,]+)/gi;

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
        data.push({ Fecha: parseDate(m[5]), Archivo: file.name, Ticker: m[1].toUpperCase(), Tipo: m[2].toUpperCase() === 'BUY' ? 'COMPRA' : 'VENTA', Precio: parseNumberRacional(m[3]), Cantidad: parseNumberRacional(m[4]), Moneda: 'USD' });
      }

      const matchesCl = Array.from(text.matchAll(PATRON_CL_TRADE));
      for (const m of matchesCl) {
        const tipoMatch = m[2] ? m[2].toUpperCase() : 'COMPRA';
        let ticker = m[3].toUpperCase();
        const moneda = m[4].toUpperCase(); // CLP o USD
        
        // Agregar .SN solo si es CLP y no lo tiene ya.
        if (moneda === 'CLP' && !ticker.endsWith('.SN')) {
          ticker += '.SN';
        }
        
        data.push({ Fecha: parseDate(m[1]), Archivo: file.name, Ticker: ticker, Tipo: tipoMatch, Precio: parseNumberFintual(m[6]), Cantidad: parseNumberFintual(m[5]), Moneda: moneda });
      }
    }

    return { broker, file_name: file.name, data };
  } catch (err) {
    console.error("PDF parse error:", err);
    throw new Error("Error procesando PDF de forma local en el navegador.");
  }
}
