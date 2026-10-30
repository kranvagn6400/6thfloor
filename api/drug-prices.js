/* ============================================================
   api/drug-prices.js  —  Vercel function: the private-ward price list
   ============================================================
   The price site (mediprice-pharmacy.vercel.app) answers without CORS headers, so the app cannot read it from the
   browser. This function reads it on the server (a FIXED address — it is not a general proxy) and returns the
   small list the private discharge form needs:  { list: [{ name, price }] }  (price = unit price, IQD).
   Hidden rows and rows without a price are left out. Cached for an hour at the edge.
   ============================================================ */

const PRICE_API = "https://mediprice-pharmacy.vercel.app/api/drugs";

module.exports = async (req, res) => {
  if (req.method !== "GET") { res.status(405).json({ error: "method" }); return; }
  try {
    const r = await fetch(PRICE_API, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("price site " + r.status);
    const j = await r.json();
    const list = ((j && j.drugs) || [])
      .filter(d => d && !d.hidden)
      // alt = the other name the site shows when a drug is opened (its trade name: "lasix", "MIXTARD"…)
      .map(d => ({ id: String(d.id || ""), name: String(d.item || "").replace(/\s+/g, " ").trim(), alt: String(d.genericName || "").replace(/\s+/g, " ").trim(), price: Number(d.unitPrice) }))
      .filter(d => d.name && d.price > 0);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ list });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
