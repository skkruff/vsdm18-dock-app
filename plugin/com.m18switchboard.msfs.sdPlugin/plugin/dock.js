// Dock layer: the only module that speaks the Stream Dock WebSocket protocol.
// Protocol per the StreamDock SDK templates (Elgato-compatible): the host launches us with
//   -port <n> -pluginUUID <uuid> -registerEvent <event> -info <json>
// and we register by sending { event, uuid } once the socket opens.
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const log = require('./log');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i].startsWith('-')) out[argv[i].slice(1)] = argv[i + 1];
  }
  return {
    port: out.port,
    pluginUUID: out.pluginUUID,
    registerEvent: out.registerEvent,
    info: out.info ? JSON.parse(out.info) : {},
  };
}

class Dock extends EventEmitter {
  constructor(argv = process.argv) {
    super();
    this.args = parseArgs(argv);
    this.ws = null;
  }

  connect() {
    const { port, pluginUUID, registerEvent } = this.args;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('open', () => {
      this.ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
      this.emit('connected');
    });
    this.ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { log.warn('bad message', raw.toString()); return; }
      this.emit('message', msg);
      if (msg.event) this.emit(msg.event, msg);
    });
    // The host closes the socket when it wants the plugin gone; exit like the templates do.
    this.ws.on('close', () => { log.info('socket closed, exiting'); process.exit(0); });
    this.ws.on('error', err => log.error('socket error', String(err)));
  }

  send(event, context, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = { event };
    if (context !== undefined) msg.context = context;
    if (payload !== undefined) msg.payload = payload;
    this.ws.send(JSON.stringify(msg));
  }

  // target: 0 = hardware and software, 1 = hardware only, 2 = software only
  setImage(context, image, target = 0) { this.send('setImage', context, { image, target }); }
  setTitle(context, title, target = 0) { this.send('setTitle', context, { title, target }); }
  setState(context, state) { this.send('setState', context, { state }); }
  showAlert(context) { this.send('showAlert', context); }
  showOk(context) { this.send('showOk', context); }
}

module.exports = { Dock, parseArgs };
