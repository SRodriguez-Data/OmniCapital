import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchHistoricalData(ticker: string, years: number, interval: '1d' | '1wk' | '1mo') {
  const period2 = new Date();
  const period1 = new Date();
  period1.setFullYear(period2.getFullYear() - years);

  const result = await yahooFinance.chart(ticker, {
    period1: period1,
    period2: period2,
    interval: interval
  });

  if (!result || !result.quotes || result.quotes.length === 0) {
    throw new Error(`No hay datos disponibles para ${ticker}`);
  }

  const cleanData = [];
  for (const quote of result.quotes) {
    // adjclose incorpora dividendos y splits: el backtest mide retorno total, no solo precio
    const price = quote.adjclose ?? quote.close;
    if (price !== null && price !== undefined) {
      cleanData.push({
        date: quote.date.toISOString().split('T')[0],
        timestamp: quote.date.getTime() / 1000,
        price
      });
    }
  }

  return cleanData;
}

// S&P 500 Total Return: incluye dividendos reinvertidos, comparable con adjclose del activo
const BENCHMARK = '^SP500TR';

export async function POST(request: Request) {
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

    const interval = years > 2 ? '1wk' : '1d';

    const [targetData, benchmarkData] = await Promise.all([
      fetchHistoricalData(ticker, years, interval),
      fetchHistoricalData(BENCHMARK, years, interval)
    ]);

    if (targetData.length === 0 || benchmarkData.length === 0) {
      return NextResponse.json({ error: 'No se encontraron suficientes datos históricos' }, { status: 400 });
    }

    // Align dates
    // Create a map of benchmark dates to prices
    const benchmarkMap = new Map(benchmarkData.map(d => [d.date, d.price]));

    const chartData = [];
    let initialTargetPrice = 0;
    let initialBenchmarkPrice = 0;

    // Find the first date where both have data to set baseline
    for (const d of targetData) {
      if (benchmarkMap.has(d.date)) {
        initialTargetPrice = d.price;
        initialBenchmarkPrice = benchmarkMap.get(d.date)!;
        break;
      }
    }

    if (initialTargetPrice === 0 || initialBenchmarkPrice === 0) {
      return NextResponse.json({ error: 'No se pudieron alinear las fechas de ambos activos' }, { status: 400 });
    }

    // Calculate portfolio values
    // Target shares bought at day 0
    const targetShares = capital / initialTargetPrice;
    // Benchmark shares bought at day 0
    const benchmarkShares = capital / initialBenchmarkPrice;

    let maxDrawdown = 0;
    let peak = capital;

    for (const d of targetData) {
      if (benchmarkMap.has(d.date)) {
        const currentTargetValue = d.price * targetShares;
        const currentBenchmarkValue = benchmarkMap.get(d.date)! * benchmarkShares;

        // Drawdown calculation
        if (currentTargetValue > peak) {
          peak = currentTargetValue;
        }
        const drawdown = (peak - currentTargetValue) / peak;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }

        chartData.push({
          date: d.date,
          Estrategia: Number(currentTargetValue.toFixed(2)),
          SP500: Number(currentBenchmarkValue.toFixed(2))
        });
      }
    }

    if (chartData.length === 0) {
      return NextResponse.json({ error: 'Error procesando la serie de tiempo' }, { status: 500 });
    }

    const finalTargetValue = chartData[chartData.length - 1].Estrategia;
    const finalBenchmarkValue = chartData[chartData.length - 1].SP500;

    const targetReturn = ((finalTargetValue - capital) / capital) * 100;
    const benchmarkReturn = ((finalBenchmarkValue - capital) / capital) * 100;

    return NextResponse.json({
      chartData,
      metrics: {
        targetReturn,
        benchmarkReturn,
        finalTargetValue,
        finalBenchmarkValue,
        maxDrawdown: maxDrawdown * 100
      }
    });

  } catch (err: unknown) {
    console.error('API Backtest Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}
