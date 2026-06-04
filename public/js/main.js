/**
 * Nova Speaking Practice — Main Application (3-Column Layout)
 * State machine: IDLE → CONNECTING → LISTENING → SPEAKING
 */

import { DeviceManager } from './device.js';
import { OtaClient } from './ota.js';
import { XiaozhiProtocol } from './protocol.js';
import { AudioPipeline } from './audio.js';
import { ActivationManager } from './activation.js';

// ─── Configuration ───────────────────────────────
const WS_PROXY_URL = 'wss://xiaozhi-ws-proxy.kdcdigibots.workers.dev/';

// Dynamic path resolver for static hosting deployments
const mainScript = document.querySelector('script[src*="main.js"]');
const mainScriptSrc = mainScript ? mainScript.getAttribute('src') : '';
const assetsPrefix = mainScriptSrc.includes('public/') ? 'public/' : '';

function getApiUrl(path) {
  const customBackend = localStorage.getItem('custom_backend_url') || 'https://quydoho-github-io.vercel.app';
  if (customBackend) {
    const base = customBackend.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return base + cleanPath;
  }
  return path;
}


const DEFAULT_EMOTIONS = {
  neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry',
  shocked: 'shocked', surprised: 'shocked', scared: 'shocked',
};

// Emotion mapping
let EMOTIONS = { ...DEFAULT_EMOTIONS };

const savedEmotions = localStorage.getItem('xiaozhi_emotions');
if (savedEmotions) {
  try {
    EMOTIONS = { ...EMOTIONS, ...JSON.parse(savedEmotions) };
  } catch (e) {
    console.warn('Failed to parse saved emotions');
  }
}

const STATE = { IDLE: 'idle', CONNECTING: 'connecting', LISTENING: 'listening', SPEAKING: 'speaking' };

// ─── Chatbots & Agents Definitions ────────────────
const CHATBOTS = {
  teacher: {
    id: 'teacher',
    name: 'Cô Hoa (Teacher)',
    displayName: 'Cô Hoa',
    role: 'Teacher',
    topic: 'job_interview',
    topicEn: 'Job Interview',
    topicVi: 'Phỏng vấn',
    emoji: '👩‍🏫',
    greeting: 'Hi there! I am Ms. Hoa, your interviewer today. 💼 Let\'s practice a Job Interview. To begin, tell me, why do you want this job?'
  },
  cashier: {
    id: 'cashier',
    name: 'Linda (Cashier)',
    displayName: 'Linda',
    role: 'Cashier',
    topic: 'shopping',
    topicEn: 'Shopping & Payment',
    topicVi: 'Mua sắm & Thanh toán',
    emoji: '💸',
    greeting: 'Hello! Welcome to Nova Supermarket. 🛍️ Did you find everything you were looking for today?'
  },
  receptionist: {
    id: 'receptionist',
    name: 'Sophia (Receptionist)',
    displayName: 'Sophia',
    role: 'Hotel Receptionist',
    topic: 'hotel_checkin',
    topicEn: 'Hotel Check-in',
    topicVi: 'Khách sạn',
    emoji: '🏨',
    greeting: 'Welcome to Grand Plaza Hotel! 🏨 I am Sophia, the receptionist. How can I help you with your booking or checking in today?'
  },
  airport: {
    id: 'airport',
    name: 'David (Airport Staff)',
    displayName: 'David',
    role: 'Airport Staff',
    topic: 'airport_checkin',
    topicEn: 'Airport Service',
    topicVi: 'Dịch vụ sân bay',
    emoji: '✈️',
    greeting: 'Hello! Welcome to Nova Airlines check-in counter. ✈️ Can I please see your passport and flight ticket?'
  },
  guide: {
    id: 'guide',
    name: 'Jack (Local Guide)',
    displayName: 'Jack',
    role: 'Local Guide',
    topic: 'asking_directions',
    topicEn: 'Asking Directions',
    topicVi: 'Chỉ đường',
    emoji: '🗺️',
    greeting: 'Excuse me! Are you lost? 🗺️ I can help you find your way around this beautiful city. Where are you trying to go?'
  },
  shopping: {
    id: 'shopping',
    name: 'Emily (Shopping Assistant)',
    displayName: 'Emily',
    role: 'Shopping Assistant',
    topic: 'clothing_shopping',
    topicEn: 'Clothing Shopping',
    topicVi: 'Mua sắm quần áo',
    emoji: '👗',
    greeting: 'Hello! Welcome to TrendStyle Boutique. 👗 I am Emily, your shopping assistant today. Are you looking for anything specific, or just browsing?'
  }
};

class App {
  constructor() {
    this.currentChatbotId = 'teacher';
    
    // Create separate DeviceManager profiles for each chatbot
    this.devices = {};
    Object.keys(CHATBOTS).forEach(key => {
      this.devices[key] = new DeviceManager(key);
    });
    this.chatHistories = {};
    Object.keys(CHATBOTS).forEach(key => {
      this.chatHistories[key] = JSON.parse(localStorage.getItem(`xiaozhi_history_${key}`) || '[]');
    });
    
    this.ota = null;
    this.protocol = new XiaozhiProtocol();
    this.audio = new AudioPipeline();
    this.state = STATE.IDLE;
    this.keepListening = false;
    this.currentTopic = null;
    this.shouldReconnect = false;
    this.reconnectTimeout = null;
    this.heartbeatInterval = null;
    this.reconnectAttempts = 0;

    this.$ = {
      app: document.getElementById('app'),
      activationView: document.getElementById('activation-view'),
      emptyView: document.getElementById('empty-view'),
      mainView: document.getElementById('main-view'),
      settingsView: document.getElementById('settings-view'),
      connectionView: document.getElementById('connection-view'),
      connectionBtn: document.getElementById('connection-btn'),
      closeConnectionBtn: document.getElementById('close-connection-btn'),
      chatbotSidebar: document.getElementById('chatbot-sidebar'),
      chatbotList: document.getElementById('chatbot-list'),
      chatbotCards: {},
      statusBadges: {},
      topicBadge: document.getElementById('topic-badge'),
      mobileMenuBtn: document.getElementById('mobile-menu-btn'),
      emotionImg: document.getElementById('emotion-img'),
      statusText: document.getElementById('status-text'),
      chatLog: document.getElementById('chat-log'),
      talkBtn: document.getElementById('talk-btn'),
      stopBtn: document.getElementById('stop-btn'),
      codeDisplay: document.getElementById('code-display'),
      activationStatus: document.getElementById('activation-status'),
      textInput: document.getElementById('text-input'),
      sendBtn: document.getElementById('send-btn'),
      debugInfo: document.getElementById('debug-info'),
      settingsBtn: document.getElementById('settings-btn'),
      closeSettingsBtn: document.getElementById('close-settings-btn'),
      saveEmojiBtn: document.getElementById('save-emoji-btn'),
      resetEmojiBtn: document.getElementById('reset-emoji-btn'),
      resetBtn: document.getElementById('reset-btn'),

      // Device manual edit settings
      deviceSnInput: document.getElementById('device-sn-input'),
      deviceMacInput: document.getElementById('device-mac-input'),
      deviceHmacInput: document.getElementById('device-hmac-input'),
      saveDeviceSettingsBtn: document.getElementById('save-device-settings-btn'),

      // Groq settings
      groqApiKeyInput: document.getElementById('groq-api-key-input'),
      groqModelInput: document.getElementById('groq-model-input'),
      backendUrlInput: document.getElementById('backend-url-input'),
      saveApiSettingsBtn: document.getElementById('save-api-settings-btn'),

      // Suggestion sidebar
      suggestionSidebar: document.getElementById('suggestion-sidebar'),
      suggestionStatus: document.getElementById('suggestion-status'),
      suggestionList: document.getElementById('suggestion-list'),

      // Translation Box
      transInput: document.getElementById('translation-input'),
      transBtn: document.getElementById('translation-btn'),
      transSelect: document.getElementById('translation-direction'),
      transOutput: document.getElementById('translation-output'),

      emojiSlots: {
        neutral: document.getElementById('emoji-neutral'),
        happy: document.getElementById('emoji-happy'),
        sad: document.getElementById('emoji-sad'),
        angry: document.getElementById('emoji-angry'),
        shocked: document.getElementById('emoji-shocked'),
      }
    };

    // Dynamically bind cards and status badges
    Object.keys(CHATBOTS).forEach(key => {
      this.$.chatbotCards[key] = document.querySelector(`[data-chatbot="${key}"]`);
      this.$.statusBadges[key] = document.getElementById(`status-badge-${key}`);
    });

    // Make App instance globally accessible for inline callback hooks
    window.appInstance = this;
  }

  async init() {
    // Load Groq Config from localStorage
    const savedApiKey = localStorage.getItem('groq_api_key') || '';
    let savedModel = localStorage.getItem('groq_model') || 'llama-3.1-8b-instant';
    if (savedModel === 'mixtral-8x7b-32768') {
      savedModel = 'llama-3.1-8b-instant';
      localStorage.setItem('groq_model', 'llama-3.1-8b-instant');
    }
    const savedBackendUrl = localStorage.getItem('custom_backend_url') || '';
    this.$.groqApiKeyInput.value = savedApiKey;
    this.$.groqModelInput.value = savedModel;
    if (this.$.backendUrlInput) this.$.backendUrlInput.value = savedBackendUrl;

    // Initialize all device profiles
    for (const key of Object.keys(CHATBOTS)) {
      await this.devices[key].init();
      this._updateStatusBadge(key);
    }

    this.ota = new OtaClient(this.currentDevice);

    await this.audio.init();
    this.audio.onEncoded = (data) => this.protocol.sendAudio(data);

    this.protocol.onJson = (data) => this._onJson(data);
    this.protocol.onAudio = (data) => this.audio.decodeAudio(data);
    this.protocol.onOpened = () => this._onChannelOpened();
    this.protocol.onClosed = () => this._onChannelClosed();
    this.protocol.onError = (msg) => this._addChatUI('system', `Lỗi: ${msg}`);
    
    this._initSettings();
    this._bindEvents();

    // Initialize Theme (Dark/Light mode)
    this.theme = localStorage.getItem('theme') || 'dark';
    this._applyTheme();

    // Select default chatbot
    this._selectChatbot(this.currentChatbotId, true);
  }

  get currentDevice() {
    return this.devices[this.currentChatbotId];
  }

  _updateStatusBadge(chatbotId) {
    const badge = this.$.statusBadges[chatbotId];
    if (!badge) return;
    if (this.devices[chatbotId].isActivated) {
      badge.textContent = 'ONLINE';
      badge.className = 'status-badge online';
    } else {
      badge.textContent = 'KÍCH HOẠT';
      badge.className = 'status-badge offline';
    }
  }

  async _selectChatbot(chatbotId, force = false) {
    if (chatbotId === this.currentChatbotId && !force) return;

    console.log(`[App] Selecting chatbot: ${chatbotId}`);
    
    // Disconnect if active
    this.shouldReconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this._stopHeartbeat();
    this.protocol.close();
    this.audio.stopCapture();
    this._stopConversation();

    // Update active UI cards
    Object.keys(this.$.chatbotCards).forEach(key => {
      if (this.$.chatbotCards[key]) {
        if (key === chatbotId) {
          this.$.chatbotCards[key].classList.add('active');
        } else {
          this.$.chatbotCards[key].classList.remove('active');
        }
      }
    });

    this.currentChatbotId = chatbotId;
    this.ota = new OtaClient(this.currentDevice);

    // Update body theme color based on Chatbot selection
    document.body.classList.remove('theme-teacher', 'theme-cashier', 'theme-receptionist', 'theme-airport', 'theme-guide', 'theme-shopping');
    document.body.classList.add(`theme-${chatbotId}`);

    const botConfig = CHATBOTS[chatbotId];
    this.currentTopic = {
      key: botConfig.topic,
      en: botConfig.topicEn,
      vi: botConfig.topicVi,
      role: botConfig.role
    };

    // Update Header UIs
    this.$.topicBadge.textContent = botConfig.topicEn;
    this.$.topicBadge.title = botConfig.topicVi;
    document.getElementById('main-header-title').textContent = `✨ ${botConfig.name}`;

    // Reload conversation history
    this.$.chatLog.innerHTML = '';
    const history = this.chatHistories[chatbotId];
    if (history && history.length > 0) {
      history.forEach(msg => {
        this._addChatUI(msg.role, msg.text);
      });
      // Fetch suggestions if last message was from AI
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === 'ai') {
        this._fetchSuggestions();
      } else {
        this._showSuggestionPlaceholder();
      }
    } else {
      // Send fresh greeting
      this._addChat('ai', botConfig.greeting);
      this._showSuggestionPlaceholder();
    }

    this._updateDebugInfo();

    // Check device activation
    if (this.currentDevice.isActivated) {
      this.$.activationView.classList.add('hidden');
      this.$.mainView.classList.remove('hidden');
      // Automatically connect to the chatbot in the background after switching
      setTimeout(() => this._ensureConnected(), 300);
    } else {
      this.$.activationView.classList.remove('hidden');
      this.$.mainView.classList.add('hidden');
      await this._runActivation();
    }

    // Close mobile side menu
    this.$.chatbotSidebar.classList.remove('show-mobile');
  }

  // ─── Activation ────────────────────────────────

  async _runActivation() {
    this.$.activationView.classList.remove('hidden');
    this.$.mainView.classList.add('hidden');
    this.$.settingsView.classList.add('hidden');

    const activation = new ActivationManager(this.currentDevice, this.ota, {
      onStatus: (msg) => { this.$.activationStatus.textContent = msg; },
      onCode: (code, msg) => {
        this.$.codeDisplay.textContent = code;
        this.$.activationStatus.textContent = msg;
      },
      onError: (msg) => { this.$.activationStatus.textContent = `❌ ${msg}`; },
    });

    const success = await activation.run();
    if (success) {
      try { await this.ota.fetchConfig(); } catch {}
      this._updateDebugInfo();
      this._updateStatusBadge(this.currentChatbotId);
      
      this.$.activationView.classList.add('hidden');
      this.$.mainView.classList.remove('hidden');
      
      // Send greeting after successful activation
      const botConfig = CHATBOTS[this.currentChatbotId];
      if (this.chatHistories[this.currentChatbotId].length === 0) {
        this._addChat('ai', botConfig.greeting);
      }
    }
  }

  // ─── Settings ──────────────────────────────────

  _initSettings() {
    // Populate emoji slots with current mapping
    for (const [key, slot] of Object.entries(this.$.emojiSlots)) {
      if (EMOTIONS[key]) {
        slot.dataset.mapped = EMOTIONS[key];
        slot.innerHTML = `<img src="${assetsPrefix}assets/emojis/${EMOTIONS[key]}.gif" alt="${EMOTIONS[key]}">`;
      }
    }
    this._bindDragEvents();
  }

  _bindDragEvents() {
    const draggables = document.querySelectorAll('.emoji-draggable');
    draggables.forEach(draggable => {
      draggable.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', draggable.dataset.name);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });

    const slots = Object.values(this.$.emojiSlots);
    slots.forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        slot.classList.add('drag-over');
      });

      slot.addEventListener('dragleave', (e) => {
        slot.classList.remove('drag-over');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const emojiName = e.dataTransfer.getData('text/plain');
        if (emojiName) {
          slot.dataset.mapped = emojiName;
          slot.innerHTML = `<img src="${assetsPrefix}assets/emojis/${emojiName}.gif" alt="${emojiName}">`;
        }
      });
    });
  }

  _toggleSettings() {
    if (this.$.settingsView.classList.contains('hidden')) {
      // Opening settings
      this.wasActivationVisible = !this.$.activationView.classList.contains('hidden');
      this.$.settingsView.classList.remove('hidden');
      this.$.mainView.classList.add('hidden');
      this.$.activationView.classList.add('hidden');
    } else {
      // Closing settings
      this.$.settingsView.classList.add('hidden');
      if (this.wasActivationVisible) {
        this.$.activationView.classList.remove('hidden');
      } else {
        this.$.mainView.classList.remove('hidden');
      }
    }
  }

  _resetEmojiMapping() {
    if (this._emojiConfirmState) {
      EMOTIONS = { ...DEFAULT_EMOTIONS };
      localStorage.removeItem('xiaozhi_emotions');
      this._initSettings();
      alert('Đã khôi phục!');
      this._emojiConfirmState = false;
      this.$.resetEmojiBtn.textContent = 'Mặc định';
    } else {
      this._emojiConfirmState = true;
      this.$.resetEmojiBtn.textContent = 'Bấm xác nhận';
      setTimeout(() => {
        this._emojiConfirmState = false;
        this.$.resetEmojiBtn.textContent = 'Mặc định';
      }, 3000);
    }
  }

  _saveEmojiMapping() {
    const newMapping = {};
    for (const [key, slot] of Object.entries(this.$.emojiSlots)) {
      if (slot.dataset.mapped) {
        newMapping[key] = slot.dataset.mapped;
      }
    }
    EMOTIONS = { ...EMOTIONS, ...newMapping };
    localStorage.setItem('xiaozhi_emotions', JSON.stringify(newMapping));
    alert('Đã lưu thiết lập biểu cảm!');
  }

  // ─── Main View ────────────────────────────────

  _setState(newState) {
    this.state = newState;
    const labels = {
      [STATE.IDLE]: 'Đang chờ',
      [STATE.CONNECTING]: 'Đang kết nối...',
      [STATE.LISTENING]: '🎤 Đang nghe...',
      [STATE.SPEAKING]: '🔊 Đang nói...',
    };
    this.$.statusText.textContent = labels[newState] || newState;
    this.$.talkBtn.disabled = newState === STATE.CONNECTING;
    this.$.stopBtn.disabled = newState === STATE.IDLE;
    this.$.statusText.className = `status-text status-${newState}`;
  }

  _setEmotion(name) {
    const mapped = EMOTIONS[name] || 'neutral';
    this.$.emotionImg.src = `${assetsPrefix}assets/emojis/${mapped}.gif`;
    this.$.emotionImg.alt = mapped;
  }

  // ─── Protocol Actions ──────────────────────────

  async _ensureConnected() {
    if (this.protocol.isOpen) return true;

    this.shouldReconnect = true;
    this._setState(STATE.CONNECTING);

    this._addChatUI('system', 'Đang lấy cấu hình...');
    try {
      const otaData = await this.ota.fetchConfig();
      this._updateDebugInfo();

      // Check if the server requires activation (means unactivated MAC or revoked on xiaozhi.me)
      if (otaData && otaData.activation) {
        console.warn('[App] Device requires activation, redirecting...');
        this._addChatUI('system', '⚠️ Thiết bị này chưa được kích hoạt hoặc đã bị hủy trên xiaozhi.me!');
        this.currentDevice.setActivated(false);
        this._setState(STATE.IDLE);
        this.shouldReconnect = false;
        
        // Open the activation view automatically
        setTimeout(() => this._selectChatbot(this.currentChatbotId, true), 500);
        return false;
      }
    } catch (err) {
      this._addChatUI('system', `Lỗi OTA: ${err.message}`);
    }

    const url = this.currentDevice.websocketUrl;
    const token = this.currentDevice.websocketToken;

    if (!url) {
      this._addChatUI('system', '❌ Chưa có WebSocket URL. Vui lòng thử lại.');
      this._setState(STATE.IDLE);
      return false;
    }

    let ok = false;

    if (WS_PROXY_URL) {
      this._addChatUI('system', 'Kết nối qua proxy...');
      ok = await this.protocol.connectViaProxy(
        WS_PROXY_URL, url, token, this.currentDevice.deviceId, this.currentDevice.clientId
      );
    } else {
      this._addChatUI('system', 'Kết nối trực tiếp (không có proxy)...');
      ok = await this.protocol.connectDirect(url, token, this.currentDevice.deviceId, this.currentDevice.clientId);
    }

    if (!ok) {
      this._addChatUI('system', '❌ Không kết nối được. Vui lòng thử lại.');
      this._setState(STATE.IDLE);
      return false;
    }

    this._addChatUI('system', '✅ Đã kết nối!');

    // Send strict role-bound topic context to AI after connection
    if (this.currentTopic) {
      let topicContext = `SYSTEM INSTRUCTION: You are ${this.currentTopic.role} in this conversation. We are practicing English speaking about the topic "${this.currentTopic.en}" (${this.currentTopic.vi}). STRICT RULE: You MUST strictly stick to your role and this specific scenario. Do not discuss any other topics. If the user asks you anything unrelated or tries to change the subject, politely refuse and redirect them back to the English practice scenario for "${this.currentTopic.en}". Let's start the conversation naturally based on your role!`;
      topicContext = topicContext.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
      this.protocol.sendWakeWord(topicContext);
    }

    return true;
  }

  async _startManualListening() {
    if (!(await this._ensureConnected())) return;
    this.keepListening = false;
    if (this.state === STATE.SPEAKING) {
      this.protocol.abortSpeaking();
      this.audio.clearPlaybackQueue();
    }
    await this.audio.startCapture();
    this.protocol.startListening('manual');
    this._setState(STATE.LISTENING);
  }

  _stopManualListening() {
    if (this.state !== STATE.LISTENING) return;
    this.audio.stopCapture();
    this.protocol.stopListening();
    this._setState(STATE.IDLE);
  }

  async _startAutoConversation() {
    if (!(await this._ensureConnected())) return;
    this.keepListening = true;
    await this.audio.startCapture();
    this.protocol.startListening('auto');
    this._setState(STATE.LISTENING);
  }

  _stopConversation() {
    this.keepListening = false;
    this.audio.stopCapture();
    this.audio.clearPlaybackQueue();
    if (this.protocol.isOpen) this.protocol.abortSpeaking();
    this._setState(STATE.IDLE);
  }

  async _sendText(text) {
    const cleanText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanText) return;
    if (!(await this._ensureConnected())) return;
    
    if (this.state === STATE.SPEAKING) {
      this.audio.clearPlaybackQueue();
      this.protocol.abortSpeaking();
      // Add a small 150ms delay to let the server abort and transition states cleanly
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    this._addChat('user', cleanText);
    
    // Simulate a complete speech manual turn to trigger the backend's LLM state machine
    this.protocol.startListening('manual'); // Sends { type: 'listen', state: 'start', mode: 'manual' }
    await new Promise(resolve => setTimeout(resolve, 50));
    this.protocol.sendWakeWord(cleanText);  // Sends { type: 'listen', state: 'detect', text: cleanText }
    await new Promise(resolve => setTimeout(resolve, 50));
    this.protocol.stopListening();          // Sends { type: 'listen', state: 'stop' }
    
    this.$.textInput.value = '';
  }

  // ─── Protocol Callbacks ────────────────────────

  _onChannelOpened() {
    console.log('[App] Channel opened');
    this.reconnectAttempts = 0; // Reset reconnect attempts on success
    this._addChatUI('system', '🟢 Kênh audio đã mở');
    this._startHeartbeat();
  }

  _onChannelClosed() {
    console.log('[App] Channel closed');
    this.audio.stopCapture();
    this._setState(STATE.IDLE);
    this._addChatUI('system', '🔴 Kết nối đã đóng');
    this._stopHeartbeat();

    if (this.shouldReconnect) {
      const maxAttempts = 3;
      if (this.reconnectAttempts >= maxAttempts) {
        console.warn('[App] Max reconnect attempts reached, stopping.');
        this._addChatUI('system', `⚠️ Không thể kết nối ổn định sau ${maxAttempts} lần thử. Vui lòng:
        1. Kiểm tra lại thông tin Thiết bị (MAC/SN/HMAC Key) trong mục Cài đặt.
        2. Đảm bảo địa chỉ MAC này đã được kích hoạt & gán cấu hình tiếng Anh trên xiaozhi.me.
        3. Nhấn "Lưu Cấu Hình Thiết Bị" để bắt đầu kết nối lại.`);
        this.shouldReconnect = false;
        this.reconnectAttempts = 0;
        return;
      }

      this.reconnectAttempts++;
      // Exponential backoff: 3s, 6s, 12s
      const delay = 3000 * Math.pow(2, this.reconnectAttempts - 1);
      
      this._addChatUI('system', `⏳ Thử kết nối lại tự động sau ${delay / 1000} giây... (Lần ${this.reconnectAttempts}/${maxAttempts})`);
      
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (this.shouldReconnect && !this.protocol.isOpen) {
          this._ensureConnected();
        }
      }, delay);
    }
  }

  _startHeartbeat() {
    // Native WebSocket handles ping-pong automatically at the protocol layer.
    // Application-level JSON pings are not supported by Tenclass backend and cause disconnections.
    this._stopHeartbeat();
  }

  _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _onJson(data) {
    const type = data.type;

    if (type === 'tts') {
      if (data.state === 'start') this._setState(STATE.SPEAKING);
      else if (data.state === 'stop') {
        if (this.keepListening) {
          this._setState(STATE.LISTENING);
          this.protocol.startListening('auto');
        } else {
          this._setState(STATE.IDLE);
        }
        // AI finished speaking, trigger suggestions
        this._fetchSuggestions();
      }
      if (data.text) this._addChat('ai', data.text);
    }

    if (type === 'stt' && data.text) this._addChat('user', data.text);
    if (type === 'llm' && data.emotion) this._setEmotion(data.emotion);
  }

  // ─── Suggestion Actions ────────────────────────

  _showSuggestionPlaceholder() {
    this.$.suggestionList.classList.add('hidden');
    this.$.suggestionStatus.classList.remove('hidden');
    this.$.suggestionStatus.innerHTML = `
      <div class="status-placeholder">
        <span class="placeholder-icon">💬</span>
        <p>Hội thoại với chatbot để xem gợi ý trả lời thông minh tại đây.</p>
      </div>
    `;
  }

  async _fetchSuggestions() {
    const history = this.chatHistories[this.currentChatbotId];
    if (!history || history.length === 0) {
      this._showSuggestionPlaceholder();
      return;
    }

    // Show loading spinner
    this.$.suggestionList.classList.add('hidden');
    this.$.suggestionStatus.classList.remove('hidden');
    this.$.suggestionStatus.innerHTML = `
      <div class="suggestion-loader">
        <div class="spinner"></div>
        <p>Đang tìm gợi ý phản hồi...</p>
      </div>
    `;

    // Map conversation history
    const messages = history
      .filter(msg => msg.role === 'user' || msg.role === 'ai')
      .map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.text
      }));

    if (messages.length === 0) {
      this._showSuggestionPlaceholder();
      return;
    }

    const apiKey = localStorage.getItem('groq_api_key') || '';
    const model = localStorage.getItem('groq_model') || 'llama-3.1-8b-instant';

    try {
      const response = await fetch(getApiUrl('/api/suggest'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages,
          role: CHATBOTS[this.currentChatbotId].role,
          apiKey,
          model
        })
      });

      if (!response.ok) {
        let errMsg = `API suggest returned status ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) errMsg = errData.error;
          if (errData.details) errMsg = errData.details;
        } catch(e) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      
      if (data && data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        this.$.suggestionStatus.classList.add('hidden');
        this.$.suggestionList.classList.remove('hidden');
        this.$.suggestionList.innerHTML = data.suggestions.map(sug => {
          const safeEn = sug.en.replace(/'/g, "\\'").replace(/"/g, '&quot;');
          return `
            <div class="suggestion-item" onclick="window.appInstance.fillTextInput('${safeEn}')" style="cursor: pointer;" title="Bấm để chèn câu này vào ô chat">
              <div class="suggestion-header">
                <span class="suggestion-badge">💡 Gợi ý</span>
                <button class="btn-copy-sug" onclick="event.stopPropagation(); navigator.clipboard.writeText('${safeEn}'); window.appInstance.showToast('Đã sao chép câu gợi ý thành công! 📋');" title="Sao chép câu này">📋</button>
              </div>
              <div class="suggestion-en">${sug.en}</div>
              <div class="suggestion-vi">${sug.vi}</div>
            </div>
          `;
        }).join('');
      } else {
        throw new Error("Dữ liệu gợi ý không đúng định dạng");
      }
    } catch (err) {
      console.error('[Suggest] Error fetching suggestions:', err);
      this.$.suggestionStatus.classList.remove('hidden');
      this.$.suggestionStatus.innerHTML = `
        <div class="status-placeholder" style="color: var(--danger);">
          <span class="placeholder-icon">⚠️</span>
          <p>Lỗi tải gợi ý: ${err.message}</p>
        </div>
      `;
    }
  }

  // ─── UI Helpers ────────────────────────────────

  _addChat(role, text) {
    const history = this.chatHistories[this.currentChatbotId];
    
    if (role === 'ai' && history.length > 0 && history[history.length - 1].role === 'ai') {
      const lastMsg = history[history.length - 1];
      const cleanText = text.trim();
      const cleanLast = lastMsg.text.trim();

      // Normalize string for duplicate checks: strip punctuation and spacing
      const normalize = (str) => str.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"").replace(/\s+/g, " ").trim().toLowerCase();
      const normLast = normalize(cleanLast);
      const normNew = normalize(cleanText);

      // Deduplicate if the new text is already part of the end of the last message
      if (normLast.endsWith(normNew) || normLast === normNew) {
        console.log(`[Deduplicate] Skipping duplicate text: "${cleanText}"`);
        return;
      }

      // Merge text with appropriate spacing
      const separator = /[.!?]$/.test(lastMsg.text) ? ' ' : ' ';
      lastMsg.text = lastMsg.text + separator + cleanText;

      localStorage.setItem(`xiaozhi_history_${this.currentChatbotId}`, JSON.stringify(history));
      this._updateLastChatUI(role, lastMsg.text);
    } else {
      // General deduplication for any role if the exact same message is added consecutively
      if (history.length > 0) {
        const lastMsg = history[history.length - 1];
        const normalize = (str) => str.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"").replace(/\s+/g, " ").trim().toLowerCase();
        if (lastMsg.role === role && normalize(lastMsg.text) === normalize(text)) {
          console.log(`[Deduplicate] Skipping identical consecutive ${role} message`);
          return;
        }
      }
      history.push({ role, text });
      localStorage.setItem(`xiaozhi_history_${this.currentChatbotId}`, JSON.stringify(history));
      this._addChatUI(role, text);
    }
  }

  _updateLastChatUI(role, text) {
    const children = this.$.chatLog.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.classList.contains(`chat-${role}`)) {
        const label = role === 'ai' ? (CHATBOTS[this.currentChatbotId]?.displayName || 'Nova') : role === 'user' ? 'Bạn' : '⚙️';
        
        let innerHTML = `<span class="chat-label">${label}:</span> <span class="chat-text">${text}</span>`;
        if (role === 'ai') {
           const safeText = text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
           innerHTML += `<div class="chat-actions" style="margin-top: 6px; text-align: right;">
               <button class="btn-translate-inline" onclick="window.appInstance.translateInline(this, '${safeText}')" style="background: transparent; border: none; font-size: 0.85rem; color: #a5b4fc; cursor: pointer; padding: 0; opacity: 0.8;">Dịch sang tiếng Việt</button>
           </div>
           <div class="chat-translation hidden" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.2); font-size: 0.95rem; color: #e2e8f0; font-style: italic;"></div>`;
        }
        child.innerHTML = innerHTML;
        
        this.$.chatLog.scrollTop = this.$.chatLog.scrollHeight;
        return;
      }
    }
    // Fallback if not found
    this._addChatUI(role, text);
  }

  async translateInline(btn, text) {
    const translationDiv = btn.parentElement.nextElementSibling;
    
    // Toggle hide/show if already translated
    if (!translationDiv.classList.contains('hidden') && translationDiv.textContent) {
      translationDiv.classList.add('hidden');
      btn.textContent = 'Dịch sang tiếng Việt';
      return;
    }
    
    if (translationDiv.textContent) {
      translationDiv.classList.remove('hidden');
      btn.textContent = 'Ẩn bản dịch';
      return;
    }

    btn.textContent = 'Đang dịch...';
    btn.disabled = true;

    try {
      const apiKey = localStorage.getItem('groq_api_key') || '';
      const model = localStorage.getItem('groq_model') || 'llama-3.1-8b-instant';
      
      const response = await fetch(getApiUrl('/api/translate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, direction: 'en2vi', apiKey, model })
      });

      if (!response.ok) {
        let errMsg = `Translation failed: ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.details) errMsg = errData.details;
        } catch(e) {}
        throw new Error(errMsg);
      }
      
      const data = await response.json();
      translationDiv.textContent = data.translation;
      translationDiv.classList.remove('hidden');
      btn.textContent = 'Ẩn bản dịch';
      btn.disabled = false;
    } catch (err) {
      console.error(err);
      btn.textContent = 'Dịch lỗi! Thử lại';
      btn.disabled = false;
    }
  }

  _addChatUI(role, text) {
    const el = document.createElement('div');
    el.className = `chat-msg chat-${role}`;
    const label = role === 'ai' ? (CHATBOTS[this.currentChatbotId]?.displayName || 'Nova') : role === 'user' ? 'Bạn' : '⚙️';
    
    let innerHTML = `<span class="chat-label">${label}:</span> <span class="chat-text">${text}</span>`;
    if (role === 'ai') {
       const safeText = text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
       innerHTML += `<div class="chat-actions">
           <button class="btn-translate-inline" onclick="window.appInstance.translateInline(this, '${safeText}')">Dịch sang tiếng Việt</button>
       </div>
       <div class="chat-translation hidden"></div>`;
    }
    el.innerHTML = innerHTML;
    this.$.chatLog.appendChild(el);
    this.$.chatLog.scrollTop = this.$.chatLog.scrollHeight;
    while (this.$.chatLog.children.length > 50) {
      this.$.chatLog.removeChild(this.$.chatLog.firstChild);
    }
  }

  _updateDebugInfo() {
    if (!this.$.debugInfo) return;
    const d = this.currentDevice.data;

    // Cập nhật tiêu đề thiết bị cho Chatbot hiện tại trong modal Kết Nối
    const titleEl = document.getElementById('connection-device-title');
    const chatbotName = CHATBOTS[this.currentChatbotId]?.name || this.currentChatbotId;
    if (titleEl) {
      titleEl.textContent = `🔌 Quản Lý Kết Nối (${chatbotName})`;
    }
    this.$.debugInfo.textContent = [
      `SN: ${d?.serial_number || '—'}`,
      `Device: ${d?.device_id || '—'}`,
      `Activated: ${d?.activation_status}`,
      `WS: ${d?.websocket_url || '—'}`,
      `Proxy: ${WS_PROXY_URL || 'NOT SET'}`,
      `Topic: ${this.currentTopic?.en || '—'}`,
    ].join('\n');

    // Populate editable inputs with current values
    if (this.$.deviceSnInput) this.$.deviceSnInput.value = d?.serial_number || '';
    if (this.$.deviceMacInput) this.$.deviceMacInput.value = d?.device_id || '';
    if (this.$.deviceHmacInput) this.$.deviceHmacInput.value = d?.hmac_key || '';
  }

  _resetDevice() {
    if (this._resetConfirmState) {
      this.currentDevice.reset();
      localStorage.removeItem(`xiaozhi_history_${this.currentChatbotId}`);
      location.reload();
    } else {
      this._resetConfirmState = true;
      const originalText = this.$.resetBtn.textContent;
      this.$.resetBtn.textContent = 'Bấm lần nữa để XÓA';
      setTimeout(() => {
        this._resetConfirmState = false;
        this.$.resetBtn.textContent = originalText;
      }, 3000);
    }
  }

  _bindEvents() {
    // Chatbot card selection
    this.$.chatbotList.addEventListener('click', (e) => {
      const card = e.target.closest('.chatbot-card');
      if (card) {
        this._selectChatbot(card.dataset.chatbot);
      }
    });

    // Mobile menu button
    this.$.mobileMenuBtn.addEventListener('click', () => {
      this.$.chatbotSidebar.classList.toggle('show-mobile');
    });

    // Close mobile menu if clicked outside
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 900 &&
        this.$.chatbotSidebar.classList.contains('show-mobile') &&
        !this.$.chatbotSidebar.contains(e.target) &&
        !this.$.mobileMenuBtn.contains(e.target)) {
        this.$.chatbotSidebar.classList.remove('show-mobile');
      }
    });

    // Talk button — press and hold
    this.$.talkBtn.addEventListener('mousedown', () => this._startManualListening());
    this.$.talkBtn.addEventListener('mouseup', () => this._stopManualListening());
    this.$.talkBtn.addEventListener('mouseleave', () => {
      if (this.state === STATE.LISTENING && !this.keepListening) this._stopManualListening();
    });
    this.$.talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this._startManualListening(); });
    this.$.talkBtn.addEventListener('touchend', (e) => { e.preventDefault(); this._stopManualListening(); });

    this.$.stopBtn.addEventListener('click', () => this._stopConversation());

    this.$.sendBtn.addEventListener('click', () => this._sendText(this.$.textInput.value));
    this.$.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._sendText(this.$.textInput.value);
    });

    // Theme toggle
    this.$.themeBtn = document.getElementById('theme-btn');
    this.$.themeBtn.addEventListener('click', () => this._toggleTheme());

    // Settings
    this.$.settingsBtn.addEventListener('click', () => this._toggleSettings());
    this.$.closeSettingsBtn.addEventListener('click', () => this._toggleSettings());
    this.$.saveEmojiBtn.addEventListener('click', () => this._saveEmojiMapping());
    this.$.resetEmojiBtn.addEventListener('click', () => this._resetEmojiMapping());

    // Triple click to toggle hidden API configuration
    const settingsTitle = document.getElementById('settings-title');
    const apiSettingsSection = document.getElementById('api-settings-section');
    if (settingsTitle && apiSettingsSection) {
      let clickCount = 0;
      let lastClickTime = 0;
      settingsTitle.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastClickTime < 500) {
          clickCount++;
        } else {
          clickCount = 1;
        }
        lastClickTime = now;
        if (clickCount === 3) {
          apiSettingsSection.style.display = apiSettingsSection.style.display === 'none' ? 'block' : 'none';
          clickCount = 0;
        }
      });
    }

    // Connection Manager
    this.$.connectionBtn?.addEventListener('click', () => this._toggleConnection());
    this.$.closeConnectionBtn?.addEventListener('click', () => this._toggleConnection());

    // API configuration save
    this.$.saveApiSettingsBtn.addEventListener('click', () => {
      const key = this.$.groqApiKeyInput.value.trim();
      const model = this.$.groqModelInput.value.trim();
      const backendUrl = this.$.backendUrlInput ? this.$.backendUrlInput.value.trim() : '';
      localStorage.setItem('groq_api_key', key);
      localStorage.setItem('groq_model', model);
      localStorage.setItem('custom_backend_url', backendUrl);
      alert('Đã lưu cấu hình Groq API và Backend thành công!');
      this._fetchSuggestions();
    });

    // Reset button
    this.$.resetBtn?.addEventListener('click', () => this._resetDevice());

    // Save Device Settings
    this.$.saveDeviceSettingsBtn?.addEventListener('click', () => this._saveDeviceSettings());

    // Translation Box
    this.$.transBtn.addEventListener('click', () => this._translate());
    this.$.transInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._translate();
      }
    });
  }

  _saveDeviceSettings() {
    const sn = this.$.deviceSnInput.value.trim();
    const mac = this.$.deviceMacInput.value.trim();
    const hmac = this.$.deviceHmacInput.value.trim();

    if (!sn || !mac || !hmac) {
      alert('Vui lòng điền đầy đủ cả 3 thông tin SN, MAC Address và HMAC Key!');
      return;
    }

    if (this.currentDevice && this.currentDevice.data) {
      this.currentDevice.data.serial_number = sn;
      this.currentDevice.data.mac_address = mac;
      this.currentDevice.data.device_id = mac;
      this.currentDevice.data.hmac_key = hmac;
      this.currentDevice.data.activation_status = true; // Auto-activate since user manually entered pre-configured details
      this.currentDevice._save();
      
      Object.keys(CHATBOTS).forEach(key => this._updateStatusBadge(key));
      this._updateDebugInfo();
      
      alert('Đã lưu cấu hình thiết bị thành công! Giao diện sẽ tự động tải lại và kết nối.');
      
      // Reconnect with the new settings
      this.shouldReconnect = false;
      this._stopHeartbeat();
      if (this.protocol.isOpen) {
        this.protocol.close();
      }
      this._selectChatbot(this.currentChatbotId, true);
    }
  }

  _toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', this.theme);
    this._applyTheme();
  }

  _applyTheme() {
    if (this.theme === 'light') {
      document.body.classList.add('light-theme');
      const themeBtn = document.getElementById('theme-btn');
      if (themeBtn) themeBtn.textContent = '☀️';
    } else {
      document.body.classList.remove('light-theme');
      const themeBtn = document.getElementById('theme-btn');
      if (themeBtn) themeBtn.textContent = '🌙';
    }
  }

  async _translate() {
    const text = this.$.transInput.value.trim();
    if (!text) return;

    // Loading UI state
    this.$.transBtn.disabled = true;
    this.$.transBtn.textContent = 'Đang dịch...';
    this.$.transOutput.classList.remove('placeholder');
    this.$.transOutput.textContent = 'Đang dịch bằng AI...';

    const direction = this.$.transSelect.value;
    const apiKey = localStorage.getItem('groq_api_key') || '';
    const model = localStorage.getItem('groq_model') || 'openai/gpt-oss-120b';

    try {
      const response = await fetch(getApiUrl('/api/translate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          direction,
          apiKey,
          model
        })
      });

      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }

      const data = await response.json();
      if (data && data.translation) {
        this.$.transOutput.textContent = data.translation;
      } else {
        throw new Error('Dữ liệu dịch không hợp lệ');
      }
    } catch (err) {
      console.error('[Translate] Error:', err);
      this.$.transOutput.textContent = `⚠️ Lỗi: ${err.message}`;
    } finally {
      this.$.transBtn.disabled = false;
      this.$.transBtn.textContent = 'Dịch';
    }
  }

  _toggleSettings() {
    this.$.settingsView.classList.toggle('hidden');
  }

  _toggleConnection() {
    this.$.connectionView.classList.toggle('hidden');
    if (!this.$.connectionView.classList.contains('hidden')) {
      this._updateDebugInfo();
    }
  }

  showToast(message) {
    const existing = document.querySelector('.toast-notification');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
      <span class="toast-icon">✨</span>
      <span class="toast-text">${message}</span>
    `;
    document.body.appendChild(toast);

    toast.offsetHeight; // trigger reflow
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }

  fillTextInput(text) {
    if (this.$.textInput) {
      this.$.textInput.value = text;
      this.$.textInput.focus();
      this.showToast('Đã điền câu gợi ý vào ô chat! 📝');
    }
  }
}

// ─── Boot ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const app = new App();
  try {
    await app.init();
  } catch (err) {
    console.error('App init failed:', err);
    document.getElementById('status-text').textContent = `Lỗi: ${err.message}`;
  }
});
