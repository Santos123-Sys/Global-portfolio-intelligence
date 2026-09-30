export function technicalIndicators(rows: Array<{ close: number; volume?: number | null }>) {
  const prices = rows.map(row => row.close);
  if (prices.some(p => !Number.isFinite(p) || p <= 0)) throw new Error('Invalid prices');
  const average = (a: number[]) => a.reduce((s,v) => s+v,0)/a.length;
  const sma = (n: number) => prices.length >= n ? average(prices.slice(-n)) : null;
  const ema = (n: number) => {
    if (prices.length < n) return [];
    const result = [average(prices.slice(0,n))];
    for (let i=n;i<prices.length;i++) result.push(prices[i]*2/(n+1)+result.at(-1)!*(1-2/(n+1)));
    return result;
  };
  let rsi14: number | null = null;
  if (prices.length >= 15) {
    const changes = prices.slice(1).map((p,i) => p-prices[i]);
    let gain=average(changes.slice(0,14).map(v=>Math.max(v,0))), loss=average(changes.slice(0,14).map(v=>Math.max(-v,0)));
    changes.slice(14).forEach(v=>{ gain=(gain*13+Math.max(v,0))/14; loss=(loss*13+Math.max(-v,0))/14; });
    rsi14 = loss===0 ? gain===0 ? 50 : 100 : 100-100/(1+gain/loss);
  }
  const slow=ema(26), fast=ema(12).slice(14), macdSeries=slow.map((v,i)=>fast[i]-v);
  let signal: number | null = null;
  if (macdSeries.length>=9) { signal=average(macdSeries.slice(0,9)); macdSeries.slice(9).forEach(v=>{ signal=v*.2+signal!*.8; }); }
  const mid=sma(20), sigma=mid==null ? null : Math.sqrt(average(prices.slice(-20).map(v=>(v-mid)**2)));
  const volumes=rows.slice(-20).map(row=>row.volume);
  const volumeAvailable = volumes.length===20 && volumes.every(v=>v!=null && Number.isFinite(v) && v>=0);
  const macd=macdSeries.at(-1) ?? null;
  return { observations: prices.length, latestPrice: prices.at(-1) ?? null, sma20: mid, sma50: sma(50), sma200: sma(200), rsi14,
    macd, macdSignal: signal, macdHistogram: macd!=null && signal!=null ? macd-signal : null,
    bollinger: mid!=null && sigma!=null ? { middle: mid, upper: mid+2*sigma, lower: mid-2*sigma } : null,
    averageVolume20: volumeAvailable ? average(volumes as number[]) : null,
    support: prices.length ? Math.min(...prices.slice(-60)) : null, resistance: prices.length ? Math.max(...prices.slice(-60)) : null,
    methodology: 'Wilder RSI(14); EMA MACD(12,26,9); population-standard-deviation Bollinger(20,2); daily unadjusted closes unless upstream adjusts.' };
}
