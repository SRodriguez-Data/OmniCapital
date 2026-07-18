import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchHistoricalData(ticker: string, years: number, interval: '1d' | '1wk' | '1mo') {
  const period2 = new Date();
  const period1 = new Date();
  period1.setFullYear(period2.getFullYear() - years);

  const result: any = await yahooFinance.chart(ticker, {
    period1: period1,
    period2: period2,
    interval: interval
  });

  if (!result || !result.quotes || result.quotes.length === 0) {
    throw new Error(`No data available for ${ticker}`);
  }

  const cleanData = [];
  for (const quote of result.quotes) {
    if (quote.close !== null && quote.close !== undefined) {
      cleanData.push({
        date: quote.date.toISOString().split('T')[0],
        timestamp: quote.date.getTime() / 1000,
        price: quote.close
      });
    }
  }

  return cleanData;
}

export async function POST(request: Request) {
  try {
    const { ticker, capital, years } = await request.json();

    if (!ticker || !capital || !years) {
      return NextResponse.json({ error: 'Faltan parámetros (ticker, capital, years)' }, { status: 400 });
    }

    const interval = years > 2 ? '1wk' : '1d';

    // Fetch data for target ticker and S&P 500 benchmark
    const [targetData, benchmarkData] = await Promise.all([
      fetchHistoricalData(ticker, years, interval),
      fetchHistoricalData('^GSPC', years, interval)
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

    let targetMax = capital;
    let targetMin = capital;
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

  } catch (err: any) {
    console.error('API Backtest Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
