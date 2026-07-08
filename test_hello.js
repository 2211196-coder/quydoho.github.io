const WebSocket = require('ws');
const url = 'wss://xiaozhi-ws-proxy.blublaspeakup.workers.dev/?target=wss%3A%2F%2Fapi.tenclass.net%2Fxiaozhi%2Fv1%2F&token=test-token&device_id=8f%3A58%3A4e%3A7c%3A75%3A94&client_id=df0270a5-584c-4992-b33f-37092d81c55a';

const ws = new WebSocket(url);
let messageCount = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
});

setInterval(() => { ws.send(JSON.stringify({ type: 'ping' })); }, 25000);

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'hello') {
      messageCount++;
      if (messageCount === 1) {
        ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'Call me John' }));
      } else {
        console.log('Received second hello! Asking name...');
        ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'What did I tell you to call me?' }));
      }
    } else if (msg.type === 'tts' && msg.state === 'sentence_end') {
      console.log('AI:', msg.text);
    } else if (msg.type === 'tts' && msg.state === 'stop') {
      if (messageCount === 1) {
        console.log('Waiting 70s to idle...');
        setTimeout(() => {
           console.log('Sending hello to wake up...');
           ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
        }, 70000);
      } else {
        process.exit(0);
      }
    }
  } catch(e) {}
});
