// "Build" step: plain static web app, so just verify required files exist.
const fs = require('fs'), path = require('path'), www = path.join(__dirname, '..', 'www');
for (const f of ['index.html', 'manifest.webmanifest']) if (!fs.existsSync(path.join(www, f))) { console.error('missing ' + f); process.exit(1); }
console.log('web build check OK');
