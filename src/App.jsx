import { useState, useRef } from "react";

const SYSTEM_PROMPT = `You are an expert trading analyst and technical analysis specialist. When given a trading chart image, analyze it thoroughly and provide:

1. **Chart Pattern**: Identify the candlestick patterns, chart patterns (head & shoulders, triangles, flags, etc.)
2. **Trend Analysis**: Current trend direction (uptrend/downtrend/sideways)
3. **Support & Resistance**: Key levels visible on the chart
4. **Indicators**: Any visible indicators (RSI, MACD, Moving Averages, Bollinger Bands, etc.) and their signals
5. **Volume Analysis**: Volume trend if visible
6. **Next Move Prediction**: Clear BUY / SELL / HOLD recommendation with confidence level (%)
7. **Entry Price**: Suggested entry point
8. **Stop Loss**: Recommended stop loss level
9. **Take Profit**: Target price levels (TP1, TP2)
10. **Risk/Reward Ratio**: Calculate R:R ratio
11. **Reasoning**: Brief explanation of why this trade setup

Format your response in clear sections. Be direct and specific. Always mention the timeframe if visible. Provide the BUY/SELL/HOLD signal prominently at the top.

IMPORTANT: Always start your response with a clear signal box like:
🟢 BUY | 🔴 SELL | 🟡 HOLD
followed by confidence percentage.`;

export default function TradingAnalyzer() {
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageType, setImageType] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const processFile = (file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Sirf image file upload karo (PNG, JPG, WEBP)");
      return;
    }
    setError(null);
    setAnalysis(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImage(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
      setImageType(file.type);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e) => processFile(e.target.files[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const analyzeChart = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: imageType,
                    data: imageBase64,
                  },
                },
                {
                  type: "text",
                  text: "Analyze this trading chart and give me a detailed BUY/SELL/HOLD signal with all technical analysis. Be specific about entry, stop loss, and take profit levels.",
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      setAnalysis(text);
    } catch (err) {
      setError("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getSignalColor = (text) => {
    if (!text) return "";
    const upper = text.toUpperCase();
    if (upper.includes("🟢") || upper.startsWith("BUY") || upper.includes("🟢 BUY")) return "buy";
    if (upper.includes("🔴") || upper.startsWith("SELL") || upper.includes("🔴 SELL")) return "sell";
    return "hold";
  };

  const signalType = getSignalColor(analysis);

  const formatAnalysis = (text) => {
    if (!text) return null;
    return text.split("\n").map((line, i) => {
      if (line.includes("🟢") || line.includes("🔴") || line.includes("🟡")) {
        return (
          <div key={i} className={`signal-badge signal-${signalType}`}>
            {line}
          </div>
        );
      }
      if (line.startsWith("**") && line.endsWith("**")) {
        return <h3 key={i} className="section-title">{line.replace(/\*\*/g, "")}</h3>;
      }
      if (line.match(/^\d+\.\s\*\*/) || line.startsWith("**")) {
        return <p key={i} className="bold-line">{line.replace(/\*\*/g, "")}</p>;
      }
      if (line.trim() === "") return <br key={i} />;
      return <p key={i} className="normal-line">{line}</p>;
    });
  };

  return (
    <div className="app">
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0e1a; }

        .app {
          min-height: 100vh;
          background: linear-gradient(135deg, #0a0e1a 0%, #0d1526 50%, #0a1520 100%);
          font-family: 'Segoe UI', system-ui, sans-serif;
          color: #e2e8f0;
          padding: 20px;
        }

        .header {
          text-align: center;
          padding: 32px 20px 24px;
        }

        .header-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 20px;
          padding: 6px 16px;
          font-size: 12px;
          color: #10b981;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 16px;
        }

        .header h1 {
          font-size: clamp(24px, 5vw, 42px);
          font-weight: 800;
          background: linear-gradient(135deg, #10b981, #3b82f6, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1.2;
          margin-bottom: 10px;
        }

        .header p {
          color: #64748b;
          font-size: 14px;
        }

        .card {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px;
          padding: 24px;
          margin: 0 auto 20px;
          max-width: 800px;
          backdrop-filter: blur(10px);
        }

        .card-title {
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .drop-zone {
          border: 2px dashed rgba(59, 130, 246, 0.3);
          border-radius: 12px;
          padding: 40px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s;
          background: rgba(59, 130, 246, 0.03);
        }

        .drop-zone:hover, .drop-zone.active {
          border-color: rgba(59, 130, 246, 0.7);
          background: rgba(59, 130, 246, 0.08);
        }

        .drop-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }

        .drop-text {
          color: #94a3b8;
          font-size: 14px;
          margin-bottom: 8px;
        }

        .drop-hint {
          color: #475569;
          font-size: 12px;
        }

        .preview-container {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .preview-img {
          width: 100%;
          max-height: 400px;
          object-fit: contain;
          display: block;
          background: #000;
        }

        .change-btn {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(0,0,0,0.7);
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          padding: 6px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
        }

        .analyze-btn {
          width: 100%;
          padding: 16px;
          border-radius: 12px;
          border: none;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 16px;
        }

        .analyze-btn:not(:disabled) {
          background: linear-gradient(135deg, #10b981, #059669);
          color: white;
          box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3);
        }

        .analyze-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(16, 185, 129, 0.4);
        }

        .analyze-btn:disabled {
          background: rgba(255,255,255,0.05);
          color: #475569;
          cursor: not-allowed;
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .loading-text {
          text-align: center;
          padding: 20px;
          color: #64748b;
          font-size: 14px;
        }

        .loading-dots::after {
          content: '';
          animation: dots 1.5s infinite;
        }

        @keyframes dots {
          0% { content: '.'; }
          33% { content: '..'; }
          66% { content: '...'; }
        }

        .error-box {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 10px;
          padding: 14px;
          color: #f87171;
          font-size: 13px;
          margin-top: 12px;
        }

        .result-card {
          background: rgba(15, 23, 42, 0.9);
          border-radius: 16px;
          padding: 24px;
          max-width: 800px;
          margin: 0 auto;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .result-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .result-title {
          font-size: 15px;
          font-weight: 700;
          color: #e2e8f0;
        }

        .signal-badge {
          display: inline-block;
          font-size: 22px;
          font-weight: 800;
          padding: 12px 24px;
          border-radius: 12px;
          margin: 8px 0 16px;
          letter-spacing: 1px;
        }

        .signal-buy { background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; color: #10b981; }
        .signal-sell { background: rgba(239, 68, 68, 0.15); border: 2px solid #ef4444; color: #ef4444; }
        .signal-hold { background: rgba(234, 179, 8, 0.15); border: 2px solid #eab308; color: #eab308; }

        .section-title {
          font-size: 14px;
          font-weight: 700;
          color: #3b82f6;
          margin: 16px 0 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .bold-line {
          color: #cbd5e1;
          font-weight: 600;
          font-size: 13px;
          margin: 4px 0;
          line-height: 1.6;
        }

        .normal-line {
          color: #94a3b8;
          font-size: 13px;
          margin: 3px 0;
          line-height: 1.7;
        }

        .footer {
          text-align: center;
          padding: 20px;
          color: #334155;
          font-size: 11px;
          max-width: 800px;
          margin: 0 auto;
        }

        input[type="file"] { display: none; }
      `}</style>

      <div className="header">
        <div className="header-badge">
          <span>📊</span> AI Powered
        </div>
        <h1>Trading Chart Analyzer</h1>
        <p>Chart upload karo — AI Buy/Sell/Hold signal dega</p>
      </div>

      <div className="card">
        <div className="card-title">
          <span>📈</span> Chart Upload
        </div>

        {!image ? (
          <div
            className={`drop-zone ${dragOver ? "active" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="drop-icon">📉</div>
            <div className="drop-text">Chart image yahan drop karo ya click karo</div>
            <div className="drop-hint">PNG, JPG, WEBP supported • TradingView screenshot best hai</div>
          </div>
        ) : (
          <div className="preview-container">
            <img src={image} alt="Chart" className="preview-img" />
            <button className="change-btn" onClick={() => { setImage(null); setAnalysis(null); }}>
              ✕ Change
            </button>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} />

        <button
          className="analyze-btn"
          onClick={analyzeChart}
          disabled={!image || loading}
        >
          {loading ? (
            <>
              <div className="spinner" />
              Analyzing...
            </>
          ) : (
            <>
              <span>🔍</span> Analyze Chart & Predict
            </>
          )}
        </button>

        {loading && (
          <div className="loading-text">
            AI chart analyze kar raha hai<span className="loading-dots" />
          </div>
        )}

        {error && <div className="error-box">⚠️ {error}</div>}
      </div>

      {analysis && (
        <div className="result-card">
          <div className="result-header">
            <span>🤖</span>
            <span className="result-title">AI Analysis Result</span>
          </div>
          <div>{formatAnalysis(analysis)}</div>
        </div>
      )}

      <div className="footer">
        ⚠️ Yeh sirf educational analysis hai. Trading apni responsibility pe karo. Past performance future results guarantee nahi karta.
      </div>
    </div>
  );
}
