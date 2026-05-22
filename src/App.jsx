import { useState, useRef, useCallback } from "react";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || "").trim().replace(/^"|"$/g, "");
    });
    return obj;
  });
}

function DropZone({ label, onFile, accept = ".csv,.xlsx,.txt", fileName }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);
  const handle = e => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0] || e.target.files[0];
    if (f) onFile(f);
  };
  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { setDrag(false); handle(e); }}
      style={{
        border: `2px dashed ${drag ? "#00d4ff" : "#2a3a4a"}`,
        borderRadius: 10,
        padding: "22px 18px",
        textAlign: "center",
        cursor: "pointer",
        background: drag ? "rgba(0,212,255,0.06)" : "rgba(255,255,255,0.02)",
        transition: "all 0.2s",
        minWidth: 180,
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={handle} />
      <div style={{ fontSize: 26, marginBottom: 6 }}>📂</div>
      <div style={{ fontSize: 12, color: fileName ? "#00d4ff" : "#7a8fa0", fontWeight: 600 }}>
        {fileName || label}
      </div>
      <div style={{ fontSize: 10, color: "#4a5a6a", marginTop: 4 }}>Click or drag & drop</div>
    </div>
  );
}

function Badge({ color, children }) {
  const colors = {
    green: { bg: "rgba(0,220,130,0.12)", text: "#00dc82" },
    red: { bg: "rgba(255,80,80,0.12)", text: "#ff5050" },
    yellow: { bg: "rgba(255,190,0,0.12)", text: "#ffbe00" },
    blue: { bg: "rgba(0,180,255,0.12)", text: "#00b4ff" },
    gray: { bg: "rgba(120,140,160,0.12)", text: "#78909c" },
  };
  const c = colors[color] || colors.gray;
  return (
    <span style={{
      background: c.bg, color: c.text, borderRadius: 6,
      padding: "2px 9px", fontSize: 11, fontWeight: 700, letterSpacing: 0.4
    }}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
      <div style={{
        width: 36, height: 36, border: "3px solid #1a2a3a",
        borderTop: "3px solid #00d4ff", borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Tab 1: Trip Verification ─────────────────────────────────────────────────

function TripVerification() {
  const [acceptedFile, setAcceptedFile] = useState(null);
  const [crmFile, setCrmFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const readFile = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(f);
  });

  const analyze = async () => {
    if (!acceptedFile || !crmFile) return;
    setLoading(true); setError(null); setResults(null);
    try {
      const [acceptedText, crmText] = await Promise.all([readFile(acceptedFile), readFile(crmFile)]);
      const prompt = `You are a trip reconciliation analyst. You will compare two datasets and find discrepancies.

ACCEPTED TRIPS FILE (trips that were accepted/dispatched):
${acceptedText.slice(0, 6000)}

CRM/BILLING FILE (trips in the CRM or billing system):
${crmText.slice(0, 6000)}

Your task:
1. Identify trips in ACCEPTED that are MISSING from CRM (revenue leak risk)
2. Identify trips in CRM that are MISSING from ACCEPTED (phantom billing risk)
3. Flag any trips with mismatched data (different times, mileage, amounts for same trip ID)
4. Provide a summary with counts

Match trips by trip ID, confirmation number, or any unique identifier you can find in both files. If no clear ID, match by date + driver + pickup location.

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "summary": {
    "accepted_total": number,
    "crm_total": number,
    "matched": number,
    "missing_from_crm": number,
    "missing_from_accepted": number,
    "mismatched": number
  },
  "missing_from_crm": [
    { "trip_id": "...", "date": "...", "driver": "...", "pickup": "...", "dropoff": "...", "amount": "..." }
  ],
  "missing_from_accepted": [
    { "trip_id": "...", "date": "...", "driver": "...", "pickup": "...", "dropoff": "...", "amount": "..." }
  ],
  "mismatched": [
    { "trip_id": "...", "field": "...", "accepted_value": "...", "crm_value": "...", "severity": "high|medium|low" }
  ],
  "insights": "Brief paragraph with key findings and recommended actions"
}`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await resp.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      setResults(JSON.parse(clean));
    } catch (e) {
      setError("Analysis failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: "#e8f0fe", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Trip Verification</h2>
        <p style={{ color: "#6a7f8e", fontSize: 13 }}>Upload your accepted trips list and CRM export — AI will identify missing, phantom, and mismatched trips.</p>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#7a8fa0", marginBottom: 8, fontWeight: 600 }}>ACCEPTED TRIPS</div>
          <DropZone label="Upload accepted trips CSV" onFile={setAcceptedFile} fileName={acceptedFile?.name} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#7a8fa0", marginBottom: 8, fontWeight: 600 }}>CRM / BILLING EXPORT</div>
          <DropZone label="Upload CRM export CSV" onFile={setCrmFile} fileName={crmFile?.name} />
        </div>
      </div>

      <button
        onClick={analyze}
        disabled={!acceptedFile || !crmFile || loading}
        style={{
          background: acceptedFile && crmFile ? "linear-gradient(135deg,#0050ff,#00d4ff)" : "#1a2535",
          color: acceptedFile && crmFile ? "#fff" : "#3a4a5a",
          border: "none", borderRadius: 8, padding: "11px 28px",
          fontWeight: 700, fontSize: 14, cursor: acceptedFile && crmFile ? "pointer" : "not-allowed",
          marginBottom: 24, transition: "all 0.2s"
        }}
      >
        {loading ? "Analyzing…" : "🔍 Run Verification"}
      </button>

      {loading && <Spinner />}
      {error && <div style={{ color: "#ff5050", background: "rgba(255,80,80,0.08)", padding: 14, borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {results && (
        <div>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Accepted", val: results.summary.accepted_total, color: "#00b4ff" },
              { label: "CRM Total", val: results.summary.crm_total, color: "#00b4ff" },
              { label: "Matched", val: results.summary.matched, color: "#00dc82" },
              { label: "Missing CRM", val: results.summary.missing_from_crm, color: "#ff5050" },
              { label: "Missing Accepted", val: results.summary.missing_from_accepted, color: "#ff9500" },
              { label: "Mismatched", val: results.summary.mismatched, color: "#ffbe00" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid #1a2535" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: "#5a7080", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Insights */}
          <div style={{ background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#00b4ff", fontWeight: 700, marginBottom: 6 }}>💡 AI INSIGHTS</div>
            <p style={{ fontSize: 13, color: "#c0d0e0", lineHeight: 1.6, margin: 0 }}>{results.insights}</p>
          </div>

          {/* Missing from CRM */}
          {results.missing_from_crm?.length > 0 && (
            <ResultTable title="⚠️ Missing from CRM" color="red" rows={results.missing_from_crm}
              cols={["trip_id","date","driver","pickup","dropoff","amount"]} />
          )}

          {/* Missing from Accepted */}
          {results.missing_from_accepted?.length > 0 && (
            <ResultTable title="🔴 Missing from Accepted (Phantom)" color="yellow" rows={results.missing_from_accepted}
              cols={["trip_id","date","driver","pickup","dropoff","amount"]} />
          )}

          {/* Mismatched */}
          {results.mismatched?.length > 0 && (
            <ResultTable title="🟡 Data Mismatches" color="yellow" rows={results.mismatched}
              cols={["trip_id","field","accepted_value","crm_value","severity"]} />
          )}
        </div>
      )}
    </div>
  );
}

function ResultTable({ title, color, rows, cols }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: color === "red" ? "#ff5050" : "#ffbe00", marginBottom: 10 }}>{title} ({rows.length})</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c} style={{ padding: "8px 12px", textAlign: "left", color: "#4a6070", borderBottom: "1px solid #1a2535", whiteSpace: "nowrap", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 }}>{c.replace(/_/g," ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #0f1820", background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                {cols.map(c => (
                  <td key={c} style={{ padding: "8px 12px", color: "#c0d0e0" }}>
                    {c === "severity" ? <Badge color={r[c]==="high"?"red":r[c]==="medium"?"yellow":"gray"}>{r[c]}</Badge> : (r[c] || "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab 2: Driver Expense Reconciliation ────────────────────────────────────

function ExpenseReconciliation() {
  const [receiptsFile, setReceiptsFile] = useState(null);
  const [bankFile, setBankFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [filterDriver, setFilterDriver] = useState("ALL");

  const readFile = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(f);
  });

  const analyze = async () => {
    if (!receiptsFile || !bankFile) return;
    setLoading(true); setError(null); setResults(null);
    try {
      const [receiptsText, bankText] = await Promise.all([readFile(receiptsFile), readFile(bankFile)]);
      const prompt = `You are a driver expense reconciliation specialist. Analyze these two files:

RECEIPTS FILE (expense receipts submitted by drivers):
${receiptsText.slice(0, 5000)}

BANK STATEMENT (actual bank transactions):
${bankText.slice(0, 5000)}

Tasks:
1. Categorize every expense as: "Gas/Fuel", "Vehicle Maintenance", "Tolls", "Food/Meals", "Other"
2. For each transaction, try to match the driver name from the bank statement (look for payee names, references, or memo fields that include driver names)
3. Match receipts to bank transactions by amount, date, or merchant name
4. Flag unmatched receipts and unmatched bank charges
5. Separate gas expenses from all other expenses

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "summary": {
    "total_receipts": number,
    "total_bank_charges": number,
    "matched": number,
    "unmatched_receipts": number,
    "unmatched_bank": number,
    "total_gas": number,
    "total_other": number,
    "total_amount_receipts": "formatted dollar amount",
    "total_amount_bank": "formatted dollar amount"
  },
  "expenses": [
    {
      "id": "unique id",
      "date": "...",
      "driver": "Driver name or Unknown",
      "merchant": "...",
      "category": "Gas/Fuel|Vehicle Maintenance|Tolls|Food/Meals|Other",
      "receipt_amount": "...",
      "bank_amount": "...",
      "match_status": "matched|receipt_only|bank_only",
      "notes": "..."
    }
  ],
  "by_driver": [
    {
      "driver": "...",
      "total_expenses": "...",
      "gas_total": "...",
      "other_total": "...",
      "expense_count": number
    }
  ],
  "insights": "Brief paragraph with key findings, potential issues, and recommended actions"
}`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await resp.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      setResults(JSON.parse(clean));
    } catch (e) {
      setError("Analysis failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const drivers = results ? ["ALL", ...new Set(results.expenses.map(e => e.driver))] : [];
  const filteredExpenses = results?.expenses?.filter(e => filterDriver === "ALL" || e.driver === filterDriver) || [];

  const catIcon = cat => ({ "Gas/Fuel": "⛽", "Vehicle Maintenance": "🔧", "Tolls": "🛣️", "Food/Meals": "🍔" }[cat] || "📋");
  const matchColor = s => ({ matched: "green", receipt_only: "yellow", bank_only: "red" }[s] || "gray");

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: "#e8f0fe", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Driver Expense Reconciliation</h2>
        <p style={{ color: "#6a7f8e", fontSize: 13 }}>Upload receipts and bank statement — AI categorizes expenses, separates gas, and matches to drivers.</p>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#7a8fa0", marginBottom: 8, fontWeight: 600 }}>EXPENSE RECEIPTS</div>
          <DropZone label="Upload receipts CSV/export" onFile={setReceiptsFile} fileName={receiptsFile?.name} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: "#7a8fa0", marginBottom: 8, fontWeight: 600 }}>BANK STATEMENT</div>
          <DropZone label="Upload bank statement CSV" onFile={setBankFile} fileName={bankFile?.name} />
        </div>
      </div>

      <button
        onClick={analyze}
        disabled={!receiptsFile || !bankFile || loading}
        style={{
          background: receiptsFile && bankFile ? "linear-gradient(135deg,#00dc82,#0050ff)" : "#1a2535",
          color: receiptsFile && bankFile ? "#fff" : "#3a4a5a",
          border: "none", borderRadius: 8, padding: "11px 28px",
          fontWeight: 700, fontSize: 14, cursor: receiptsFile && bankFile ? "pointer" : "not-allowed",
          marginBottom: 24, transition: "all 0.2s"
        }}
      >
        {loading ? "Reconciling…" : "💰 Run Reconciliation"}
      </button>

      {loading && <Spinner />}
      {error && <div style={{ color: "#ff5050", background: "rgba(255,80,80,0.08)", padding: 14, borderRadius: 8, fontSize: 13 }}>{error}</div>}

      {results && (
        <div>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Receipts", val: results.summary.total_receipts, color: "#00b4ff" },
              { label: "Bank Charges", val: results.summary.total_bank_charges, color: "#00b4ff" },
              { label: "Matched", val: results.summary.matched, color: "#00dc82" },
              { label: "Unmatched Receipts", val: results.summary.unmatched_receipts, color: "#ffbe00" },
              { label: "Unmatched Bank", val: results.summary.unmatched_bank, color: "#ff5050" },
            ].map(s => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 12px", textAlign: "center", border: "1px solid #1a2535" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: "#5a7080", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Gas vs Other */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)", borderRadius: 10, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>⛽</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#ff9500" }}>{results.summary.total_gas}</div>
              <div style={{ fontSize: 12, color: "#7a8080" }}>Gas / Fuel Expenses</div>
            </div>
            <div style={{ background: "rgba(0,180,255,0.08)", border: "1px solid rgba(0,180,255,0.2)", borderRadius: 10, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28 }}>📋</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#00b4ff" }}>{results.summary.total_other}</div>
              <div style={{ fontSize: 12, color: "#7a8080" }}>Other Expenses</div>
            </div>
          </div>

          {/* By Driver */}
          {results.by_driver?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c0d0e0", marginBottom: 10 }}>👤 By Driver</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
                {results.by_driver.map((d, i) => (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1a2535", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 700, color: "#e0eeff", marginBottom: 8, fontSize: 13 }}>{d.driver}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#5a7080" }}>⛽ Gas</span>
                      <span style={{ fontSize: 11, color: "#ff9500" }}>{d.gas_total}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#5a7080" }}>📋 Other</span>
                      <span style={{ fontSize: 11, color: "#00b4ff" }}>{d.other_total}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1a2535", paddingTop: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: "#5a7080" }}>Total</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#e0eeff" }}>{d.total_expenses}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Insights */}
          <div style={{ background: "rgba(0,220,130,0.06)", border: "1px solid rgba(0,220,130,0.2)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#00dc82", fontWeight: 700, marginBottom: 6 }}>💡 AI INSIGHTS</div>
            <p style={{ fontSize: 13, color: "#c0d0e0", lineHeight: 1.6, margin: 0 }}>{results.insights}</p>
          </div>

          {/* Expense table with driver filter */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#c0d0e0" }}>All Expenses</div>
              <select
                value={filterDriver}
                onChange={e => setFilterDriver(e.target.value)}
                style={{ background: "#0f1820", color: "#c0d0e0", border: "1px solid #2a3a4a", borderRadius: 6, padding: "4px 10px", fontSize: 12 }}
              >
                {drivers.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Date","Driver","Merchant","Category","Receipt","Bank","Status","Notes"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#4a6070", borderBottom: "1px solid #1a2535", whiteSpace: "nowrap", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #0f1820", background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent" }}>
                      <td style={{ padding: "7px 10px", color: "#c0d0e0" }}>{e.date}</td>
                      <td style={{ padding: "7px 10px", color: "#e0eeff", fontWeight: 600 }}>{e.driver}</td>
                      <td style={{ padding: "7px 10px", color: "#c0d0e0" }}>{e.merchant}</td>
                      <td style={{ padding: "7px 10px" }}><span style={{ color: "#c0d0e0" }}>{catIcon(e.category)} {e.category}</span></td>
                      <td style={{ padding: "7px 10px", color: "#00dc82" }}>{e.receipt_amount || "—"}</td>
                      <td style={{ padding: "7px 10px", color: "#00b4ff" }}>{e.bank_amount || "—"}</td>
                      <td style={{ padding: "7px 10px" }}><Badge color={matchColor(e.match_status)}>{e.match_status?.replace(/_/g," ")}</Badge></td>
                      <td style={{ padding: "7px 10px", color: "#6a7f8e", fontSize: 11 }}>{e.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Call Station (RingCentral) ───────────────────────────────────────

function CallStation() {
  const CLIENT_ID = "7HMC21tRYfAdd3Ix4HLBsW";
  const [rcLoaded, setRcLoaded] = useState(false);
  const [rcError, setRcError] = useState(null);
  const [callLog, setCallLog] = useState([]);
  const [dialInput, setDialInput] = useState("");
  const iframeRef = useRef();

  const loadRC = useCallback(() => {
    setRcError(null);
    // Load RingCentral Embeddable script
    const existing = document.getElementById("rc-widget-script");
    if (existing) { setRcLoaded(true); return; }

    const script = document.createElement("script");
    script.id = "rc-widget-script";
    script.src = `https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js?clientId=${CLIENT_ID}&appServer=https://platform.ringcentral.com`;
    script.onload = () => setRcLoaded(true);
    script.onerror = () => setRcError("Failed to load RingCentral. Check your Client ID and network.");
    document.head.appendChild(script);

    // Listen for RC events
    window.addEventListener("message", (e) => {
      if (e.data?.type === "rc-call-ring-ringer-notify" || e.data?.type === "rc-active-call-notify") {
        const d = e.data.call;
        if (d) {
          setCallLog(prev => {
            const exists = prev.find(c => c.sessionId === d.sessionId);
            if (!exists) return [{ sessionId: d.sessionId, direction: d.direction || "Outbound", number: d.to?.phoneNumber || d.from?.phoneNumber || "Unknown", time: new Date().toLocaleTimeString(), status: d.telephonyStatus || "Ringing" }, ...prev].slice(0, 50);
            return prev.map(c => c.sessionId === d.sessionId ? { ...c, status: d.telephonyStatus || c.status } : c);
          });
        }
      }
    });
  }, [CLIENT_ID]);

  const dial = () => {
    if (!dialInput) return;
    window.postMessage({ type: "rc-adapter-message-request", requestId: Date.now(), path: "/call", body: { phoneNumber: dialInput } }, "*");
    setCallLog(prev => [{ sessionId: "manual-" + Date.now(), direction: "Outbound", number: dialInput, time: new Date().toLocaleTimeString(), status: "Dialing" }, ...prev].slice(0, 50));
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: "#e8f0fe", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Call Station</h2>
        <p style={{ color: "#6a7f8e", fontSize: 13 }}>Embedded RingCentral dialer — make and receive calls directly from this tool.</p>
      </div>

      {!rcLoaded ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📞</div>
          <p style={{ color: "#6a7f8e", marginBottom: 20, fontSize: 14 }}>RingCentral Embeddable is ready to load.</p>
          <button
            onClick={loadRC}
            style={{
              background: "linear-gradient(135deg,#ff6f00,#ff9500)",
              color: "#fff", border: "none", borderRadius: 8,
              padding: "12px 32px", fontWeight: 700, fontSize: 15, cursor: "pointer"
            }}
          >
            🔌 Connect RingCentral
          </button>
          {rcError && <div style={{ color: "#ff5050", marginTop: 16, fontSize: 13 }}>{rcError}</div>}
          <div style={{ marginTop: 24, color: "#3a4a5a", fontSize: 11 }}>
            Client ID: <span style={{ color: "#4a6070", fontFamily: "monospace" }}>{CLIENT_ID}</span>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ color: "#00dc82", fontSize: 12, fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, background: "#00dc82", borderRadius: "50%", display: "inline-block" }} />
            RingCentral Connected
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            {/* Quick Dial */}
            <div>
              <div style={{ fontSize: 12, color: "#7a8fa0", fontWeight: 600, marginBottom: 10 }}>QUICK DIAL</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  value={dialInput}
                  onChange={e => setDialInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && dial()}
                  placeholder="Enter phone number…"
                  style={{
                    flex: 1, background: "#0f1820", border: "1px solid #2a3a4a",
                    borderRadius: 8, color: "#e0eeff", padding: "10px 14px", fontSize: 14,
                    outline: "none"
                  }}
                />
                <button
                  onClick={dial}
                  style={{
                    background: "linear-gradient(135deg,#00dc82,#00b4ff)",
                    border: "none", borderRadius: 8, padding: "10px 18px",
                    color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14
                  }}
                >📞</button>
              </div>

              {/* Call Log */}
              <div style={{ fontSize: 12, color: "#7a8fa0", fontWeight: 600, marginBottom: 10 }}>RECENT CALLS</div>
              {callLog.length === 0 ? (
                <div style={{ color: "#3a4a5a", fontSize: 12, padding: "16px 0" }}>No calls yet in this session.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {callLog.map((c, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1a2535", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ color: "#e0eeff", fontWeight: 700, fontSize: 13 }}>{c.number}</div>
                        <div style={{ color: "#5a7080", fontSize: 11, marginTop: 2 }}>{c.direction} · {c.time}</div>
                      </div>
                      <Badge color={c.status === "CallConnected" ? "green" : c.status === "Ringing" || c.status === "Dialing" ? "yellow" : "gray"}>
                        {c.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RC Embeddable div target */}
            <div>
              <div style={{ fontSize: 12, color: "#7a8fa0", fontWeight: 600, marginBottom: 10 }}>RINGCENTRAL DIALER</div>
              <div id="rc-widget" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #1a2535", minHeight: 500 }}>
                <div style={{ color: "#3a4a5a", fontSize: 12, padding: 20, textAlign: "center" }}>
                  The RingCentral widget will appear here after you sign in.<br />
                  <span style={{ fontSize: 11 }}>If a popup appeared, complete sign-in there.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "trips", label: "Trip Verification", icon: "🗺️" },
  { id: "expenses", label: "Expense Reconciliation", icon: "💳" },
  { id: "calls", label: "Call Station", icon: "📞" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("trips");

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080e16",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      color: "#c0d0e0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg,#0d1a28 0%,#080e16 100%)",
        borderBottom: "1px solid #1a2535",
        padding: "18px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, background: "linear-gradient(135deg,#0050ff,#00d4ff)",
            borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18
          }}>🚐</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e8f0fe", letterSpacing: -0.3 }}>TripOps Command Center</div>
            <div style={{ fontSize: 11, color: "#3a5060" }}>Verification · Reconciliation · Communications</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#2a3a4a" }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a2535", padding: "0 28px", background: "#0a1220" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "14px 20px",
              color: activeTab === t.id ? "#00d4ff" : "#4a6070",
              fontWeight: activeTab === t.id ? 700 : 500,
              fontSize: 13,
              borderBottom: activeTab === t.id ? "2px solid #00d4ff" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 7,
              transition: "all 0.15s",
              marginBottom: -1,
            }}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: "28px", maxWidth: 1100, margin: "0 auto" }}>
        {activeTab === "trips" && <TripVerification />}
        {activeTab === "expenses" && <ExpenseReconciliation />}
        {activeTab === "calls" && <CallStation />}
      </div>
    </div>
  );
}
