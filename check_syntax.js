const fs = require('fs');
const html = fs.readFileSync('/workspace/piflea-market/index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (scriptMatch) {
  const js = scriptMatch[1];
  try {
    require('vm').createScript(js);
    console.log('JS syntax OK');
  } catch(e) {
    console.log('Error:', e.message);
    console.log('Line:', e.lineNumber);
  }
}