// Minimal file logger. Stream Dock gives the plugin no console, so everything goes to
// <plugin>/logs/YYYY-MM-DD.log. One JSON-ish line per entry so logs are easy to grep.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }

function file() {
  return path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);
}

function write(level, args) {
  const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} ${level} ${text}\n`;
  try { fs.appendFileSync(file(), line); } catch { /* never crash on logging */ }
  if (process.env.SWITCHBOARD_LOG_STDOUT) process.stdout.write(line);
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};
