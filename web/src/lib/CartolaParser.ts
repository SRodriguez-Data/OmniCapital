import * as pdfjsLib from 'pdfjs-dist';

// Configurar el worker de PDF.js usando CDN para no pelear con Webpack/Next.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const PATRON_US_TRADE = /^([A-Z]+)\s+.*?\s+(Buy|Sell)\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M\s+([\d\.,]+)\s+([\d\.,]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
const PATRON_US_DIVIDEND = /^([A-Z]+)\s+.*?\s+(?:Cash Dividend|CDIV)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d\.,]+)/i;
const PATRON_CL_TRADE = /^(\d{2}-\d{2}-\d{4})\s+\d{2}-\d{2}-\d{4}\s+(COMPRA|VENTA)\s+(?:ACCIONES|FONDOS)\s+CB\s+([A-Z0-9]+)\s+(?:CLP|USD)\s+([\d\.,]+)\s+\$\s+([\d\.,]+)/i;
const PATRON_FINTUAL_COMPRA = /^(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9]+)\s+(?:ETF|Acciones|Fondo).*?US\s+\$\s+([\d,]+)\s+([\d,]+)/i;
const PATRON_FINTUAL_DIVIDEND = /^(\d{4}-\d{2}-\d{2})\s+(.*?)\s+([A-Z0-9]+)\s+(?:ETF|Acciones|Fondo).*?US\s+\$\s+([\d,]+)\s+US\s+\$\s+([\d,]+)\s+US\s+\$\s+([\d,]+)/i;

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
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str);
      text += strings.join(" ") + "\n";
    }

    const lines = text.split('\n');
    let broker = "Desconocido";
    if (text.toLowerCase().includes('fintual')) broker = "Fintual";
    else if (text.toLowerCase().includes('drivewealth') || text.toLowerCase().includes('alpaca') || text.toLowerCase().includes('racional')) broker = "Racional";

    const data: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (broker === 'Fintual') {
        const matchDiv = line.match(PATRON_FINTUAL_DIVIDEND);
        if (matchDiv) {
          data.push({ Fecha: parseDate(matchDiv[1]), Archivo: file.name, Ticker: matchDiv[3].toUpperCase(), Tipo: 'Dividendo', Precio: parseNumberFintual(matchDiv[6]), Cantidad: 1.0, Moneda: 'USD' });
          continue;
        }

        const matchCompra = line.match(PATRON_FINTUAL_COMPRA);
        if (matchCompra) {
          data.push({ Fecha: parseDate(matchCompra[1]), Archivo: file.name, Ticker: matchCompra[3].toUpperCase(), Tipo: 'Compra', Precio: parseNumberFintual(matchCompra[4]), Cantidad: parseNumberFintual(matchCompra[5]), Moneda: 'USD' });
        }
      } else {
        const matchUs = line.match(PATRON_US_TRADE);
        if (matchUs) {
          data.push({ Fecha: parseDate(matchUs[5]), Archivo: file.name, Ticker: matchUs[1].toUpperCase(), Tipo: matchUs[2].toUpperCase() === 'BUY' ? 'COMPRA' : 'VENTA', Precio: parseNumberRacional(matchUs[3]), Cantidad: parseNumberRacional(matchUs[4]), Moneda: 'USD' });
          continue;
        }
        const matchCl = line.match(PATRON_CL_TRADE);
        if (matchCl) {
          data.push({ Fecha: parseDate(matchCl[1]), Archivo: file.name, Ticker: matchCl[3].toUpperCase(), Tipo: matchCl[2].toUpperCase(), Precio: parseNumberFintual(matchCl[4]), Cantidad: parseNumberFintual(matchCl[5]), Moneda: 'CLP' });
        }
      }
    }

    return { broker, file_name: file.name, data };
  } catch (err) {
    console.error("PDF parse error:", err);
    throw new Error("Error procesando PDF de forma local en el navegador.");
  }
}
