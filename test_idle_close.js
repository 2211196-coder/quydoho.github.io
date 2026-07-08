const WebSocket = require('ws');
const url = 'wss://xiaozhi-ws-proxy.blublaspeakup.workers.dev/?target=wss%3A%2F%2Fapi.tenclass.net%2Fxiaozhi%2Fv1%2F&token=test-token&device_id=8f%3A58%3A4e%3A7c%3A75%3A94&client_id=df0270a5-584c-4992-b33f-37092d81c55a';

const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
  
  // We ONLY send the Cloudflare ping byte, NO JSON PING!
  setInterval(() => {
    ws.send(new Uint8Array([0x00]).buffer);
  }, 25000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'hello') {
      console.log('Got hello. Waiting for server to close us...');
    }
  } catch(e) {}
});

ws.on('close', (code) => {
  console.log('Server closed connection! Code:', code);
  process.exit(0);
});

setTimeout(() => {
  console.log('Waited 80 seconds. Server did NOT close connection!');
  process.exit(1);
}, 80000);
