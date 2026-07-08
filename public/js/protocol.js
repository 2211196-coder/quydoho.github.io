/**
 * WebSocket Protocol
 * Port of py-xiaozhi's WebsocketProtocol
 *
 * Browser WebSocket can't send custom HTTP headers, so we use a
 * Cloudflare Worker proxy that adds headers on the server side.
 *
 * Set WS_PROXY_URL in main.js to your deployed worker URL.
 */

const FRAME_DURATION = 60;
const INPUT_SAMPLE_RATE = 16000;
const CHANNELS = 1;

// Keepalive constants
const PING_BYTE = 0x00;
const PONG_BYTE = 0x01;
const KEEPALIVE_INTERVAL_MS = 25000;   // Send ping every 25 seconds
const HEALTH_TIMEOUT_MS = 65000;       // Consider dead if no activity for 65 seconds

export class XiaozhiProtocol {
  constructor() {
    this.ws = null;
    this.sessionId = '';
    this.connected = false;
    this._isClosing = false;
    this._deviceId = '';
    this._clientId = '';
    this._token = '';

    // Keepalive state
    this._keepAliveTimer = null;
    this._healthCheckTimer = null;
    this.lastActivityAt = 0;  // Timestamp of last received message (any type)

    // Callbacks
    this.onJson = null;
    this.onAudio = null;
    this.onOpened = null;
    this.onClosed = null;
    this.onError = null;
  }

  /**
   * Connect via Cloudflare Worker proxy (recommended).
   * The proxy adds auth headers that browser WS API can't send.
   */
  async connectViaProxy(proxyUrl, targetWsUrl, token, deviceId, clientId) {
    this._deviceId = deviceId;
    this._clientId = clientId;
    this._token = token;

    const wsUrl = new URL(proxyUrl);
    wsUrl.searchParams.set('target', targetWsUrl);
    wsUrl.searchParams.set('token', token);
    wsUrl.searchParams.set('device_id', deviceId);
    wsUrl.searchParams.set('client_id', clientId);

    console.log('[WS] Connecting via proxy:', wsUrl.toString());
    return this._doConnect(wsUrl.toString());
  }

  /**
   * Connect directly (works only if server accepts connections without auth headers).
   */
  async connectDirect(url, token, deviceId, clientId) {
    this._deviceId = deviceId;
    this._clientId = clientId;
    this._token = token;

    // Try with query params
    const wsUrl = new URL(url);
    wsUrl.searchParams.set('token', token);
    wsUrl.searchParams.set('device_id', deviceId);
    wsUrl.searchParams.set('client_id', clientId);

    console.log('[WS] Connecting directly:', wsUrl.toString());
    return this._doConnect(wsUrl.toString());
  }

  _doConnect(urlString) {
    if (this._isClosing) return Promise.resolve(false);

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(urlString);
        this.ws.binaryType = 'arraybuffer';

        let helloTimeout = null;
        let resolved = false;

        const finish = (ok) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(helloTimeout);
          resolve(ok);
        };

        this.ws.onopen = () => {
          console.log('[WS] Connected, sending hello...');
          const sendHelloSafe = () => {
            if (!this.ws) {
              finish(false);
              return;
            }
            if (this.ws.readyState === WebSocket.OPEN) {
              try {
                this._sendHello();
                helloTimeout = setTimeout(() => {
                  console.error('[WS] Hello timeout');
                  finish(false);
                  try { this.ws.close(); } catch {}
                }, 10000);
              } catch (err) {
                console.error('[WS] Error sending hello:', err);
                finish(false);
              }
            } else if (this.ws.readyState === WebSocket.CONNECTING) {
              console.log('[WS] Socket still connecting, retrying in 50ms...');
              setTimeout(sendHelloSafe, 50);
            } else {
              console.error('[WS] Socket in invalid state:', this.ws.readyState);
              finish(false);
            }
          };
          sendHelloSafe();
        };

        this.ws.onmessage = (event) => {
          // Track activity for health monitoring
          this.lastActivityAt = Date.now();

          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data);
            // Check for keepalive pong response (1 byte = 0x01)
            if (bytes.length === 1 && bytes[0] === PONG_BYTE) {
              // Pong received — connection is alive at proxy level, no further action needed
              return;
            }
            this.lastServerActivityAt = Date.now();
            if (this.onAudio) this.onAudio(bytes);
          } else {
            this.lastServerActivityAt = Date.now();
            try {
              const data = JSON.parse(event.data);
              console.log('[WS] JSON:', data.type);

              if (data.type === 'hello' && !resolved) {
                this.sessionId = data.session_id || '';
                this.connected = true;
                console.log('[WS] Hello OK, session:', this.sessionId);
                if (this.onOpened) this.onOpened();
                finish(true);
                return;
              }

              if (this.onJson) this.onJson(data);
            } catch (e) {
              console.error('[WS] Parse error:', e);
            }
          }
        };

        this.ws.onclose = (event) => {
          console.log('[WS] Closed:', event.code, event.reason);
          this.connected = false;
          finish(false);
          if (this.onClosed) this.onClosed();
        };

        this.ws.onerror = () => {
          console.error('[WS] Connection error');
          if (this.onError) this.onError('WebSocket error');
        };
      } catch (err) {
        console.error('[WS] Failed:', err);
        resolve(false);
      }
    });
  }

  _sendHello() {
    const hello = {
      type: 'hello',
      version: 1,
      features: { mcp: false },
      transport: 'websocket',
      audio_params: {
        format: 'opus',
        sample_rate: INPUT_SAMPLE_RATE,
        channels: CHANNELS,
        frame_duration: FRAME_DURATION,
      },
    };
    this.ws.send(JSON.stringify(hello));
    console.log('[WS] Sent hello');
  }

  sendAudio(opusData) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(opusData);
  }

  sendJson(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    data.session_id = this.sessionId;
    this.ws.send(JSON.stringify(data));
    console.log('[WS] Sent:', data.type);
  }

  startListening(mode = 'manual') { this.sendJson({ type: 'listen', state: 'start', mode }); }
  stopListening() { this.sendJson({ type: 'listen', state: 'stop' }); }
  abortSpeaking() { this.sendJson({ type: 'abort' }); }
  sendWakeWord(text) { this.sendJson({ type: 'listen', state: 'detect', text }); }

  close() {
    this._isClosing = true;
    this.connected = false;
    this.stopKeepAlive();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close(1000);
      } catch {}
      this.ws = null;
    }
    this._isClosing = false;
  }

  // ─── Keepalive Ping/Pong ─────────────────────

  /**
   * Start sending periodic binary pings to keep the connection alive.
   * The Cloudflare Worker proxy intercepts these and replies with pong.
   * Also starts a health check timer that monitors lastActivityAt.
   */
  startKeepAlive() {
    this.stopKeepAlive();
    this.lastActivityAt = Date.now();
    this.lastPongTime = Date.now();
    this.lastServerActivityAt = Date.now();

    // Send binary ping every 25 seconds
    this._keepAliveTimer = setInterval(() => {
      if (this.isOpen) {
        try {
          // Send 1-byte ping for Cloudflare worker interception (health check pong)
          this.ws.send(new Uint8Array([PING_BYTE]).buffer);

          // Check proxy health
          if (Date.now() - this.lastPongTime > HEALTH_TIMEOUT_MS) {
            console.warn('[WS] Proxy health check failed, closing connection');
            this.close();
            return;
          }

          // Check server idle state (zombie connection prevention)
          if (Date.now() - this.lastServerActivityAt > 55000) {
            console.warn('[WS] Server idle timeout (55s), proactively closing to prevent zombie state');
            this.close();
          }
        } catch (e) {
          console.error('[WS] Ping send error:', e);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    // Health check: if no activity for 65 seconds, force close
    this._healthCheckTimer = setInterval(() => {
      if (!this.connected) return;
      const elapsed = Date.now() - this.lastActivityAt;
      if (elapsed > HEALTH_TIMEOUT_MS) {
        console.error(`[WS] No activity for ${Math.round(elapsed / 1000)}s — connection presumed dead, closing.`);
        try { this.ws.close(4000, 'keepalive timeout'); } catch {}
      }
    }, 15000); // Check every 15 seconds

    console.log('[WS] Keepalive started (ping every 25s, health check every 15s)');
  }

  stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  get isOpen() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
