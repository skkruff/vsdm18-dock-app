// Copies the .sdPlugin folder (including plugin/node_modules) into Stream Dock's plugin folder.
// Windows only. Quit Stream Dock first, run `npm run deploy`, then start Stream Dock again.
const fs = require('fs');
const path = require('path');

const name = 'com.m18switchboard.msfs.sdPlugin';
const src = path.join(__dirname, '..', 'plugin', name);

if (!process.env.APPDATA) {
  console.error('APPDATA is not set. This script is meant to run on the Windows machine with Stream Dock.');
  process.exit(1);
}
if (!fs.existsSync(path.join(src, 'plugin', 'node_modules', 'ws'))) {
  console.error('Dependencies missing. Run `npm run setup` first.');
  process.exit(1);
}

const dest = path.join(process.env.APPDATA, 'HotSpot', 'StreamDock', 'plugins', name);
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, {
  recursive: true,
  filter: s => !path.relative(src, s).split(path.sep).includes('logs'),
});
console.log(`Deployed to ${dest}`);
console.log(`Logs will appear in ${path.join(dest, 'logs')}`);
