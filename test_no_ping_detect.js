const WebSocket = require('ws');
const url = 'wss://xiaozhi-ws-proxy.blublaspeakup.workers.dev/?target=wss%3A%2F%2Fapi.tenclass.net%2Fxiaozhi%2Fv1%2F&token=test-token&device_id=8f%3A58%3A4e%3A7c%3A75%3A94&client_id=df0270a5-584c-4992-b33f-37092d81c55a';

const ws = new WebSocket(url);
let isWaiting = false;

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
      ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'hello' }));
    } else if (msg.type === 'tts' && msg.state === 'stop') {
      if (!isWaiting) {
        isWaiting = true;
        console.log('Got first TTS stop. Waiting 80 seconds...');
        setTimeout(() => {
          console.log('Sending detect after 80s of NO JSON PING...');
          ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'are you there?' }));
        }, 80000);
      } else {
        console.log('Got second TTS stop! It WORKS WITHOUT JSON PING!');
        process.exit(0);
      }
    }
  } catch(e) {}
});

ws.on('close', (code) => {
  console.log('Server closed connection! Code:', code);
  process.exit(1);
});
