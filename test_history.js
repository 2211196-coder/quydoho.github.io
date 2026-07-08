const WebSocket = require('ws');
const url = 'wss://xiaozhi-ws-proxy.blublaspeakup.workers.dev/?target=wss%3A%2F%2Fapi.tenclass.net%2Fxiaozhi%2Fv1%2F&token=test-token&device_id=8f%3A58%3A4e%3A7c%3A75%3A94&client_id=df0270a5-584c-4992-b33f-37092d81c55a';

function connect(text, onFinished) {
  const ws = new WebSocket(url);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') {
        ws.send(JSON.stringify({ type: 'listen', state: 'detect', text }));
      } else if (msg.type === 'tts' && msg.state === 'sentence_end') {
        console.log('AI:', msg.text);
      } else if (msg.type === 'tts' && msg.state === 'stop') {
        ws.close();
        onFinished();
      }
    } catch(e) {}
  });
}

console.log('Connecting 1...');
connect('Hello, my name is John!', () => {
  console.log('Finished 1. Waiting 2 seconds...');
  setTimeout(() => {
    console.log('Connecting 2...');
    connect('What is my name?', () => {
      console.log('Done!');
      process.exit(0);
    });
  }, 2000);
});
