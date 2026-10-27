// Used by gen-palettes.js: every dark-mode rule in theme.css that hard-codes the old emerald fills gets a
// themed twin (html[data-palette][data-theme="dark"] …), so new screens follow the theme without hand-picking them.
const fs = require("fs");
const MAP = [
  [/#10241F/gi, "var(--surface)"], [/#0B1A16/gi, "var(--bg)"], [/#111F1C/gi, "var(--surface)"], [/#0A1412/gi, "var(--bg)"],
  [/#12302A/gi, "color-mix(in srgb, var(--primary) 14%, var(--surface))"], [/#15302A/gi, "var(--primary-soft)"],
  [/#24564B/gi, "color-mix(in srgb, var(--primary) 40%, var(--surface))"], [/#2F8F72/gi, "color-mix(in srgb, var(--primary) 45%, var(--surface))"],
  [/#E6F4EF/gi, "var(--text)"],
];
module.exports = function sweep() {
  const src = fs.readFileSync("css/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "\n/* swept from theme.css: dark-mode rules with the old emerald fills, themed */\n", n = 0;
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim();
    if (sel.indexOf('html[data-theme="dark"]') === -1 || sel.indexOf("@") !== -1) continue;
    // never touch variable definitions (--bg: #0A1412 → --bg: var(--bg) would be a circular reference)
    const decls = m[2].split(";").map(d => d.trim()).filter(d => d && d.indexOf("--") !== 0 && MAP.some(([r]) => { r.lastIndex = 0; return r.test(d); }));
    if (!decls.length) continue;
    const themed = decls.map(d => MAP.reduce((s, [r, v]) => s.replace(r, v), d)).join("; ");
    out += sel.split(",").map(s => s.trim().replace('html[data-theme="dark"]', 'html[data-palette][data-theme="dark"]')).join(", ") + " { " + themed + "; }\n";
    n++;
  }
  console.log("swept rules:", n);
  return out;
};
