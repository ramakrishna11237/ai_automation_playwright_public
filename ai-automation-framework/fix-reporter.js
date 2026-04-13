const fs = require('fs');

// ── Fix FrameworkReporter ─────────────────────────────────────────────────────
const reporterFile = 'src/utils/FrameworkReporter.ts';
let src = fs.readFileSync(reporterFile, 'utf8');

const insertBefore = '  private printLearningDBSummary';
const newMethod = `  private generateHealthDashboard(): void {
    try {
      const dbPath = require('path').resolve('learning-db.json');
      if (!fs.existsSync(dbPath)) return;
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      if (!Array.isArray(db) || db.length === 0) return;

      const failurePath = require('path').resolve('test-results', 'failure-report.json');
      const failures = fs.existsSync(failurePath)
        ? JSON.parse(fs.readFileSync(failurePath, 'utf8')) : [];

      const now = Date.now(), day = 86400000;
      const last24h = db.filter((x: any) => now - x.timestamp < day);
      const successRate = db.length > 0
        ? Math.round((db.filter((x: any) => x.success).length / db.length) * 100) : 100;

      const healCounts = new Map<string, number>();
      db.forEach((x: any) => healCounts.set(x.label || x.old, (healCounts.get(x.label || x.old) ?? 0) + x.count));
      const topFragile = [...healCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      const recentHeals = last24h.sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 20);

      const row = (x: any) => {
        const age = Math.floor((now - x.timestamp) / day);
        const ageStr = age === 0 ? 'Today' : \`\${age}d ago\`;
        const conf = x.confidence >= 80 ? '#48bb78' : x.confidence >= 60 ? '#ecc94b' : '#fc8181';
        return \`<tr><td>\${(x.label||x.old).slice(0,45)}</td><td>\${x.action}</td><td style="color:#48bb78">\${x.new.slice(0,50)}</td><td>\${x.count}</td><td style="color:\${conf}">\${x.confidence}%</td><td style="color:#718096">\${ageStr}</td></tr>\`;
      };

      const failRows = failures.map((f: any) =>
        \`<tr><td style="color:#fc8181">\${f.stepLabel||''}</td><td>\${f.action||''}</td><td>\${f.cause||'—'}</td><td style="color:#48bb78">\${f.fix||'—'}</td><td>\${f.patched?'✅':''}</td></tr>\`
      ).join('');

      const html = \`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Health Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f1117;color:#e2e8f0}
.hdr{background:#1a1f2e;border-bottom:1px solid #2d3748;padding:20px 28px}
.hdr h1{font-size:20px;font-weight:700;color:#fff}.hdr p{color:#718096;font-size:12px;margin-top:3px}
.c{max-width:1200px;margin:0 auto;padding:20px 28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
.card{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:16px}
.card .lbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#718096;margin-bottom:6px}
.card .val{font-size:28px;font-weight:700}.card .sub{font-size:11px;color:#718096;margin-top:3px}
.sec{background:#1a1f2e;border:1px solid #2d3748;border-radius:8px;padding:16px;margin-bottom:16px}
.sec h2{font-size:12px;font-weight:600;color:#a0aec0;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:7px 10px;color:#718096;font-weight:500;border-bottom:1px solid #2d3748;font-size:10px;text-transform:uppercase}
td{padding:8px 10px;border-bottom:1px solid #1e2535;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:hover td{background:#1e2535}.g{color:#48bb78}.y{color:#ecc94b}.r{color:#fc8181}.b{color:#63b3ed}
.empty{color:#4a5568;font-size:12px;text-align:center;padding:20px}
</style></head><body>
<div class="hdr"><h1>🤖 AI Automation Framework — Health Dashboard</h1>
<p>Generated: \${new Date().toLocaleString()} | \${db.length} fixes in learning-db</p></div>
<div class="c">
<div class="grid">
<div class="card"><div class="lbl">Total Heals</div><div class="val b">\${db.length}</div><div class="sub">All time</div></div>
<div class="card"><div class="lbl">Last 24h</div><div class="val \${last24h.length>0?'y':'g'}">\${last24h.length}</div><div class="sub">\${db.filter((x:any)=>now-x.timestamp<7*day).length} last 7 days</div></div>
<div class="card"><div class="lbl">Success Rate</div><div class="val \${successRate>=95?'g':successRate>=80?'y':'r'}">\${successRate}%</div><div class="sub">\${db.filter((x:any)=>x.success).length}/\${db.length} successful</div></div>
<div class="card"><div class="lbl">Failures This Run</div><div class="val \${failures.length===0?'g':'r'}">\${failures.length}</div><div class="sub">\${failures.filter((f:any)=>f.cause).length} with analysis</div></div>
</div>
\${failures.length>0?\`<div class="sec"><h2>❌ Failure Analysis</h2><table><tr><th>Step</th><th>Action</th><th>Cause</th><th>Fix</th><th>Patched</th></tr>\${failRows}</table></div>\`:''}
<div class="sec"><h2>⚠️ Most Healed (Fragile Spots)</h2>\${topFragile.length===0?'<div class="empty">No data</div>':\`<table><tr><th>Step</th><th>Heals</th></tr>\${topFragile.map(([l,c])=>\`<tr><td>\${l.slice(0,60)}</td><td class="\${c>20?'r':c>5?'y':'g'}">\${c}</td></tr>\`).join('')}</table>\`}</div>
<div class="sec"><h2>📚 Recent Heals (Last 24h)</h2>\${recentHeals.length===0?'<div class="empty">✅ No heals — all locators stable</div>':\`<table><tr><th>Label</th><th>Action</th><th>Old</th><th>New</th><th>Uses</th><th>Conf</th></tr>\${recentHeals.map(row).join('')}</table>\`}</div>
<div class="sec"><h2>🗄️ All Fixes (\${db.length})</h2><table><tr><th>Label</th><th>Action</th><th>New Locator</th><th>Uses</th><th>Conf</th><th>Age</th></tr>\${db.sort((a:any,b:any)=>b.count-a.count).slice(0,50).map(row).join('')}</table></div>
</div></body></html>\`;

      const outFile = require('path').resolve('test-results', 'health-dashboard.html');
      fs.mkdirSync(require('path').dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, html, 'utf8');
      console.log(\`\\n  📊 Health Dashboard: \${outFile}\`);
    } catch { /* non-fatal */ }
  }

  `;

if (src.includes(insertBefore)) {
  src = src.replace(insertBefore, newMethod + insertBefore);
  console.log('generateHealthDashboard method added');
} else {
  console.error('insertBefore marker not found');
}

fs.writeFileSync(reporterFile, src, 'utf8');

// ── Add npm scripts ───────────────────────────────────────────────────────────
const pkgFile = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.scripts['dashboard'] = 'npx ts-node src/utils/HealthDashboard.ts';
pkg.scripts['report:failures'] = 'node -e "const f=require(\'./test-results/failure-report.json\'); f.forEach((x,i)=>console.log(i+1,x.stepLabel,\'|\',x.cause||\'no analysis\'))"';
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('npm scripts added: dashboard, report:failures');

console.log('Done');
