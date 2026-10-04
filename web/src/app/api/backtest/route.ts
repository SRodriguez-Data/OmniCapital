import { NextResponse } from 'next/server';
import { yahooFinance, dailyHistory, withTimeout, BENCH_CL } from '@/lib/marketData';
import { annualVol, maxDrawdown, returns } from '@/lib/quant';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

interface Point { date: string; price: number }

// adjclose incorpora dividendos y splits: para EE.UU. el backtest mide retorno total
async function yahooAdjusted(ticker: string, years: number): Promise<Point[]> {
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - years);
  const result = await withTimeout(yahooFinance.chart(ticker, { period1, interval: '1d' }), 15000, `Yahoo ${ticker}`);
  const out: Point[] = [];
  for (const q of result?.quotes ?? []) {
    const price = q.adjclose ?? q.close;
    if (q.date && price !== null && price !== undefined) out.push({ date: new Date(q.date).toISOString().slice(0, 10), price });
  }
  if (out.length === 0) throw new Error(`No hay datos disponibles para ${ticker}`);
  return out;
}

// Chile: cierres de la base del minero (Yahoo congela el historial chileno); retorno de precio
async function closes(ticker: string, years: number): Promise<Point[]> {
  const h = await dailyHistory(ticker, years * 365 + 5);
  if (!h) throw new Error(`No hay datos disponibles para ${ticker}`);
  return h.dates.map(date => ({ date, price: h.series.get(date)! }));
}

// Muestreo semanal para periodos largos: el gráfico queda liviano y las métricas casi no cambian
function weekly(points: Point[]): Point[] {
  return points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
}

export async function POST(request: Request) {
  if (!rateLimit(request, 'backtest', 30)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  try {
    const body = await request.json();
    const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
    const capital = Number(body.capital);
    const years = Number(body.years);

    if (!ticker || !/^[A-Z0-9.^=\-]{1,20}$/.test(ticker)) {
      return NextResponse.json({ error: 'Ticker inválido' }, { status: 400 });
    }
    if (!Number.isFinite(capital) || capital <= 0) {
      return NextResponse.json({ error: 'El capital debe ser un número mayor a 0' }, { status: 400 });
    }
    if (!Number.isInteger(years) || years < 1 || years > 30) {
      return NextResponse.json({ error: 'Los años deben estar entre 1 y 30' }, { status: 400 });
    }

    // Cada activo se compara con el índice de su mercado y en su propia moneda
    const chileno = ticker.endsWith('.SN');
    const benchmark = chileno ? { ticker: BENCH_CL, nombre: 'IPSA' } : { ticker: '^SP500TR', nombre: 'S&P 500' };
    const [targetData, benchmarkData] = await Promise.all(chileno
      ? [closes(ticker, years), closes(benchmark.ticker, years)]
      : [yahooAdjusted(ticker, years), yahooAdjusted(benchmark.ticker, years)]);

    const benchmarkMap = new Map(benchmarkData.map(d => [d.date, d.price]));
    const aligned = targetData.filter(d => benchmarkMap.has(d.date));
    if (aligned.length < 20) {
      return NextResponse.json({ error: 'No se encontraron suficientes datos históricos comunes con el índice' }, { status: 400 });
    }

    const t0 = aligned[0].price;
    const b0 = benchmarkMap.get(aligned[0].date)!;
    const target = aligned.map(d => capital * d.price / t0);
    const bench = aligned.map(d => capital * benchmarkMap.get(d.date)! / b0);

    const sampled = new Set((years > 2 ? weekly(aligned) : aligned).map(d => d.date));
    const chartData = aligned
      .map((d, i) => ({ date: d.date, Estrategia: Number(target[i].toFixed(2)), SP500: Number(bench[i].toFixed(2)) }))
      .filter(d => sampled.has(d.date));

    const yearsElapsed = (new Date(aligned.at(-1)!.date).getTime() - new Date(aligned[0].date).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const cagr = (final: number) => (yearsElapsed > 0.5 ? (final / capital) ** (1 / yearsElapsed) - 1 : null);
    const finalTargetValue = target.at(-1)!;
    const finalBenchmarkValue = bench.at(-1)!;

    return NextResponse.json({
      chartData,
      benchmark: benchmark.nombre,
      desde: aligned[0].date,
      totalReturn: !chileno, // en Chile es solo retorno de precio (sin dividendos)
      metrics: {
        targetReturn: (finalTargetValue / capital - 1) * 100,
        benchmarkReturn: (finalBenchmarkValue / capital - 1) * 100,
        finalTargetValue,
        finalBenchmarkValue,
        maxDrawdown: (maxDrawdown(target) ?? 0) * 100,
        benchmarkMaxDrawdown: (maxDrawdown(bench) ?? 0) * 100,
        targetCagr: cagr(finalTargetValue),
        benchmarkCagr: cagr(finalBenchmarkValue),
        targetVol: annualVol(returns(target)),
        benchmarkVol: annualVol(returns(bench)),
      },
    });

  } catch (err: unknown) {
    console.error('API Backtest Error:', err);
    const sinDatos = err instanceof Error && err.message.startsWith('No hay datos');
    return NextResponse.json({ error: sinDatos ? err.message : 'No se pudo simular con los datos de mercado disponibles. Intenta de nuevo en unos minutos.' }, { status: sinDatos ? 404 : 502 });
  }
}
