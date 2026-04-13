import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#070d1a",
  panel: "#0d1525",
  card: "#111e33",
  cardHover: "#162240",
  border: "#1a2d4a",
  accent: "#00e5b0",
  accentDim: "#00e5b018",
  warn: "#f59e0b",
  danger: "#f43f5e",
  blue: "#38bdf8",
  purple: "#a78bfa",
  green: "#4ade80",
  text: "#e2e8f0",
  muted: "#4a6080",
  dimText: "#8aa0be",
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeterReading {
  hour: string;
  ac: number;
  washer: number;
  fridge: number;
  lights: number;
  total: number;
  isPeak: boolean;
  co2: number;
  simHour: number;
}

interface GridReading {
  demand: number;
  withNudge: number;
  capacity: number;
  hour?: string;
}

interface Nudge {
  id: number;
  appliance: string;
  icon: string;
  message: string;
  points: number;
  saving: number;
  severity: string;
  action: string;
  accepted: boolean;
  time: string;
  fallback?: boolean;
}

// ─── Smart Meter Physics Simulation ──────────────────────────────────────────
class SmartMeterSimulator {
  simMinute: number;
  acOn: boolean;
  washerOn: boolean;
  washerCycle: number;
  acTemp: number;
  ambientTemp: number;
  fridgeCompressor: boolean;
  fridgeCycle: number;
  lightsOn: boolean;

  constructor() {
    this.simMinute = 18 * 60;
    this.acOn = true;
    this.washerOn = false;
    this.washerCycle = 0;
    this.acTemp = 26;
    this.ambientTemp = 34;
    this.fridgeCompressor = false;
    this.fridgeCycle = 0;
    this.lightsOn = true;
  }

  getACLoad(): number {
    const hour = (this.simMinute / 60) % 24;
    const isPeak = (hour >= 6 && hour <= 9) || (hour >= 18 && hour <= 22);
    if (!this.acOn) return 0.05;
    const tempDiff = isPeak ? 8 : 5;
    const compressorLoad = 1.8 + tempDiff * 0.08 + (Math.random() * 0.2 - 0.1);
    return Math.max(0.5, compressorLoad);
  }

  getWasherLoad(): number {
    if (!this.washerOn) return 0;
    this.washerCycle++;
    if (this.washerCycle < 10) return 2.1 + Math.random() * 0.3;
    if (this.washerCycle < 40) return 0.5 + Math.random() * 0.1;
    if (this.washerCycle < 60) return 1.8 + Math.random() * 0.2;
    if (this.washerCycle < 80) return 0.3 + Math.random() * 0.1;
    if (this.washerCycle < 90) return 1.6 + Math.random() * 0.2;
    this.washerOn = false;
    this.washerCycle = 0;
    return 0;
  }

  getFridgeLoad(): number {
    this.fridgeCycle++;
    if (this.fridgeCycle > 25) this.fridgeCycle = 0;
    return this.fridgeCycle < 15 ? 0.18 + Math.random() * 0.03 : 0.02;
  }

  getLightsLoad(): number {
    const hour = (this.simMinute / 60) % 24;
    if (!this.lightsOn) return 0.02;
    if (hour >= 18 || hour <= 6) return 0.28 + Math.random() * 0.06;
    if (hour >= 6 && hour <= 9) return 0.18 + Math.random() * 0.04;
    return 0.04;
  }

  tick(): MeterReading {
    this.simMinute = (this.simMinute + 1) % (24 * 60);
    const hour = (this.simMinute / 60) % 24;
    const isPeak = (hour >= 18 && hour <= 22) || (hour >= 6 && hour <= 9);
    const ac = this.getACLoad();
    const washer = this.getWasherLoad();
    const fridge = this.getFridgeLoad();
    const lights = this.getLightsLoad();
    const total = +(ac + washer + fridge + lights).toFixed(3);
    return {
      hour: `${Math.floor(hour)}:${String(this.simMinute % 60).padStart(2, "0")}`,
      ac: +ac.toFixed(3),
      washer: +washer.toFixed(3),
      fridge: +fridge.toFixed(3),
      lights: +lights.toFixed(3),
      total,
      isPeak,
      co2: +(total * 0.82).toFixed(3),
      simHour: hour,
    };
  }

  toggleAC() { this.acOn = !this.acOn; }
  toggleWasher() { if (!this.washerOn) { this.washerOn = true; this.washerCycle = 0; } }
  toggleLights() { this.lightsOn = !this.lightsOn; }
}

// ─── Grid Load Simulation ─────────────────────────────────────────────────────
function getGridLoad(simMinute: number): GridReading {
  const h = (simMinute / 60) % 24;
  const base = 170;
  const morning = h >= 6 && h <= 9 ? 45 * Math.sin(Math.PI * (h - 6) / 3) : 0;
  const evening = h >= 17 && h <= 22 ? 58 * Math.sin(Math.PI * (h - 17) / 5) : 0;
  const noise = Math.random() * 4 - 2;
  const raw = base + morning + evening + noise;
  const withNudge = raw - (morning * 0.32 + evening * 0.28);
  return { demand: +raw.toFixed(1), withNudge: +withNudge.toFixed(1), capacity: 240 };
}

// ─── AI Nudge Generation ──────────────────────────────────────────────────────
async function generateAINudge(usageSnapshot: MeterReading): Promise<Nudge> {
  const prompt = `You are GridNudge's AI engine for an Indian household energy demand response system.

Current household usage snapshot (RIGHT NOW during peak hours 6-10 PM in Chennai):
- AC: ${usageSnapshot.ac} kW (running)
- Washer: ${usageSnapshot.washer} kW ${usageSnapshot.washer > 0 ? "(RUNNING DURING PEAK!)" : "(off)"}
- Fridge: ${usageSnapshot.fridge} kW (duty cycle)
- Lights: ${usageSnapshot.lights} kW
- TOTAL: ${usageSnapshot.total} kW
- Peak hour: ${usageSnapshot.isPeak ? "YES - Grid is stressed" : "No"}
- Simulated time: ${usageSnapshot.hour}

Peak tariff: ₹8.5/kWh now vs ₹3.2/kWh off-peak (10 PM onwards).

Generate ONE specific, personalised AI nudge. Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "appliance": "AC|Washer|Lights|Fridge",
  "icon": "single emoji",
  "message": "specific actionable nudge under 25 words mentioning kW, savings in rupees, and points",
  "points": number between 10 and 80,
  "saving": number in rupees between 5 and 35,
  "severity": "high|medium|low",
  "action": "short 3-word action label"
}`;

  try {
    const res = await fetch("/api/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text: string = data.content?.map((b: { text?: string }) => b.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { ...parsed, id: Date.now(), accepted: false, time: new Date().toLocaleTimeString() };
  } catch {
    return {
      id: Date.now(), appliance: "AC", icon: "❄️",
      message: `AC drawing ${usageSnapshot.ac}kW during peak. Raise thermostat 2°C to save ₹18 and earn 45 pts`,
      points: 45, saving: 18, severity: "high", action: "Raise Thermostat",
      accepted: false, time: new Date().toLocaleTimeString(), fallback: true,
    };
  }
}

// ─── UI Components ────────────────────────────────────────────────────────────
function Pill({ color, children, pulse }: { color: string; children: React.ReactNode; pulse?: boolean }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 20, padding: "3px 11px", fontSize: 11, fontWeight: 700,
      letterSpacing: 0.5, display: "inline-flex", alignItems: "center", gap: 4,
      animation: pulse ? "pulse 1.5s infinite" : "none",
    }}>
      {pulse && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />}
      {children}
    </span>
  );
}

function GaugeBar({ value, max, color, label, sub }: { value: number; max: number; color: string; label: string; sub?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ color: C.dimText, fontSize: 12 }}>{label}</span>
        <span style={{ color, fontWeight: 800, fontSize: 13 }}>{sub ?? value}</span>
      </div>
      <div style={{ background: C.border, borderRadius: 6, height: 8, overflow: "hidden" }}>
        <div style={{
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          width: `${pct}%`, height: "100%", borderRadius: 6,
          transition: "width 0.8s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow: `0 0 8px ${color}66`,
        }} />
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color, animate }: {
  icon: string; label: string; value: string | number; sub?: string; color: string; animate?: boolean;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderTop: `2px solid ${color}`, borderRadius: 14,
      padding: "18px 20px", flex: 1, minWidth: 130,
    }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
      <div style={{
        color, fontSize: 26, fontWeight: 900, lineHeight: 1.1, marginTop: 4,
        fontVariantNumeric: "tabular-nums",
        textShadow: animate ? `0 0 20px ${color}88` : "none",
      }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── AI Nudge Card ────────────────────────────────────────────────────────────
function NudgeCard({ nudge, onAccept, onDismiss }: { nudge: Nudge; onAccept: (id: number) => void; onDismiss: (id: number) => void }) {
  const sevColor = nudge.severity === "high" ? C.danger : nudge.severity === "medium" ? C.warn : C.accent;
  return (
    <div style={{
      background: nudge.accepted ? "#0a2018" : C.card,
      border: `1px solid ${nudge.accepted ? C.green + "55" : sevColor + "44"}`,
      borderLeft: `3px solid ${nudge.accepted ? C.green : sevColor}`,
      borderRadius: 14, padding: "16px 18px", marginBottom: 10,
      transition: "all 0.3s", position: "relative", overflow: "hidden",
    }}>
      {nudge.fallback && (
        <div style={{ position: "absolute", top: 8, right: 10, color: C.muted, fontSize: 9 }}>fallback</div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{nudge.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <Pill color={sevColor}>{nudge.severity?.toUpperCase()}</Pill>
            <Pill color={C.blue}>{nudge.appliance}</Pill>
            <span style={{ color: C.muted, fontSize: 11, marginLeft: "auto" }}>{nudge.time}</span>
          </div>
          <div style={{ color: C.text, fontSize: 13, lineHeight: 1.6 }}>{nudge.message}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <div style={{ background: C.accentDim, borderRadius: 8, padding: "5px 12px", textAlign: "center" }}>
              <span style={{ color: C.accent, fontWeight: 900, fontSize: 15 }}>+{nudge.points}</span>
              <span style={{ color: C.muted, fontSize: 10 }}> pts</span>
            </div>
            <div style={{ background: "#f59e0b18", borderRadius: 8, padding: "5px 12px", textAlign: "center" }}>
              <span style={{ color: C.warn, fontWeight: 900, fontSize: 15 }}>₹{nudge.saving}</span>
              <span style={{ color: C.muted, fontSize: 10 }}> saved</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {!nudge.accepted && (
                <>
                  <button onClick={() => onDismiss(nudge.id)} style={{
                    background: "transparent", color: C.muted, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12,
                  }}>Skip</button>
                  <button onClick={() => onAccept(nudge.id)} style={{
                    background: C.accent, color: "#000", border: "none",
                    borderRadius: 8, padding: "6px 14px", fontWeight: 800,
                    cursor: "pointer", fontSize: 12,
                  }}>{nudge.action || "Accept"}</button>
                </>
              )}
              {nudge.accepted && <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Accepted</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── HOUSEHOLD VIEW ───────────────────────────────────────────────────────────
function HouseholdView() {
  const simRef = useRef(new SmartMeterSimulator());
  const [live, setLive] = useState<MeterReading>(() => simRef.current.tick());
  const [history, setHistory] = useState<MeterReading[]>([]);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [points, setPoints] = useState(3940);
  const [tab, setTab] = useState("dashboard");
  const [aiLoading, setAiLoading] = useState(false);
  const [controls, setControls] = useState({ ac: true, washer: false, lights: true });
  const nudgeDebounce = useRef(false);

  useEffect(() => {
    const iv = setInterval(() => {
      const reading = simRef.current.tick();
      setLive(reading);
      setHistory(h => {
        const next = [...h, reading];
        return next.length > 48 ? next.slice(-48) : next;
      });

      if (reading.isPeak && reading.total > 2.8 && !nudgeDebounce.current) {
        nudgeDebounce.current = true;
        setTimeout(() => { nudgeDebounce.current = false; }, 20000);
        setAiLoading(true);
        generateAINudge(reading).then(nudge => {
          setNudges(prev => [nudge, ...prev].slice(0, 8));
          setAiLoading(false);
        });
      }
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  const acceptNudge = (id: number) => {
    const nudge = nudges.find(n => n.id === id);
    if (nudge) {
      setNudges(prev => prev.map(n => n.id === id ? { ...n, accepted: true } : n));
      setPoints(p => p + nudge.points);
      if (nudge.appliance === "AC") simRef.current.toggleAC();
      if (nudge.appliance === "Lights") simRef.current.toggleLights();
    }
  };

  const dismissNudge = (id: number) => setNudges(prev => prev.filter(n => n.id !== id));

  const handleManualNudge = () => {
    setAiLoading(true);
    generateAINudge(live).then(nudge => {
      setNudges(prev => [nudge, ...prev].slice(0, 8));
      setAiLoading(false);
    });
  };

  const liveColor = live.total > 3.5 ? C.danger : live.total > 2.5 ? C.warn : C.accent;
  const pendingNudges = nudges.filter(n => !n.accepted).length;

  const BADGES = [
    { icon: "🌙", label: "Night Owl", earned: points > 3000, desc: "3 off-peak washes completed" },
    { icon: "🌿", label: "Green Streak", earned: points > 3500, desc: "7-day CO₂ reduction streak" },
    { icon: "⚡", label: "Off-Peak Hero", earned: points > 4500, desc: "Shift 10 peak loads this month" },
    { icon: "🏆", label: "Grid Guardian", earned: points > 5000, desc: "Top 5% in your zone" },
  ];

  const LEADERBOARD = [
    { rank: 1, name: "Priya S.", zone: "Adyar", pts: 4820, saved: 312, isUser: false },
    { rank: 2, name: "Rajan M.", zone: "T. Nagar", pts: 4650, saved: 289, isUser: false },
    { rank: 3, name: "You", zone: "Velachery", pts: points, saved: Math.floor(points * 0.063), isUser: true },
    { rank: 4, name: "Kavitha R.", zone: "Anna Nagar", pts: 3720, saved: 228, isUser: false },
    { rank: 5, name: "Suresh P.", zone: "Porur", pts: 3540, saved: 214, isUser: false },
  ].sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, rank: i + 1 }));

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>{"⚡"}</span>
            <span style={{ fontSize: 21, fontWeight: 900, color: C.accent, letterSpacing: -0.5 }}>GridNudge</span>
            {live.isPeak
              ? <Pill color={C.danger} pulse>PEAK HOUR</Pill>
              : <Pill color={C.green}>OFF-PEAK</Pill>}
          </div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Velachery · {live.hour} · Smart Meter Live</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["dashboard", "nudges", "badges", "leaderboard"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? C.accent : "transparent",
              color: tab === t ? "#000" : C.dimText,
              border: `1px solid ${tab === t ? C.accent : C.border}`,
              borderRadius: 8, padding: "6px 13px", cursor: "pointer",
              fontWeight: 700, fontSize: 12, textTransform: "capitalize",
              transition: "all 0.15s", position: "relative"
            }}>
              {t}
              {t === "nudges" && pendingNudges > 0 && (
                <span style={{
                  position: "absolute", top: -6, right: -6,
                  background: C.danger, color: "#fff", borderRadius: "50%",
                  width: 16, height: 16, fontSize: 9, fontWeight: 900,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{pendingNudges}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* DASHBOARD */}
      {tab === "dashboard" && (
        <>
          <div style={{
            background: "linear-gradient(135deg, #0c1a30 0%, #081220 100%)",
            border: `1px solid ${liveColor}33`, borderRadius: 18, padding: 22, marginBottom: 16,
            display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap",
            boxShadow: `0 0 30px ${liveColor}15`,
          }}>
            <div style={{ textAlign: "center", minWidth: 100 }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1.2, marginBottom: 2 }}>LIVE DRAW</div>
              <div style={{
                color: liveColor, fontSize: 58, fontWeight: 900, lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                textShadow: `0 0 30px ${liveColor}88`,
                transition: "color 0.5s"
              }}>{live.total.toFixed(1)}</div>
              <div style={{ color: liveColor, fontSize: 13, fontWeight: 700 }}>kW</div>
              <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
                ₹{(live.total * (live.isPeak ? 8.5 : 3.2)).toFixed(2)}/hr
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <GaugeBar value={live.ac} max={3} color={C.blue} label={"❄️ Air Conditioner"} sub={`${live.ac.toFixed(2)} kW`} />
              <GaugeBar value={live.washer} max={2} color={C.purple} label={"🫧 Washing Machine"} sub={live.washer > 0.05 ? `${live.washer.toFixed(2)} kW — RUNNING` : "0 kW"} />
              <GaugeBar value={live.fridge} max={0.25} color={C.accent} label={"🧊 Refrigerator"} sub={`${live.fridge.toFixed(2)} kW`} />
              <GaugeBar value={live.lights} max={0.4} color={C.warn} label={"💡 Lighting"} sub={`${live.lights.toFixed(2)} kW`} />
            </div>
            <div style={{ minWidth: 140 }}>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>POINTS</div>
              <div style={{ color: C.accent, fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{points.toLocaleString()}</div>
              <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Rank #3 zone</div>
              <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>CONTROLS</div>
              {[
                { label: "AC", active: controls.ac, toggle: () => { simRef.current.toggleAC(); setControls(c => ({ ...c, ac: !c.ac })); } },
                { label: "Washer", active: controls.washer, toggle: () => { simRef.current.toggleWasher(); setControls(c => ({ ...c, washer: !c.washer })); } },
                { label: "Lights", active: controls.lights, toggle: () => { simRef.current.toggleLights(); setControls(c => ({ ...c, lights: !c.lights })); } },
              ].map(ctrl => (
                <div key={ctrl.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ color: C.dimText, fontSize: 12 }}>{ctrl.label}</span>
                  <div onClick={ctrl.toggle} style={{
                    width: 36, height: 20, borderRadius: 10, cursor: "pointer",
                    background: ctrl.active ? C.accent : C.border, position: "relative",
                    transition: "background 0.2s"
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%", background: "#fff",
                      position: "absolute", top: 3, left: ctrl.active ? 19 : 3,
                      transition: "left 0.2s"
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* KPI row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <KpiCard icon={"💰"} label="Today Saved" value="₹241" sub="vs peak tariff" color={C.green} />
            <KpiCard icon={"🌱"} label="CO₂ Avoided" value="1.98 kg" sub="today" color={C.accent} />
            <KpiCard icon={"📉"} label="Peak Reduction" value="18%" sub="vs last week" color={C.blue} />
            <KpiCard icon={"🤖"} label="AI Nudges" value={nudges.length} sub={`${nudges.filter(n => n.accepted).length} accepted`} color={C.purple} animate />
          </div>

          {/* Live chart */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>Live Appliance Load</div>
                <div style={{ color: C.muted, fontSize: 11 }}>Real-time smart meter readings · kW</div>
              </div>
              {live.isPeak && (
                <div style={{ background: C.danger + "22", border: `1px solid ${C.danger}44`, borderRadius: 8, padding: "5px 12px", color: C.danger, fontSize: 11, fontWeight: 700 }}>
                  {"⚠"} Peak Tariff ₹8.5/kWh
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={history.slice(-30)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  {([["ac", C.blue], ["washer", C.purple], ["fridge", C.accent], ["lights", C.warn]] as [string, string][]).map(([k, col]) => (
                    <linearGradient key={k} id={`hg_${k}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={col} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={col} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={4} />
                <YAxis tick={{ fill: C.muted, fontSize: 9 }} />
                <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} labelStyle={{ color: C.text }} />
                <Area type="monotone" dataKey="ac" stackId="1" stroke={C.blue} fill="url(#hg_ac)" name="AC" strokeWidth={1.5} />
                <Area type="monotone" dataKey="washer" stackId="1" stroke={C.purple} fill="url(#hg_washer)" name="Washer" strokeWidth={1.5} />
                <Area type="monotone" dataKey="fridge" stackId="1" stroke={C.accent} fill="url(#hg_fridge)" name="Fridge" strokeWidth={1.5} />
                <Area type="monotone" dataKey="lights" stackId="1" stroke={C.warn} fill="url(#hg_lights)" name="Lights" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* NUDGES */}
      {tab === "nudges" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{"🤖"} AI Nudge Engine</div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Claude AI generates nudges from live smart meter data</div>
            </div>
            <button onClick={handleManualNudge} disabled={aiLoading} style={{
              background: aiLoading ? C.border : C.accent, color: aiLoading ? C.muted : "#000",
              border: "none", borderRadius: 10, padding: "9px 18px",
              fontWeight: 800, cursor: aiLoading ? "not-allowed" : "pointer", fontSize: 13,
              transition: "all 0.2s"
            }}>
              {aiLoading ? "⏳ Claude thinking…" : "⚡ Get AI Nudge"}
            </button>
          </div>

          {aiLoading && (
            <div style={{
              background: C.accentDim, border: `1px solid ${C.accent}33`,
              borderRadius: 12, padding: 16, marginBottom: 12, display: "flex", gap: 12, alignItems: "center"
            }}>
              <div style={{ fontSize: 20 }}>{"🤖"}</div>
              <div>
                <div style={{ color: C.accent, fontWeight: 700, fontSize: 13 }}>Claude AI is analysing your usage…</div>
                <div style={{ color: C.muted, fontSize: 11 }}>
                  Checking: AC={live.ac.toFixed(2)}kW, Washer={live.washer.toFixed(2)}kW, Peak={live.isPeak ? "YES" : "NO"}
                </div>
              </div>
            </div>
          )}

          {nudges.length === 0 && !aiLoading && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{"🤖"}</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No nudges yet</div>
              <div style={{ fontSize: 12 }}>AI nudges trigger automatically during peak hours when load exceeds 2.8 kW</div>
            </div>
          )}

          {nudges.map(n => <NudgeCard key={n.id} nudge={n} onAccept={acceptNudge} onDismiss={dismissNudge} />)}

          {nudges.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 8 }}>
              <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, marginBottom: 10 }}>ACCEPTANCE RATE</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ flex: 1, background: C.border, borderRadius: 6, height: 10, overflow: "hidden" }}>
                  <div style={{
                    background: `linear-gradient(90deg, ${C.accent}, ${C.green})`,
                    width: `${nudges.length ? (nudges.filter(n => n.accepted).length / nudges.length * 100) : 0}%`,
                    height: "100%", borderRadius: 6, transition: "width 0.5s"
                  }} />
                </div>
                <span style={{ color: C.accent, fontWeight: 900, minWidth: 36 }}>
                  {nudges.length ? Math.round(nudges.filter(n => n.accepted).length / nudges.length * 100) : 0}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BADGES */}
      {tab === "badges" && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{"🏅"} Achievements</div>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>Earned by consistently shifting peak loads</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {BADGES.map(b => (
              <div key={b.label} style={{
                background: b.earned ? C.card : "#0a1020",
                border: `1px solid ${b.earned ? C.accent + "55" : C.border}`,
                borderRadius: 14, padding: 20, textAlign: "center", opacity: b.earned ? 1 : 0.45,
              }}>
                <div style={{ fontSize: 40 }}>{b.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: b.earned ? C.text : C.muted, marginTop: 8 }}>{b.label}</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{b.desc}</div>
                <div style={{ color: b.earned ? C.accent : C.muted, fontSize: 11, fontWeight: 700, marginTop: 8 }}>
                  {b.earned ? "✓ EARNED" : "LOCKED"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LEADERBOARD */}
      {tab === "leaderboard" && (
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{"🏆"} Neighbourhood Leaderboard</div>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 18 }}>Chennai Zone Rankings · April 2026</div>
          {LEADERBOARD.map(u => (
            <div key={u.name} style={{
              background: u.isUser ? "#0a2018" : C.card,
              border: `1px solid ${u.isUser ? C.accent + "66" : C.border}`,
              borderRadius: 12, padding: "13px 18px", marginBottom: 8,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ width: 28, textAlign: "center", fontSize: 16 }}>
                {u.rank === 1 ? "🥇" : u.rank === 2 ? "🥈" : u.rank === 3 ? "🥉" : `#${u.rank}`}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: u.isUser ? C.accent : C.text, fontSize: 13 }}>
                  {u.name}{u.isUser && " (You)"}
                </div>
                <div style={{ color: C.muted, fontSize: 11 }}>{u.zone}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: C.accent, fontWeight: 900 }}>{u.pts.toLocaleString()}</div>
                <div style={{ color: C.muted, fontSize: 11 }}>₹{u.saved} saved</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GRID OPERATOR VIEW ───────────────────────────────────────────────────────
function GridOperatorView() {
  const simMinuteRef = useRef(18 * 60);
  const [gridHistory, setGridHistory] = useState<(GridReading & { hour: string })[]>([]);
  const [liveGrid, setLiveGrid] = useState<GridReading>(() => getGridLoad(18 * 60));
  const [stats, setStats] = useState({ nudgesSent: 14820, co2: 8247, reduction: 17.4, acceptance: 38.4 });

  useEffect(() => {
    const iv = setInterval(() => {
      simMinuteRef.current = (simMinuteRef.current + 1) % (24 * 60);
      const g = getGridLoad(simMinuteRef.current);
      const hour = (simMinuteRef.current / 60) % 24;
      setLiveGrid(g);
      setGridHistory(h => {
        const next = [...h, { ...g, hour: `${Math.floor(hour)}:${String(simMinuteRef.current % 60).padStart(2, "0")}` }];
        return next.length > 60 ? next.slice(-60) : next;
      });
      setStats(s => ({
        nudgesSent: s.nudgesSent + Math.floor(Math.random() * 2),
        co2: +(s.co2 + Math.random() * 0.4).toFixed(1),
        reduction: +(s.reduction + (Math.random() - 0.5) * 0.05).toFixed(1),
        acceptance: +(s.acceptance + (Math.random() - 0.5) * 0.02).toFixed(1),
      }));
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  const ZONES = [
    { zone: "Adyar", load: 87, target: 75, hh: 2340, reduction: 18, status: "high" },
    { zone: "T. Nagar", load: 72, target: 75, hh: 1980, reduction: 22, status: "ok" },
    { zone: "Velachery", load: 91, target: 75, hh: 2100, reduction: 14, status: "critical" },
    { zone: "Anna Nagar", load: 68, target: 75, hh: 1750, reduction: 26, status: "good" },
    { zone: "Porur", load: 79, target: 75, hh: 1620, reduction: 19, status: "warn" },
  ];

  const sc: Record<string, string> = { critical: C.danger, high: C.warn, warn: C.warn, ok: C.blue, good: C.green };
  const loadPct = (liveGrid.demand / 240 * 100).toFixed(0);
  const savingPct = ((1 - liveGrid.withNudge / liveGrid.demand) * 100).toFixed(1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 20, color: C.text }}>{"⚡"} Grid Operator Dashboard</div>
          <div style={{ color: C.muted, fontSize: 12 }}>Tamil Nadu DISCOM · Live Demand Response · Physics-simulated</div>
        </div>
        <Pill color={C.danger} pulse>PEAK PERIOD ACTIVE</Pill>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <KpiCard icon={"📊"} label="Grid Load" value={`${liveGrid.demand.toFixed(0)} GW`} sub={`${loadPct}% of capacity`} color={liveGrid.demand > 220 ? C.danger : C.warn} animate />
        <KpiCard icon={"📉"} label="Shaved by AI" value={`${stats.reduction} MW`} sub={`${savingPct}% reduction`} color={C.accent} />
        <KpiCard icon={"🤖"} label="Nudges Sent" value={stats.nudgesSent.toLocaleString()} sub="10,000 households" color={C.blue} animate />
        <KpiCard icon={"🌍"} label="CO₂ Avoided" value={`${stats.co2.toFixed(0)} t`} sub="this season" color={C.green} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Real-Time Demand Curve</div>
        <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Physics-based India NLDC load profile · With vs Without GridNudge</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={gridHistory.slice(-40)} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.danger} stopOpacity={0.35} />
                <stop offset="95%" stopColor={C.danger} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.accent} stopOpacity={0.35} />
                <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="hour" tick={{ fill: C.muted, fontSize: 9 }} interval={5} />
            <YAxis domain={[140, 250]} tick={{ fill: C.muted, fontSize: 9 }} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine y={240} stroke={C.danger} strokeDasharray="4 2" label={{ value: "Capacity", fill: C.danger, fontSize: 9, position: "insideTopRight" }} />
            <Area type="monotone" dataKey="demand" stroke={C.danger} fill="url(#gD)" name="Without Nudge (GW)" strokeWidth={2} />
            <Area type="monotone" dataKey="withNudge" stroke={C.accent} fill="url(#gN)" name="With GridNudge (GW)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
          {([[C.danger, "Without Nudge"], [C.accent, "With GridNudge"]] as [string, string][]).map(([col, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 14, height: 3, background: col, borderRadius: 2 }} />
              <span style={{ color: C.muted, fontSize: 11 }}>{label}</span>
            </div>
          ))}
          <div style={{ marginLeft: "auto", color: C.accent, fontSize: 12, fontWeight: 700 }}>
            Saving {savingPct}% peak load right now
          </div>
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>Zone-wise Load Monitor</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Zone", "Load %", "Bar", "Households", "AI Reduction", "Status"].map(h => (
                  <th key={h} style={{ color: C.muted, fontSize: 10, fontWeight: 700, padding: "0 10px 10px", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ZONES.map(z => (
                <tr key={z.zone} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "11px 10px", fontWeight: 700 }}>{z.zone}</td>
                  <td style={{ padding: "11px 10px", color: sc[z.status], fontWeight: 900 }}>{z.load}%</td>
                  <td style={{ padding: "11px 10px", minWidth: 110 }}>
                    <div style={{ background: C.border, borderRadius: 4, height: 7, overflow: "hidden" }}>
                      <div style={{ background: sc[z.status], width: `${z.load}%`, height: "100%", borderRadius: 4 }} />
                    </div>
                    <div style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>Target {z.target}%</div>
                  </td>
                  <td style={{ padding: "11px 10px", color: C.dimText }}>{z.hh.toLocaleString()}</td>
                  <td style={{ padding: "11px 10px", color: C.green, fontWeight: 700 }}>-{z.reduction}%</td>
                  <td style={{ padding: "11px 10px" }}><Pill color={sc[z.status]}>{z.status.toUpperCase()}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>{"💸"} Cost Avoidance · Season</div>
          {([["Peaker Plant Saved", "₹48.2L", C.green], ["Infrastructure Deferred", "₹2.3 Cr", C.accent], ["Carbon Credits", "₹6.8L", C.blue]] as [string, string, string][]).map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 8 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>{l}</span>
              <span style={{ color: c, fontWeight: 900 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 200, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>{"📈"} AI Nudge Performance</div>
          {([
            ["Acceptance Rate", `${stats.acceptance.toFixed(1)}%`, C.accent],
            ["Peak MW Reduced", `${stats.reduction} MW`, C.green],
            ["Avg Load Shift", "1.8 kW/hh", C.blue],
            ["Active Households", "9,840", C.purple],
          ] as [string, string, string][]).map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 8 }}>
              <span style={{ color: C.muted, fontSize: 12 }}>{l}</span>
              <span style={{ color: c, fontWeight: 900 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function GridNudgeApp() {
  const [view, setView] = useState("household");
  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'DM Sans','Segoe UI',sans-serif",
      backgroundImage: "radial-gradient(ellipse 60% 40% at 15% 15%, #0a1f3540 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 85% 85%, #00e5b008 0%, transparent 60%)",
      padding: "20px 16px",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.panel}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      `}</style>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 24,
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 16px",
        flexWrap: "wrap"
      }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 700 }}>VIEW AS:</span>
        {[
          { key: "household", label: "🏠 Household", color: C.accent },
          { key: "grid", label: "⚡ Grid Operator", color: C.blue },
        ].map(v => (
          <button key={v.key} onClick={() => setView(v.key)} style={{
            background: view === v.key ? v.color : "transparent",
            color: view === v.key ? "#000" : C.dimText,
            border: `1px solid ${view === v.key ? v.color : C.border}`,
            borderRadius: 8, padding: "7px 18px", cursor: "pointer",
            fontWeight: 800, fontSize: 13, transition: "all 0.2s"
          }}>{v.label}</button>
        ))}
        <div style={{ marginLeft: "auto", color: C.muted, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "inline-block", boxShadow: `0 0 6px ${C.green}` }} />
          Live · {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        {view === "household" ? <HouseholdView /> : <GridOperatorView />}
      </div>

      <div style={{ textAlign: "center", marginTop: 36, color: C.muted, fontSize: 10, letterSpacing: 0.5 }}>
        GRIDNUDGE · COGNIZANT TECHNOVERSE HACKATHON 2026 · UTILITIES & ENERGY › DEMAND RESPONSE
      </div>
    </div>
  );
}
