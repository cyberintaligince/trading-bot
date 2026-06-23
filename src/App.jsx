import { useState, useEffect, useRef, useCallback } from "react";

// ── Binance symbols map ──────────────────────────────────────────────────────
const PAIRS = ["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT"];
const toBinanceSymbol = (pair) => pair.replace("/", "").toLowerCase();
const toDisplaySymbol = (pair) => pair.replace("/", "");

// ── Technical Indicators ─────────────────────────────────────────────────────
function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = gains / (losses || 0.0001);
  return Math.round(100 - 100 / (1 + rs));
}

function calcEMA(candles, period) {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) ema = candles[i].close * k + ema * (1 - k);
  return ema;
}

function calcMACD(candles) {
  if (candles.length < 26) return { macd: "0.00", signal: "0.00", hist: "0.00" };
  const ema12 = calcEMA(candles, 12);
  const ema26 = calcEMA(candles, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.9;
  return { macd: macd.toFixed(4), signal: signal.toFixed(4), hist: (macd - signal).toFixed(4) };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TradingBot() {
  const [selectedPair, setSelectedPair] = useState("BTC/USDT");
  const [candles, setCandles] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange24h, setPriceChange24h] = useState(0);
  const [volume24h, setVolume24h] = useState(0);
  const [wsStatus, setWsStatus] = useState("connecting"); // connecting | live | error
  const [portfolio, setPortfolio] = useState({ USDT: 10000, holdings: {} });
  const [trades, setTrades] = useState([]);
  const [aiLog, setAiLog] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const wsRef = useRef(null);
  const autoRef = useRef(null);
  const logRef = useRef(null);
  const candlesRef = useRef([]);
  const priceRef = useRef(null);
  const portfolioRef = useRef(portfolio);

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { priceRef.current = currentPrice; }, [currentPrice]);

  // ── Fetch historical klines from Binance REST API ─────────────────────────
  const fetchKlines = useCallback(async (pair) => {
    const symbol = toDisplaySymbol(pair);
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=50`
      );
      if (!res.ok) throw new Error("Binance REST error");
      const data = await res.json();
      const parsed = data.map((k) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      setCandles(parsed);
      candlesRef.current = parsed;
      setCurrentPrice(parsed[parsed.length - 1].close);
      priceRef.current = parsed[parsed.length - 1].close;
    } catch (e) {
      setWsStatus("error");
    }
  }, []);

  // ── Fetch 24h ticker stats ────────────────────────────────────────────────
  const fetch24hStats = useCallback(async (pair) => {
    const symbol = toDisplaySymbol(pair);
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
      );
      const data = await res.json();
      setPriceChange24h(parseFloat(data.priceChangePercent));
      setVolume24h(parseFloat(data.volume));
    } catch (_) {}
  }, []);

  // ── WebSocket for real-time candle updates ────────────────────────────────
  const connectWS = useCallback((pair) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsStatus("connecting");
    const symbol = toBinanceSymbol(pair);
    const ws = new WebSocket(
      `wss://stream.binance.com:9443/stream?streams=${symbol}@kline_1m/${symbol}@ticker`
    );
    wsRef.current = ws;

    ws.onopen = () => setWsStatus("live");

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const stream = msg.stream || "";

        if (stream.includes("@kline")) {
          const k = msg.data.k;
          const candle = {
            time: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          setCurrentPrice(candle.close);
          priceRef.current = candle.close;
          setLastUpdate(new Date().toLocaleTimeString());
          setCandles((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.time === candle.time) {
              const updated = [...prev.slice(0, -1), candle];
              candlesRef.current = updated;
              return updated;
            }
            const updated = [...prev.slice(-49), candle];
            candlesRef.current = updated;
            return updated;
          });
        }

        if (stream.includes("@ticker")) {
          const d = msg.data;
          setPriceChange24h(parseFloat(d.P));
          setVolume24h(parseFloat(d.v));
        }
      } catch (_) {}
    };

    ws.onerror = () => setWsStatus("error");
    ws.onclose = () => {
      if (wsStatus !== "error") setWsStatus("connecting");
    };
  }, []);

  // ── Switch pair ───────────────────────────────────────────────────────────
  useEffect(() => {
    setCandles([]);
    setCurrentPrice(null);
    setWsStatus("connecting");
    fetchKlines(selectedPair);
    fetch24hStats(selectedPair);
    connectWS(selectedPair);
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [selectedPair]);

  // ── Auto-mode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoMode) {
      autoRef.current = setInterval(() => runAIAnalysis(), 20000);
    } else {
      clearInterval(autoRef.current);
    }
    return () => clearInterval(autoRef.current);
  }, [autoMode]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [aiLog]);

  // ── AI Analysis ───────────────────────────────────────────────────────────
  const runAIAnalysis = async () => {
    if (isAnalyzing) return;
    const cdls = candlesRef.current;
    const price = priceRef.current;
    const port = portfolioRef.current;
    if (!price || cdls.length < 15) {
      addLog({ action: "WAIT", reason: "Loading Binance data... please wait a moment.", confidence: 0, risk: "LOW", time: new Date().toLocaleTimeString() });
      return;
    }
    setIsAnalyzing(true);

    const rsi = calcRSI(cdls);
    const macd = calcMACD(cdls);
    const ema9 = calcEMA(cdls, 9).toFixed(4);
    const ema21 = calcEMA(cdls, 21).toFixed(4);
    const last5 = cdls.slice(-5).map((c) => c.close.toFixed(4)).join(", ");
    const avgVol = (cdls.slice(-10).reduce((s, c) => s + c.volume, 0) / 10).toFixed(2);
    const coin = selectedPair.split("/")[0];
    const holding = port.holdings[coin] || 0;

    const prompt = `You are an expert crypto trading AI. Analyze REAL Binance market data for ${selectedPair}.

LIVE BINANCE DATA:
- Current Price: $${price.toFixed(4)}
- 24h Change: ${priceChange24h.toFixed(2)}%
- 24h Volume: ${volume24h.toFixed(2)} ${coin}
- Last 5 x 1min Closes: ${last5}
- RSI (14): ${rsi}
- MACD: ${macd.macd} | Signal: ${macd.signal} | Histogram: ${macd.hist}
- EMA9: $${ema9} | EMA21: $${ema21}
- Avg Volume (10 candles): ${avgVol}

PAPER PORTFOLIO:
- USDT Balance: $${port.USDT.toFixed(2)}
- ${coin} Holdings: ${holding.toFixed(6)} (~$${(holding * price).toFixed(2)})

Based on REAL market data, respond ONLY in this exact JSON:
{
  "action": "BUY" or "SELL" or "HOLD",
  "confidence": 1-100,
  "amount_pct": 10-30,
  "reason": "2-3 sentence analysis referencing actual indicator values",
  "risk": "LOW" or "MEDIUM" or "HIGH",
  "target": price_number,
  "stop_loss": price_number
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "AQ.Ab8RN6IULC1WO-AnQAnztzZuAUBVmApXsxTBjCCzDolC7EqkPQ",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = await res.json();
      const text = json.content?.[0]?.text || "{}";
      const clean = text.replace(/```json|```/g, "").trim();
      const decision = JSON.parse(clean);
      executeTrade(decision, price, coin, port);
    } catch (e) {
      addLog({
        action: "ERROR",
        reason: `API error: ${e.message}. Check your API key in the code.`,
        confidence: 0,
        risk: "HIGH",
        time: new Date().toLocaleTimeString(),
      });
    }
    setIsAnalyzing(false);
  };

  const executeTrade = (decision, price, coin, port) => {
    const time = new Date().toLocaleTimeString();
    let tradeInfo = null;

    setPortfolio((prev) => {
      const pct = (decision.amount_pct || 20) / 100;
      if (decision.action === "BUY" && prev.USDT > 10) {
        const spend = Math.min(prev.USDT * pct, prev.USDT - 1);
        const bought = spend / price;
        tradeInfo = { action: "BUY", amount: bought.toFixed(6), coin, price: price.toFixed(4), usdt: spend.toFixed(2) };
        return { ...prev, USDT: prev.USDT - spend, holdings: { ...prev.holdings, [coin]: (prev.holdings[coin] || 0) + bought } };
      } else if (decision.action === "SELL" && (prev.holdings[coin] || 0) > 0) {
        const sellAmt = prev.holdings[coin] * pct;
        const earned = sellAmt * price;
        tradeInfo = { action: "SELL", amount: sellAmt.toFixed(6), coin, price: price.toFixed(4), usdt: earned.toFixed(2) };
        const newH = { ...prev.holdings, [coin]: prev.holdings[coin] - sellAmt };
        if (newH[coin] < 0.000001) delete newH[coin];
        return { ...prev, USDT: prev.USDT + earned, holdings: newH };
      }
      return prev;
    });

    if (tradeInfo) {
      setTrades((prev) => [{ ...tradeInfo, time, target: decision.target, stop: decision.stop_loss, confidence: decision.confidence }, ...prev.slice(0, 19)]);
    }
    addLog({ ...decision, time, executed: !!tradeInfo, tradeInfo });
  };

  const addLog = (entry) => setAiLog((prev) => [...prev.slice(-50), entry]);

  const getTotalValue = () => {
    let total = portfolio.USDT;
    for (const [coin, amt] of Object.entries(portfolio.holdings)) {
      total += amt * (currentPrice || 0);
    }
    return total;
  };

  const pnl = getTotalValue() - 10000;
  const pnlPct = (pnl / 10000) * 100;
  const rsi = calcRSI(candles);
  const macd = calcMACD(candles);
  const ema9 = candles.length > 9 ? calcEMA(candles, 9) : 0;
  const ema21 = candles.length > 21 ? calcEMA(candles, 21) : 0;

  const maxH = candles.length ? Math.max(...candles.map((c) => c.high)) : 1;
  const minL = candles.length ? Math.min(...candles.map((c) => c.low)) : 0;
  const range = maxH - minL || 1;

  const statusColor = wsStatus === "live" ? "#00ff88" : wsStatus === "error" ? "#ff4466" : "#ffd700";
  const statusLabel = wsStatus === "live" ? "LIVE" : wsStatus === "error" ? "ERROR" : "CONNECTING...";

  return (
    <div style={{ background: "#0a0e1a", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>

      {/* ── Top Bar ── */}
      <div style={{ background: "#0d1321", borderBottom: "1px solid #1e2d4a", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusColor, boxShadow: `0 0 8px ${statusColor}`, animation: wsStatus === "live" ? "pulse 2s infinite" : "none" }} />
          <span style={{ color: "#00ff88", fontSize: "14px", fontWeight: "700", letterSpacing: "2px" }}>AI TRADING BOT</span>
          <span style={{ color: statusColor, fontSize: "10px", letterSpacing: "1px" }}>BINANCE {statusLabel}</span>
          {lastUpdate && <span style={{ color: "#2d4a6a", fontSize: "10px" }}>Updated: {lastUpdate}</span>}
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {PAIRS.map((pair) => (
            <button key={pair} onClick={() => setSelectedPair(pair)}
              style={{ background: selectedPair === pair ? "#1a3a5c" : "transparent", border: `1px solid ${selectedPair === pair ? "#00aaff" : "#1e2d4a"}`, color: selectedPair === pair ? "#00aaff" : "#718096", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" }}>
              {pair}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", minHeight: "calc(100vh - 53px)" }}>
        {/* ── Left Main ── */}
        <div style={{ padding: "16px", borderRight: "1px solid #1e2d4a" }}>

          {/* Price Header */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "30px", fontWeight: "800", color: "#fff", letterSpacing: "-1px" }}>
                {currentPrice ? (currentPrice < 1 ? `$${currentPrice.toFixed(5)}` : `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : "Loading..."}
              </div>
              <div style={{ fontSize: "12px", color: "#4a5568" }}>
                {selectedPair} · Binance Real-Time
              </div>
            </div>
            {currentPrice && (
              <div style={{ color: priceChange24h >= 0 ? "#00ff88" : "#ff4466", fontSize: "16px", fontWeight: "600" }}>
                {priceChange24h >= 0 ? "▲" : "▼"} {Math.abs(priceChange24h).toFixed(2)}% (24h)
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              <button onClick={runAIAnalysis} disabled={isAnalyzing || !currentPrice}
                style={{ background: isAnalyzing ? "#1a2a3a" : "linear-gradient(135deg,#0066cc,#0044aa)", border: "none", color: "#fff", padding: "8px 18px", borderRadius: "6px", cursor: isAnalyzing ? "not-allowed" : "pointer", fontSize: "12px", fontFamily: "inherit", fontWeight: "700", letterSpacing: "1px", opacity: !currentPrice ? 0.5 : 1 }}>
                {isAnalyzing ? "⟳ ANALYZING..." : "⚡ ANALYZE NOW"}
              </button>
              <button onClick={() => setAutoMode((p) => !p)}
                style={{ background: autoMode ? "#1a3a2a" : "#1a2a1a", border: `1px solid ${autoMode ? "#00ff88" : "#2d4a2d"}`, color: autoMode ? "#00ff88" : "#4a6a4a", padding: "8px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontFamily: "inherit" }}>
                {autoMode ? "■ STOP AUTO" : "▶ AUTO (20s)"}
              </button>
            </div>
          </div>

          {/* Candlestick Chart */}
          <div style={{ background: "#0d1321", border: "1px solid #1e2d4a", borderRadius: "8px", padding: "12px", marginBottom: "14px" }}>
            <div style={{ fontSize: "10px", color: "#4a5568", marginBottom: "8px", letterSpacing: "1px" }}>
              1MIN CANDLES · BINANCE LIVE · {candles.length} candles
            </div>
            {candles.length < 3 ? (
              <div style={{ height: "160px", display: "flex", alignItems: "center", justifyContent: "center", color: "#2d4a6a", fontSize: "12px" }}>
                ⟳ Fetching Binance candle data...
              </div>
            ) : (
              <svg width="100%" height="160" viewBox={`0 0 ${candles.length * 14} 160`} preserveAspectRatio="none">
                {candles.map((c, i) => {
                  const x = i * 14 + 7;
                  const nH = 155 - ((c.high - minL) / range) * 150;
                  const nL = 155 - ((c.low - minL) / range) * 150;
                  const nO = 155 - ((c.open - minL) / range) * 150;
                  const nC = 155 - ((c.close - minL) / range) * 150;
                  const bull = c.close >= c.open;
                  const col = bull ? "#00ff88" : "#ff4466";
                  return (
                    <g key={i}>
                      <line x1={x} y1={nH} x2={x} y2={nL} stroke={col} strokeWidth="1" opacity="0.5" />
                      <rect x={x - 4} y={Math.min(nO, nC)} width="8" height={Math.max(Math.abs(nO - nC), 1)} fill={col} rx="1" />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {/* Indicators */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", marginBottom: "14px" }}>
            {[
              { label: "RSI (14)", value: rsi, color: rsi > 70 ? "#ff4466" : rsi < 30 ? "#00ff88" : "#ffd700", sub: rsi > 70 ? "OVERBOUGHT" : rsi < 30 ? "OVERSOLD" : "NEUTRAL" },
              { label: "MACD", value: macd.macd, color: parseFloat(macd.macd) >= 0 ? "#00ff88" : "#ff4466", sub: `SIG: ${macd.signal}` },
              { label: "EMA 9/21", value: ema9 > ema21 && ema9 > 0 ? "BULLISH" : "BEARISH", color: ema9 > ema21 && ema9 > 0 ? "#00ff88" : "#ff4466", sub: ema9 > 0 ? `${ema9.toFixed(2)}/${ema21.toFixed(2)}` : "Loading..." },
              { label: "VOL 24H", value: volume24h > 1000 ? `${(volume24h / 1000).toFixed(1)}K` : volume24h.toFixed(1), color: "#00aaff", sub: selectedPair.split("/")[0] },
            ].map((ind, i) => (
              <div key={i} style={{ background: "#0d1321", border: "1px solid #1e2d4a", borderRadius: "6px", padding: "10px" }}>
                <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "1px", marginBottom: "4px" }}>{ind.label}</div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: ind.color }}>{ind.value}</div>
                <div style={{ fontSize: "10px", color: "#718096", marginTop: "2px" }}>{ind.sub}</div>
              </div>
            ))}
          </div>

          {/* AI Log */}
          <div style={{ background: "#0d1321", border: "1px solid #1e2d4a", borderRadius: "8px", padding: "12px" }}>
            <div style={{ fontSize: "11px", color: "#4a5568", letterSpacing: "1px", marginBottom: "10px" }}>🤖 AI DECISION LOG · REAL BINANCE DATA</div>
            <div ref={logRef} style={{ maxHeight: "260px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {aiLog.length === 0 && (
                <div style={{ color: "#2d4a6a", fontSize: "12px", textAlign: "center", padding: "30px 0" }}>
                  Binance data loaded ✓ — Press "ANALYZE NOW" for AI signal
                </div>
              )}
              {aiLog.map((log, i) => (
                <div key={i} style={{ background: "#0a0e1a", border: `1px solid ${log.action === "BUY" ? "#003322" : log.action === "SELL" ? "#330011" : "#1e2d4a"}`, borderLeft: `3px solid ${log.action === "BUY" ? "#00ff88" : log.action === "SELL" ? "#ff4466" : log.action === "ERROR" ? "#ff8800" : "#ffd700"}`, borderRadius: "4px", padding: "8px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ color: log.action === "BUY" ? "#00ff88" : log.action === "SELL" ? "#ff4466" : log.action === "ERROR" ? "#ff8800" : "#ffd700", fontWeight: "700", fontSize: "12px" }}>
                      {log.action} {log.confidence ? `(${log.confidence}% conf)` : ""}
                    </span>
                    <span style={{ color: "#4a5568", fontSize: "10px" }}>{log.time}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#94a3b8", lineHeight: "1.6" }}>{log.reason}</div>
                  {log.risk && log.action !== "ERROR" && (
                    <div style={{ fontSize: "10px", color: log.risk === "LOW" ? "#00ff88" : log.risk === "HIGH" ? "#ff4466" : "#ffd700", marginTop: "4px" }}>
                      RISK: {log.risk}
                      {log.target ? ` | TARGET: $${parseFloat(log.target).toFixed(4)}` : ""}
                      {log.stop_loss ? ` | STOP: $${parseFloat(log.stop_loss).toFixed(4)}` : ""}
                    </div>
                  )}
                  {log.executed && log.tradeInfo && (
                    <div style={{ fontSize: "10px", color: "#00aaff", marginTop: "4px" }}>
                      ✓ EXECUTED: {log.tradeInfo.action} {log.tradeInfo.amount} {log.tradeInfo.coin} @ ${log.tradeInfo.price}
                    </div>
                  )}
                  {!log.executed && log.action !== "HOLD" && log.action !== "ERROR" && log.action !== "WAIT" && (
                    <div style={{ fontSize: "10px", color: "#4a5568", marginTop: "4px" }}>⚠ Not executed (insufficient balance/holdings)</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Portfolio */}
          <div style={{ background: "#0d1321", border: "1px solid #1e2d4a", borderRadius: "8px", padding: "14px" }}>
            <div style={{ fontSize: "11px", color: "#4a5568", letterSpacing: "1px", marginBottom: "10px" }}>PAPER PORTFOLIO</div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#fff" }}>${getTotalValue().toFixed(2)}</div>
            <div style={{ color: pnl >= 0 ? "#00ff88" : "#ff4466", fontSize: "13px", marginBottom: "12px" }}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span style={{ color: "#718096" }}>USDT (free)</span>
                <span style={{ color: "#e2e8f0" }}>${portfolio.USDT.toFixed(2)}</span>
              </div>
              {Object.entries(portfolio.holdings).filter(([, amt]) => amt > 0.000001).map(([coin, amt]) => (
                <div key={coin} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span style={{ color: "#718096" }}>{coin}</span>
                  <span style={{ color: "#00aaff" }}>{amt.toFixed(6)}<br />
                    <span style={{ color: "#4a5568", fontSize: "10px" }}>${(amt * (currentPrice || 0)).toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => { setPortfolio({ USDT: 10000, holdings: {} }); setTrades([]); setAiLog([]); }}
              style={{ marginTop: "12px", width: "100%", background: "transparent", border: "1px solid #1e2d4a", color: "#4a5568", padding: "6px", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>
              RESET PORTFOLIO
            </button>
          </div>

          {/* Connection Info */}
          <div style={{ background: "#0d1321", border: `1px solid ${wsStatus === "live" ? "#003322" : "#1e2d4a"}`, borderRadius: "8px", padding: "12px" }}>
            <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "1px", marginBottom: "8px" }}>DATA SOURCE</div>
            <div style={{ fontSize: "11px", color: "#718096", lineHeight: "1.8" }}>
              <div>📡 <span style={{ color: statusColor }}>{statusLabel}</span> WebSocket</div>
              <div>📊 REST: Historical klines</div>
              <div>🔄 Interval: 1 min candles</div>
              <div>🌐 api.binance.com</div>
            </div>
          </div>

          {/* Trade History */}
          <div style={{ background: "#0d1321", border: "1px solid #1e2d4a", borderRadius: "8px", padding: "14px", flex: 1 }}>
            <div style={{ fontSize: "11px", color: "#4a5568", letterSpacing: "1px", marginBottom: "10px" }}>TRADE HISTORY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "350px", overflowY: "auto" }}>
              {trades.length === 0 && (
                <div style={{ color: "#2d4a6a", fontSize: "11px", textAlign: "center", padding: "20px 0" }}>No trades yet</div>
              )}
              {trades.map((t, i) => (
                <div key={i} style={{ background: "#0a0e1a", borderRadius: "4px", padding: "8px", borderLeft: `2px solid ${t.action === "BUY" ? "#00ff88" : "#ff4466"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: t.action === "BUY" ? "#00ff88" : "#ff4466", fontSize: "11px", fontWeight: "700" }}>{t.action}</span>
                    <span style={{ color: "#4a5568", fontSize: "10px" }}>{t.time}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {t.amount} {t.coin} @ ${parseFloat(t.price) < 1 ? parseFloat(t.price).toFixed(5) : parseFloat(t.price).toFixed(2)}
                  </div>
                  <div style={{ fontSize: "10px", color: "#718096" }}>≈ ${t.usdt} USDT · {t.confidence}% conf</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0a0e1a}
        ::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px}
      `}</style>
    </div>
  );
}
