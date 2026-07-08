const WebSocket = require('ws');
const url = 'wss://xiaozhi-ws-proxy.blublaspeakup.workers.dev/?target=wss%3A%2F%2Fapi.tenclass.net%2Fxiaozhi%2Fv1%2F&token=test-token&device_id=8f%3A58%3A4e%3A7c%3A75%3A94&client_id=df0270a5-584c-4992-b33f-37092d81c55a';

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('Sending hello...');
  ws.send(JSON.stringify({ type: 'hello', version: 3, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
  
  console.log('Sending detect IMMEDIATELY...');
  ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'hello' }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'tts' && msg.state === 'stop') {
      console.log('Got TTS response! Test passed!');
      process.exit(0);
    }
  } catch(e) {}
});

setTimeout(() => {
  console.log('Timeout 10s. Did not get TTS response. Test failed!');
  process.exit(1);
}, 10000);
