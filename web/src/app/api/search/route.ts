import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      }
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Fallo al buscar en Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const quotes = data?.quotes || [];

    // Local IPSA tickers for better Chilean search
    const ipsaTickers = [
      { symbol: 'AGUAS-A.SN', name: 'Aguas Andinas S.A.', exchange: 'Santiago' },
      { symbol: 'ANDINA-B.SN', name: 'Embotelladora Andina', exchange: 'Santiago' },
      { symbol: 'BSANTANDER.SN', name: 'Banco Santander Chile', exchange: 'Santiago' },
      { symbol: 'CAP.SN', name: 'CAP S.A.', exchange: 'Santiago' },
      { symbol: 'CCU.SN', name: 'Compañía Cervecerías Unidas', exchange: 'Santiago' },
      { symbol: 'CENCOSUD.SN', name: 'Cencosud S.A.', exchange: 'Santiago' },
      { symbol: 'CHILE.SN', name: 'Banco de Chile', exchange: 'Santiago' },
      { symbol: 'CMPC.SN', name: 'Empresas CMPC S.A.', exchange: 'Santiago' },
      { symbol: 'COLBUN.SN', name: 'Colbún S.A.', exchange: 'Santiago' },
      { symbol: 'CONCHATORO.SN', name: 'Viña Concha y Toro', exchange: 'Santiago' },
      { symbol: 'COPEC.SN', name: 'Empresas Copec S.A.', exchange: 'Santiago' },
      { symbol: 'ECL.SN', name: 'Engie Energía Chile', exchange: 'Santiago' },
      { symbol: 'ENELCHILE.SN', name: 'Enel Chile S.A.', exchange: 'Santiago' },
      { symbol: 'ENTEL.SN', name: 'Empresa Nacional de Telecomunicaciones', exchange: 'Santiago' },
      { symbol: 'FALABELLA.SN', name: 'S.A.C.I. Falabella', exchange: 'Santiago' },
      { symbol: 'IAM.SN', name: 'Inversiones Aguas Metropolitanas', exchange: 'Santiago' },
      { symbol: 'ILC.SN', name: 'Inversiones La Construcción', exchange: 'Santiago' },
      { symbol: 'ITAUCL.SN', name: 'Itaú Corpbanca', exchange: 'Santiago' },
      { symbol: 'LTM.SN', name: 'LATAM Airlines Group', exchange: 'Santiago' },
      { symbol: 'MALLPLAZA.SN', name: 'Plaza S.A.', exchange: 'Santiago' },
      { symbol: 'PARAUCO.SN', name: 'Parque Arauco S.A.', exchange: 'Santiago' },
      { symbol: 'QUINENCO.SN', name: 'Quiñenco S.A.', exchange: 'Santiago' },
      { symbol: 'RIPLEY.SN', name: 'Ripley Corp S.A.', exchange: 'Santiago' },
      { symbol: 'SMU.SN', name: 'SMU S.A.', exchange: 'Santiago' },
      { symbol: 'SONDA.SN', name: 'Sonda S.A.', exchange: 'Santiago' },
      { symbol: 'SQM-B.SN', name: 'Sociedad Química y Minera', exchange: 'Santiago' },
      { symbol: 'VAPORES.SN', name: 'Compañía Sud Americana de Vapores', exchange: 'Santiago' },
      { symbol: 'CFINRENTAS.SN', name: 'Fondo de Inversión Rentas Inmobiliarias', exchange: 'Santiago' },
      { symbol: 'CFMITNIPSA.SN', name: 'Fondo de Inversión ETF Itau Chile', exchange: 'Santiago' }
    ];

    const localMatches = ipsaTickers.filter(t => 
      t.symbol.toLowerCase().includes(q.toLowerCase()) || 
      t.name.toLowerCase().includes(q.toLowerCase())
    );

    // Filter only equities, etfs, mutual funds
    const yahooResults = quotes
      .filter((q: Record<string, string>) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND')
      .map((q: Record<string, string>) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname,
        exchange: q.exchDisp
      }));

    // Merge and deduplicate
    const combined = [...localMatches, ...yahooResults];
    const seen = new Set();
    const finalResults = combined.filter(item => {
      if (seen.has(item.symbol)) return false;
      seen.add(item.symbol);
      return true;
    });

    return NextResponse.json(finalResults);

  } catch (error) {
    console.error('API Search Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
