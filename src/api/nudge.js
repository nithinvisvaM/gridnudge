export default async function handler(req, res) {
  try {
   fetch("/api/nudge", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }]
  })
});
  } catch (err) {
    res.status(500).json({ error: "API failed" });
  }
}