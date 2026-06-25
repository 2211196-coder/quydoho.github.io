/**
 * Blubla Speakup — Main Application (3-Column Layout)
 * State machine: IDLE → CONNECTING → LISTENING → SPEAKING
 */

import { DeviceManager } from './device.js';
import { OtaClient } from './ota.js';
import { XiaozhiProtocol } from './protocol.js';
import { AudioPipeline } from './audio.js';
import { ActivationManager } from './activation.js';

// ─── Configuration ───────────────────────────────
const WS_PROXY_URL = 'wss://xiaozhi-ws-proxy.kdcdigibots.workers.dev/';

// Intercept fetch to automatically fallback to Vercel production backend if the request returns non-JSON (like HTML 404) or fails.
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  let url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input && input.url));
  
  const isApiRequest = url && (url.includes('/api/') || url.startsWith('api/'));
  
  if (!isApiRequest) {
    return originalFetch.apply(this, arguments);
  }

  const isVercelBackend = url.includes('quydoho-github-io.vercel.app');

  try {
    const response = await originalFetch.apply(this, arguments);
    
    // If response is not ok, automatically fallback to Vercel production backend
    if (!response.ok && !isVercelBackend) {
      console.warn(`[API Fallback] HTTP ${response.status} from ${url}. Retrying via Vercel backend...`);
      let path = '';
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        path = urlObj.pathname + urlObj.search;
      } else {
        path = url.startsWith('/') ? url : '/' + url;
      }
      const fallbackUrl = 'https://quydoho-github-io.vercel.app' + path;
      return originalFetch(fallbackUrl, init);
    }
    
    return response;
  } catch (err) {
    // If network error and it's not already Vercel backend, retry using Vercel backend
    if (!isVercelBackend) {
      console.warn(`[API Fallback] Network error ${err.message} from ${url}. Retrying via Vercel backend...`);
      let path = '';
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        path = urlObj.pathname + urlObj.search;
      } else {
        path = url.startsWith('/') ? url : '/' + url;
      }
      const fallbackUrl = 'https://quydoho-github-io.vercel.app' + path;
      return originalFetch(fallbackUrl, init);
    }
    throw err;
  }
};

// Dynamic path resolver for static hosting deployments
const mainScript = document.querySelector('script[src*="main.js"]');
const mainScriptSrc = mainScript ? mainScript.getAttribute('src') : '';
const assetsPrefix = mainScriptSrc.includes('public/') ? 'public/' : '';

function getApiUrl(path) {
  let customBackend = localStorage.getItem('custom_backend_url');
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('192.168.');
  
  // Khi chạy cục bộ và không có custom backend → gọi trực tiếp
  if (isLocal && (!customBackend || customBackend.includes('quydoho-github-io.vercel.app'))) {
    return path;
  }

  // Khi chạy trên Vercel → gọi trực tiếp (cùng origin)
  if (hostname.includes('vercel.app')) {
    return path;
  }

  // Khi không có custom backend → mặc định dùng Vercel backend
  if (!customBackend) {
    customBackend = 'https://quydoho-github-io.vercel.app';
  }
  const base = customBackend.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return base + cleanPath;
}


/* [DISABLED] Biểu cảm / Emotion system
const DEFAULT_EMOTIONS = {
  neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'angry',
  shocked: 'shocked', surprised: 'shocked', scared: 'shocked',
};

let EMOTIONS = { ...DEFAULT_EMOTIONS };

const savedEmotions = localStorage.getItem('xiaozhi_emotions');
if (savedEmotions) {
  try {
    EMOTIONS = { ...EMOTIONS, ...JSON.parse(savedEmotions) };
  } catch (e) {
    console.warn('Failed to parse saved emotions');
  }
}
*/

const STATE = { IDLE: 'idle', CONNECTING: 'connecting', LISTENING: 'listening', SPEAKING: 'speaking' };

// ─── Chatbots & Agents Definitions ────────────────
const CHATBOTS = {
  teacher: {
    id: 'teacher',
    name: 'Anna (Teacher)',
    displayName: 'Anna',
    role: 'Teacher',
    topic: 'job_interview',
    topicEn: 'Job Interview',
    topicVi: 'Phỏng vấn',
    emoji: '👩‍🏫',
    greeting: 'Hi there! I am Anna, your interviewer today. 💼 Let\'s practice a Job Interview. To begin, tell me, why do you want this job?'
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
    greeting: 'Hello! Welcome to Blubla Airlines check-in counter. ✈️ Can I please see your passport and flight ticket?'
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

const FALLBACK_SUGGESTIONS = {
  teacher: [
    { en: "I want this job because I want to grow my career in this field.", vi: "Tôi muốn công việc này vì tôi muốn phát triển sự nghiệp trong lĩnh vực này." },
    { en: "I believe my skills and experience are a perfect fit for this position.", vi: "Tôi tin rằng kỹ năng và kinh nghiệm của mình hoàn toàn phù hợp với vị trí này." },
    { en: "Could you please tell me more about the day-to-day responsibilities?", vi: "Cô có thể cho tôi biết thêm về các trách nhiệm hàng ngày không?" }
  ],
  receptionist: [
    { en: "Yes, I have a reservation under my name.", vi: "Vâng, tôi đã đặt phòng trước dưới tên của tôi." },
    { en: "Is breakfast included in my booking?", vi: "Bữa sáng có bao gồm trong tiền phòng không?" },
    { en: "What time is check-out tomorrow?", vi: "Mấy giờ thì trả phòng vào ngày mai?" }
  ],
  airport: [
    { en: "Here is my passport and ticket.", vi: "Đây là hộ chiếu và vé máy bay của tôi." },
    { en: "Can I have a window seat, please?", vi: "Tôi có thể chọn ghế cạnh cửa sổ được không?" },
    { en: "Where is the baggage drop-off area?", vi: "Khu vực gửi hành lý ở đâu vậy?" }
  ],
  shopping: [
    { en: "I'm looking for a casual t-shirt in medium size.", vi: "Tôi đang tìm một chiếc áo thun thường ngày size M." },
    { en: "Do you have this jacket in another color?", vi: "Cửa hàng có chiếc áo khoác này màu khác không?" },
    { en: "Where are the fitting rooms?", vi: "Phòng thử đồ ở đâu vậy?" }
  ]
};

class App {
  constructor() {
    this.currentChatbotId = 'teacher';
    
    // Single DeviceManager instance for the logged-in user
    this.device = null;
    this.chatHistories = {};
    
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
      globalControlPanel: document.getElementById('global-control-panel'),
      mobileMenuBtn: document.getElementById('mobile-menu-btn'),
      mobileTransBtn: document.getElementById('mobile-trans-btn'),
      mobileRankBtn: document.getElementById('mobile-rank-btn'),
      chatbotSidebar: document.getElementById('chatbot-sidebar'),
      suggestionSidebar: document.getElementById('suggestion-sidebar'),
      closeSuggestionBtn: document.getElementById('close-suggestion-btn'),
      inlineSuggestionContainer: document.getElementById('inline-suggestion-container'),
      inlineSuggestionContent: document.getElementById('inline-suggestion-content'),
      reloadSuggestionBtn: document.getElementById('reload-suggestion-btn'),
      toggleSuggestionBtn: document.getElementById('toggle-suggestion-btn'),
      drawerTransBtn: document.getElementById('drawer-trans-btn'),
      drawerRankBtn: document.getElementById('drawer-rank-btn'),
      chatbotList: document.getElementById('chatbot-list'),
      chatbotCards: {},
      statusBadges: {},
      topicBadge: document.getElementById('topic-badge'),
      mobileMenuBtn: document.getElementById('mobile-menu-btn'),
      // [DISABLED] emotionImg: document.getElementById('emotion-img'),
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
      // [DISABLED] saveEmojiBtn: document.getElementById('save-emoji-btn'),
      // [DISABLED] resetEmojiBtn: document.getElementById('reset-emoji-btn'),
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

      /* [DISABLED] emojiSlots: {
        neutral: document.getElementById('emoji-neutral'),
        happy: document.getElementById('emoji-happy'),
        sad: document.getElementById('emoji-sad'),
        angry: document.getElementById('emoji-angry'),
        shocked: document.getElementById('emoji-shocked'),
      }, */

      // Landing Page
      landingView: document.getElementById('landing-view'),
      landingStartBtn: document.getElementById('landing-start-btn'),
      landingLeaderboardList: document.getElementById('landing-leaderboard-list'),
      closeLoginBtn: document.getElementById('close-login-btn'),

      // Auth & Login
      loginOverlay: document.getElementById('login-overlay'),
      loginUsername: document.getElementById('login-username'),
      loginPassword: document.getElementById('login-password'),
      loginSubmitBtn: document.getElementById('login-submit-btn'),
      loginError: document.getElementById('login-error'),
      logoutBtn: document.getElementById('logout-btn'),

      // Admin Dashboard
      adminDashboardBtn: document.getElementById('admin-dashboard-btn'),
      adminDashboardView: document.getElementById('admin-dashboard-view'),
      closeAdminDashboardBtn: document.getElementById('close-admin-dashboard-btn'),
      adminTabAccounts: document.getElementById('admin-tab-accounts'),
      adminTabConnections: document.getElementById('admin-tab-connections'),
      adminTabStats: document.getElementById('admin-tab-stats'),
      adminUsersList: document.getElementById('admin-users-list'),
      adminConnectionsList: document.getElementById('admin-pool-list'),
      newUserUsername: document.getElementById('new-user-username'),
      newUserPassword: document.getElementById('new-user-password'),
      createUserBtn: document.getElementById('create-user-btn'),
      createUserError: document.getElementById('create-user-error'),

      // New Admin Selectors
      bulkUserPrefix: document.getElementById('bulk-user-prefix'),
      bulkUserStart: document.getElementById('bulk-user-start'),
      bulkUserCount: document.getElementById('bulk-user-count'),
      bulkUserPassword: document.getElementById('bulk-user-password'),
      bulkCreateUserBtn: document.getElementById('bulk-create-user-btn'),
      bulkCreateUserError: document.getElementById('bulk-create-user-error'),
      adminSearchInput: document.getElementById('admin-search-input'),
      adminRefreshUsersBtn: document.getElementById('admin-refresh-users-btn'),
      adminSelectAllUsers: document.getElementById('admin-select-all-users'),
      adminBulkBar: document.getElementById('admin-bulk-bar'),
      adminSelectedCount: document.getElementById('admin-selected-count'),
      adminBulkResetBtn: document.getElementById('admin-bulk-reset-btn'),
      adminBulkDeleteBtn: document.getElementById('admin-bulk-delete-btn'),
      adminBulkCancelBtn: document.getElementById('admin-bulk-cancel-btn'),

      poolStatTotal: document.getElementById('pool-stat-total'),
      poolStatActive: document.getElementById('pool-stat-active'),
      poolStatBusy: document.getElementById('pool-stat-busy'),
      poolStatIdle: document.getElementById('pool-stat-idle'),

      rankChartContainer: document.getElementById('rank-chart-container'),
      topUsersContainer: document.getElementById('top-users-container'),

      // Stats selectors
      statTotalUsers: document.getElementById('stat-total-users'),
      statTotalMessages: document.getElementById('stat-total-messages'),
      statAvgScore: document.getElementById('stat-avg-score'),
      statTopUser: document.getElementById('stat-top-user'),

      // Profile Badge
      userProfileBadge: document.getElementById('user-profile-badge'),
      profileUsername: document.getElementById('profile-username'),
      profileRank: document.getElementById('profile-rank'),
      profileScore: document.getElementById('profile-score'),
      profileProgress: document.getElementById('profile-progress'),

      // Sidebar tabs
      sidebarTabBtns: document.querySelectorAll('.sidebar-tab'),
      panelSuggestions: document.getElementById('panel-suggestions'),
      panelTranslation: document.getElementById('panel-translation'),
      panelLeaderboard: document.getElementById('panel-leaderboard'),
      leaderboardList: document.getElementById('leaderboard-list'),

      // Achievement overlay
      achievementOverlay: document.getElementById('achievement-overlay'),
      achievementTitle: document.getElementById('achievement-title'),
      achievementDesc: document.getElementById('achievement-desc'),
      achievementPointsBonus: document.getElementById('achievement-points-bonus'),
      achievementCloseBtn: document.getElementById('achievement-close-btn')
    };

    // Dynamically bind cards and status badges
    Object.keys(CHATBOTS).forEach(key => {
      this.$.chatbotCards[key] = document.querySelector(`[data-chatbot="${key}"]`);
      this.$.statusBadges[key] = document.getElementById(`status-badge-${key}`);
    });

    this.currentActivation = null;
    this.poolActivations = {};
    this.poolActivationStates = {};
    this.loadedAdminUsers = [];
    this.selectedUsernames = [];

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

    // Device initialization is handled dynamically inside _checkLoginState()

    await this.audio.init();
    this.audio.onEncoded = (data) => this.protocol.sendAudio(data);

    this.protocol.onJson = (data) => this._onJson(data);
    this.protocol.onAudio = (data) => this.audio.decodeAudio(data);
    this.protocol.onOpened = () => this._onChannelOpened();
    this.protocol.onClosed = () => this._onChannelClosed();
    this.protocol.onError = (msg) => this._addChatUI('system', `Lỗi: ${msg}`);
    
    this._initSettings();
    this._bindEvents();
    this._bindAuthAndTabsEvents();

    // Initialize Theme (Dark/Light mode)
    this.theme = localStorage.getItem('theme') || 'dark';
    this._applyTheme();

    // Select default chatbot
    this._selectChatbot(this.currentChatbotId, true);

    // Check authentication status
    await this._checkLoginState();
  }

  get currentDevice() {
    return this.device;
  }

  _updateStatusBadge(chatbotId) {
    const badge = this.$.statusBadges[chatbotId];
    if (!badge) return;
    badge.textContent = 'SẴN SÀNG';
    badge.className = 'status-badge online';
  }

  async _selectChatbot(chatbotId, force = false) {
    if (this.currentActivation) {
      this.currentActivation.cancel();
      this.currentActivation = null;
    }

    if (!force && chatbotId === this.currentChatbotId) return;

    // Release previous device before switching
    if (this.currentUser && this.currentDevice && this.currentDevice.isActivated) {
      await this._releaseDevice(this.currentChatbotId, this.currentDevice.deviceId);
    }

    // Stop heartbeat timer
    if (this.poolHeartbeatTimer) {
      clearInterval(this.poolHeartbeatTimer);
      this.poolHeartbeatTimer = null;
    }

    // Update currentChatbotId early
    this.currentChatbotId = chatbotId;

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
    
    const chatTitle = document.getElementById('chat-header-title');
    if (chatTitle) chatTitle.textContent = `✨ ${botConfig.name}`;

    // Reload conversation history (User-scoped) with smooth transition
    this.$.chatLog.classList.add('transitioning');
    await new Promise(resolve => setTimeout(resolve, 200));

    this.$.chatLog.innerHTML = '';
    const username = this.currentUser ? this.currentUser.username.toLowerCase() : 'guest';
    const historyKey = `xiaozhi_history_${username}_${chatbotId}`;
    const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
    
    // Migration: Update old "Ms. Hoa" greetings to the new bot greeting
    if (history && history.length > 0 && history[0].role === 'ai') {
      if (history[0].text.includes('Hoa')) {
        history[0].text = botConfig.greeting;
        localStorage.setItem(historyKey, JSON.stringify(history));
      }
    }
    
    this.chatHistories[chatbotId] = history;

    if (history && history.length > 0) {
      history.forEach(msg => {
        this._addChatUI(msg.role, msg.text, true);
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

    this.$.chatLog.classList.remove('transitioning');

    // Call lease API to get a device from the pool
    if (this.currentUser) {
      this.$.activationView.classList.remove('hidden');
      this.$.mainView.classList.add('hidden');
      this.$.codeDisplay.textContent = '—';
      this.$.activationStatus.textContent = '🔌 Đang tìm kết nối rảnh trong pool...';

      try {
        const leaseRes = await fetch(getApiUrl('/api/pool/lease'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.currentUser.username,
            chatbotId: chatbotId
          })
        });

        if (!leaseRes.ok) {
          const leaseErr = await leaseRes.json();
          this.$.activationStatus.textContent = `⚠️ ${leaseErr.message || leaseErr.error || 'Lỗi thuê thiết bị.'}`;
          return;
        }

        const leaseData = await leaseRes.json();
        const d = leaseData.device || leaseData;

        // Configure device manager with pool device credentials
        this.device = new DeviceManager(`${username}_pool_${chatbotId}`);
        await this.device.init();
        this.device.data.mac_address = d.mac_address;
        this.device.data.device_id = d.mac_address;
        this.device.data.serial_number = d.serial_number;
        this.device.data.hmac_key = d.hmac_key;
        this.device.data.activation_status = true;
        this.device._save();

        this.ota = new OtaClient(this.currentDevice);
        this._updateDebugInfo();

        this.$.activationView.classList.add('hidden');
        this.$.mainView.classList.remove('hidden');

        // Start heartbeat timer (every 30 seconds)
        this.poolHeartbeatTimer = setInterval(() => {
          this._sendPoolHeartbeat(chatbotId, d.mac_address);
        }, 30000);

        // Automatically connect
        setTimeout(() => this._ensureConnected(), 300);

      } catch (err) {
        console.error('[Pool] Lease request failed:', err);
        this.$.activationStatus.textContent = `❌ Lỗi kết nối máy chủ: ${err.message}`;
      }
    } else {
      // Guest or not logged in
      this.$.activationView.classList.remove('hidden');
      this.$.mainView.classList.add('hidden');
      this.$.codeDisplay.textContent = '—';
      this.$.activationStatus.textContent = '⚠️ Vui lòng đăng nhập để sử dụng.';
    }

    // Close mobile side menu
    this.$.chatbotSidebar.classList.remove('show-mobile');
  }

  // ─── Activation ────────────────────────────────

  async _runActivation() {
    if (this.currentActivation) {
      this.currentActivation.cancel();
      this.currentActivation = null;
    }

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

    this.currentActivation = activation;
    const success = await activation.run();
    if (this.currentActivation === activation) {
      this.currentActivation = null;
    }

    if (success) {
      try { await this.ota.fetchConfig(); } catch {}
      this._updateDebugInfo();
      
      // Đẩy cấu hình kết nối đã kích hoạt thành công lên server để đồng bộ lâu dài
      if (this.currentUser && this.currentDevice && this.currentDevice.data) {
        try {
          await fetch(getApiUrl('/api/user/connection'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: this.currentUser.username,
              chatbotId: this.currentChatbotId,
              mac_address: this.currentDevice.data.mac_address,
              serial_number: this.currentDevice.data.serial_number,
              hmac_key: this.currentDevice.data.hmac_key
            })
          });
          console.log('[Activation] Saved connection config to server successfully');
        } catch (err) {
          console.warn('[Activation] Failed to save connection config to server:', err.message);
          // Fallback to local simulated storage
          let simConns = JSON.parse(localStorage.getItem('simulated_connections')) || {};
          const connKey = `${this.currentUser.username.toLowerCase()}_${this.currentChatbotId}`;
          simConns[connKey] = {
            mac_address: this.currentDevice.data.mac_address,
            serial_number: this.currentDevice.data.serial_number,
            hmac_key: this.currentDevice.data.hmac_key
          };
          localStorage.setItem('simulated_connections', JSON.stringify(simConns));
        }
      }
      
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
    /* [DISABLED] Biểu cảm - _initSettings emoji population
    for (const [key, slot] of Object.entries(this.$.emojiSlots)) {
      if (EMOTIONS[key]) {
        slot.dataset.mapped = EMOTIONS[key];
        slot.innerHTML = `<img src="${assetsPrefix}assets/emojis/${EMOTIONS[key]}.gif" alt="${EMOTIONS[key]}">`;
      }
    }
    this._bindDragEvents();
    */
  }

  /* [DISABLED] Biểu cảm - _bindDragEvents
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
      slot.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; slot.classList.add('drag-over'); });
      slot.addEventListener('dragleave', (e) => { slot.classList.remove('drag-over'); });
      slot.addEventListener('drop', (e) => {
        e.preventDefault(); slot.classList.remove('drag-over');
        const emojiName = e.dataTransfer.getData('text/plain');
        if (emojiName) { slot.dataset.mapped = emojiName; slot.innerHTML = `<img src="${assetsPrefix}assets/emojis/${emojiName}.gif" alt="${emojiName}">`; }
      });
    });
  }
  */

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

  /* [DISABLED] Biểu cảm - _resetEmojiMapping
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
  */

  /* [DISABLED] Biểu cảm - _saveEmojiMapping
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
  */

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
    this.$.stopBtn.disabled = newState === STATE.IDLE || newState === STATE.CONNECTING;
    this.$.statusText.className = `status-text status-${newState}`;
  }

  /* [DISABLED] Biểu cảm - _setEmotion
  _setEmotion(name) {
    const mapped = EMOTIONS[name] || 'neutral';
    this.$.emotionImg.src = `${assetsPrefix}assets/emojis/${mapped}.gif`;
    this.$.emotionImg.alt = mapped;
  }
  */

  // ─── Protocol Actions ──────────────────────────

  async _ensureConnected(silent = false) {
    if (this.protocol.isOpen) return true;

    this.shouldReconnect = true;
    this._setState(STATE.CONNECTING);

    if (!silent) this._addChatUI('system', 'Đang lấy cấu hình...');
    try {
      const otaData = await this.ota.fetchConfig();
      this._updateDebugInfo();

      // Check if the server requires activation (means unactivated MAC or revoked on xiaozhi.me)
      if (otaData && otaData.activation) {
        console.warn('[App] Device requires activation.');
        if (!silent) this._addChatUI('system', '⚠️ Thiết bị này chưa được kích hoạt trên xiaozhi.me! Vui lòng báo Admin kích hoạt.');
        this.currentDevice.setActivated(false);
        this._setState(STATE.IDLE);
        this.shouldReconnect = false;
        
        // Release the device from the pool so it is free for admin to activate
        await this._releaseDevice(this.currentChatbotId, this.currentDevice.deviceId);

        // Show error message on the main UI
        this.$.activationView.classList.remove('hidden');
        this.$.mainView.classList.add('hidden');
        this.$.codeDisplay.textContent = '—';
        this.$.activationStatus.textContent = '⚠️ Thiết bị pool chưa được kích hoạt. Vui lòng báo Admin kích hoạt thiết bị này trên xiaozhi.me.';
        return false;
      }
    } catch (err) {
      if (!silent) this._addChatUI('system', `Lỗi OTA: ${err.message}`);
    }

    const url = this.currentDevice.websocketUrl;
    const token = this.currentDevice.websocketToken;

    if (!url) {
      if (!silent) this._addChatUI('system', '❌ Chưa có WebSocket URL. Vui lòng thử lại.');
      this._setState(STATE.IDLE);
      return false;
    }

    let ok = false;

    if (WS_PROXY_URL) {
      if (!silent) this._addChatUI('system', 'Kết nối qua proxy...');
      ok = await this.protocol.connectViaProxy(
        WS_PROXY_URL, url, token, this.currentDevice.deviceId, this.currentDevice.clientId
      );
    } else {
      if (!silent) this._addChatUI('system', 'Kết nối trực tiếp (không có proxy)...');
      ok = await this.protocol.connectDirect(url, token, this.currentDevice.deviceId, this.currentDevice.clientId);
    }

    if (!ok) {
      if (!silent) this._addChatUI('system', '❌ Không kết nối được. Vui lòng thử lại.');
      this._setState(STATE.IDLE);
      return false;
    }

    if (!silent) this._addChatUI('system', '✅ Đã kết nối!');
    this._setState(STATE.IDLE);

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
    if (this.reconnectAttempts > 0) {
      this._addChatUI('system', '🟢 Đã kết nối lại thành công!');
    } else {
      this._addChatUI('system', '🟢 Kênh audio đã mở');
    }
    this.reconnectAttempts = 0; // Reset reconnect attempts on success
    this._startHeartbeat();
  }

  _onChannelClosed() {
    console.log('[App] Channel closed');
    this.audio.stopCapture();
    this._setState(STATE.IDLE);
    
    if (!this.shouldReconnect) {
      this._addChatUI('system', '🔴 Kết nối đã đóng');
    } else if (this.reconnectAttempts === 0) {
      this._addChatUI('system', '⚠️ Mất kết nối. Đang tự động thử kết nối lại...');
    }
    
    this._stopHeartbeat();

    if (this.shouldReconnect) {
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts === 4) {
        this._addChatUI('system', '⚠️ Đã thử kết nối lại thất bại nhiều lần. Vui lòng kiểm tra lại cấu hình thiết bị trong Cài đặt hoặc kết nối mạng. Hệ thống vẫn đang tự động thử lại ở chế độ nền...');
      }

      // Exponential backoff: 3s, 6s, 12s, then capped at 15s for subsequent attempts
      const delay = this.reconnectAttempts <= 3 
        ? 3000 * Math.pow(2, this.reconnectAttempts - 1)
        : 15000;
      
      console.log(`[App] Scheduling auto-reconnect in ${delay / 1000}s (Attempt ${this.reconnectAttempts})`);
      
      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        if (this.shouldReconnect && !this.protocol.isOpen) {
          this._ensureConnected(true);
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
    // [DISABLED] if (type === 'llm' && data.emotion) this._setEmotion(data.emotion);
  }

  // ─── Suggestion Actions ────────────────────────

  _showSuggestionPlaceholder() {
    this.$.inlineSuggestionContainer.classList.add('hidden');
    this.$.inlineSuggestionContent.innerHTML = '';
  }

  async _fetchSuggestions() {
    const history = this.chatHistories[this.currentChatbotId];
    if (!history || history.length === 0) {
      this._showSuggestionPlaceholder();
      return;
    }

    this.$.inlineSuggestionContainer.classList.remove('hidden');
    this.$.inlineSuggestionContent.innerHTML = `<span style="color: var(--text-dim);">Đang tải gợi ý...</span>`;
    this.$.inlineSuggestionContent.classList.remove('hidden');
    this.$.reloadSuggestionBtn.classList.add('hidden');
    this.$.toggleSuggestionBtn.textContent = '🔼';

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
        // Shuffle or pick random if reloading? Actually backend gives 3, let's pick a random one so reload gives different
        const randomSug = data.suggestions[Math.floor(Math.random() * data.suggestions.length)];
        
        this.$.inlineSuggestionContainer.classList.remove('hidden');
        
        const safeEn = randomSug.en.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        this.$.inlineSuggestionContent.innerHTML = `<span>${randomSug.en}</span> <br/> <span style="color: var(--text-dim); font-size: 0.9em;">- ${randomSug.vi}</span>`;
        // Restore visibility state
        const isHidden = localStorage.getItem('suggestionHidden') === 'true';
        if (isHidden) {
          this.$.inlineSuggestionContent.classList.add('hidden');
          this.$.reloadSuggestionBtn.classList.add('hidden');
          this.$.toggleSuggestionBtn.textContent = '🔽';
        } else {
          this.$.inlineSuggestionContent.classList.remove('hidden');
          this.$.reloadSuggestionBtn.classList.remove('hidden');
          this.$.toggleSuggestionBtn.textContent = '🔼';
        }
      } else {
        throw new Error("Dữ liệu gợi ý không đúng định dạng");
      }
    } catch (err) {
      console.error('[Suggest] Error fetching suggestions:', err);
      this._showLocalFallbackSuggestions(err.message);
    }
  }

  _showLocalFallbackSuggestions(errorMsg) {
    const chatbotId = this.currentChatbotId;
    const sugs = FALLBACK_SUGGESTIONS[chatbotId] || [];
    
    if (sugs.length > 0) {
      this.$.inlineSuggestionContainer.classList.remove('hidden');
      const randomSug = sugs[Math.floor(Math.random() * sugs.length)];
      const safeEn = randomSug.en.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      
      this.$.inlineSuggestionContent.innerHTML = `<span style="color: #f87171;" title="Lỗi API, dùng Offline">⚠️</span> <span>${randomSug.en}</span> <br/> <span style="color: var(--text-dim); font-size: 0.9em;">- ${randomSug.vi}</span>`;
      // Restore visibility state
      const isHidden = localStorage.getItem('suggestionHidden') === 'true';
      if (isHidden) {
        this.$.inlineSuggestionContent.classList.add('hidden');
        this.$.reloadSuggestionBtn.classList.add('hidden');
        this.$.toggleSuggestionBtn.textContent = '🔽';
      } else {
        this.$.inlineSuggestionContent.classList.remove('hidden');
        this.$.reloadSuggestionBtn.classList.remove('hidden');
        this.$.toggleSuggestionBtn.textContent = '🔼';
      }
    } else {
      this.$.inlineSuggestionContainer.classList.add('hidden');
    }
  }

  // ─── UI Helpers ────────────────────────────────

  _addChat(role, text) {
    const history = this.chatHistories[this.currentChatbotId];
    const username = this.currentUser ? this.currentUser.username.toLowerCase() : 'guest';
    const historyKey = `xiaozhi_history_${username}_${this.currentChatbotId}`;
    
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

      localStorage.setItem(historyKey, JSON.stringify(history));
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
      localStorage.setItem(historyKey, JSON.stringify(history));
      this._addChatUI(role, text);
      
      // Cập nhật điểm và số tin nhắn hội thoại
      if (role === 'user') {
        this._addScoreAndCheckMilestones();
      }
    }
  }

  _updateLastChatUI(role, text) {
    const children = this.$.chatLog.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.classList.contains(`chat-${role}`)) {
        const label = role === 'ai' ? (CHATBOTS[this.currentChatbotId]?.displayName || 'Blubla Speakup') : role === 'user' ? 'Bạn' : '⚙️';
        
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
    const userDisplayName = (this.currentUser && this.currentUser.displayName) ? this.currentUser.displayName : 'Bạn';
    const label = role === 'ai' ? (CHATBOTS[this.currentChatbotId]?.displayName || 'Blubla Speakup') : role === 'user' ? userDisplayName : '⚙️';
    
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

    // Cập nhật thông tin trên badge Header
    const headerSn = document.getElementById('header-device-sn');
    const headerMac = document.getElementById('header-device-mac');
    if (headerSn) headerSn.textContent = d?.serial_number ? `SN: ${d.serial_number}` : 'SN: —';
    if (headerMac) headerMac.textContent = d?.device_id ? `MAC: ${d.device_id}` : 'MAC: —';

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

    // Non-admin users: read-only connection view
    const isAdmin = this.currentUser && this.currentUser.role === 'admin';
    if (this.$.deviceSnInput) this.$.deviceSnInput.readOnly = !isAdmin;
    if (this.$.deviceMacInput) this.$.deviceMacInput.readOnly = !isAdmin;
    if (this.$.deviceHmacInput) this.$.deviceHmacInput.readOnly = !isAdmin;
    if (this.$.saveDeviceSettingsBtn) this.$.saveDeviceSettingsBtn.style.display = isAdmin ? '' : 'none';
    if (this.$.resetBtn) this.$.resetBtn.parentElement.style.display = isAdmin ? '' : 'none';
  }

  _resetDevice() {
    if (this._resetConfirmState) {
      this.currentDevice.reset();
      const username = this.currentUser ? this.currentUser.username.toLowerCase() : 'guest';
      localStorage.removeItem(`xiaozhi_history_${username}_${this.currentChatbotId}`);
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
    // Release leased device on page unload
    window.addEventListener('beforeunload', () => {
      if (this.currentUser && this.currentDevice && this.currentDevice.isActivated) {
        const url = getApiUrl('/api/pool/release');
        const payload = JSON.stringify({
          username: this.currentUser.username,
          chatbotId: this.currentChatbotId,
          mac_address: this.currentDevice.deviceId
        });
        navigator.sendBeacon(url, payload);
      }
    });

    // Chatbot card selection
    this.$.chatbotList.addEventListener('click', (e) => {
      const card = e.target.closest('.chatbot-card');
      if (card) {
        this._selectChatbot(card.dataset.chatbot);
      }
    });

    // Mobile menu button toggles global control panel
    this.$.mobileMenuBtn.addEventListener('click', () => {
      if (this.$.globalControlPanel) {
        this.$.globalControlPanel.classList.toggle('show-dropdown');
      }
    });

    // Drawer buttons for Translation and Rank
    this.$.drawerTransBtn?.addEventListener('click', () => {
      if (this.$.globalControlPanel) this.$.globalControlPanel.classList.remove('show-dropdown');
      this.$.suggestionSidebar.classList.add('show-mobile');
      document.querySelector('[data-sidebar-tab="translation"]')?.click();
    });

    this.$.drawerRankBtn?.addEventListener('click', () => {
      if (this.$.globalControlPanel) this.$.globalControlPanel.classList.remove('show-dropdown');
      this.$.suggestionSidebar.classList.add('show-mobile');
      document.querySelector('[data-sidebar-tab="leaderboard"]')?.click();
    });

    this.$.toggleSuggestionBtn?.addEventListener('click', () => {
      const isHidden = this.$.inlineSuggestionContent.classList.contains('hidden');
      if (isHidden) {
        this.$.inlineSuggestionContent.classList.remove('hidden');
        this.$.reloadSuggestionBtn.classList.remove('hidden');
        this.$.toggleSuggestionBtn.textContent = '🔼';
        localStorage.setItem('suggestionHidden', 'false');
      } else {
        this.$.inlineSuggestionContent.classList.add('hidden');
        this.$.reloadSuggestionBtn.classList.add('hidden');
        this.$.toggleSuggestionBtn.textContent = '🔽';
        localStorage.setItem('suggestionHidden', 'true');
      }
    });

    this.$.closeSuggestionBtn?.addEventListener('click', () => {
      this.$.suggestionSidebar.classList.remove('show-mobile');
    });

    // Close mobile dropdown if clicked outside
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 900) {
        if (this.$.globalControlPanel && 
            this.$.globalControlPanel.classList.contains('show-dropdown') &&
            !this.$.globalControlPanel.contains(e.target) &&
            !this.$.mobileMenuBtn.contains(e.target)) {
          this.$.globalControlPanel.classList.remove('show-dropdown');
        }
      }
    });

    // Talk button — toggle mode (click to start, click again to stop)
    this.$.talkBtn.addEventListener('click', () => this._toggleTalk());
    this.$.talkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); });
    this.$.talkBtn.addEventListener('touchend', (e) => { e.preventDefault(); this._toggleTalk(); });

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
    // [DISABLED] this.$.saveEmojiBtn.addEventListener('click', () => this._saveEmojiMapping());
    // [DISABLED] this.$.resetEmojiBtn.addEventListener('click', () => this._resetEmojiMapping());

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

    // Inline suggestion reload
    this.$.reloadSuggestionBtn?.addEventListener('click', () => this._fetchSuggestions());
    this.$.transInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._translate();
      }
    });
  }

  async _saveDeviceSettings() {
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
      
      // Đẩy cấu hình kết nối thủ công lên server
      if (this.currentUser) {
        try {
          await fetch(getApiUrl('/api/user/connection'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: this.currentUser.username,
              chatbotId: this.currentChatbotId,
              mac_address: mac,
              serial_number: sn,
              hmac_key: hmac
            })
          });
        } catch (err) {
          console.warn('[Settings] Failed to save connection config to server:', err.message);
          // Fallback to local simulated storage
          let simConns = JSON.parse(localStorage.getItem('simulated_connections')) || {};
          const connKey = `${this.currentUser.username.toLowerCase()}_${this.currentChatbotId}`;
          simConns[connKey] = { mac_address: mac, serial_number: sn, hmac_key: hmac };
          localStorage.setItem('simulated_connections', JSON.stringify(simConns));
        }
      }

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
    const themeIcon = document.querySelector('#theme-btn .theme-icon');
    const themeBtn = document.getElementById('theme-btn');
    if (this.theme === 'light') {
      document.body.classList.add('light-theme');
      if (themeIcon) themeIcon.textContent = '☀️';
      else if (themeBtn) themeBtn.textContent = '☀️';
    } else {
      document.body.classList.remove('light-theme');
      if (themeIcon) themeIcon.textContent = '🌙';
      else if (themeBtn) themeBtn.textContent = '🌙';
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

  copyTranslation() {
    const text = this.$.transOutput.textContent;
    if (text && !this.$.transOutput.classList.contains('placeholder') && !text.startsWith('Kết quả dịch') && !text.startsWith('⚠️ Lỗi')) {
      navigator.clipboard.writeText(text);
      this.showToast('Đã sao chép bản dịch thành công! 📋');
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

  // ─── AUTH & LOGIN SYSTEM ───

  async _checkLoginState() {
    const savedUser = localStorage.getItem('currentUser');
    const appLayout = document.querySelector('.app-layout');

    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser);
        console.log('[Auth] User logged in:', this.currentUser.username);
        
        // Hide Landing View
        if (this.$.landingView) this.$.landingView.classList.add('hidden');
        
        // Show App Layout
        if (appLayout) appLayout.classList.remove('hidden');
        
        // Hide Login overlay
        if (this.$.loginOverlay) this.$.loginOverlay.classList.add('hidden');
        
        // Show Profile badge
        if (this.$.userProfileBadge) {
          this.$.userProfileBadge.classList.remove('hidden');
          this.$.profileUsername.textContent = this.currentUser.displayName || this.currentUser.username;
          this._updateProfileBadgeUI();
        }
        
        // Show Logout button
        if (this.$.logoutBtn) this.$.logoutBtn.classList.remove('hidden');
        
        // Check role
        if (this.currentUser.role === 'admin') {
          if (this.$.adminDashboardBtn) this.$.adminDashboardBtn.classList.remove('hidden');
        } else {
          if (this.$.adminDashboardBtn) this.$.adminDashboardBtn.classList.add('hidden');
        }
        
        // Load Leaderboard by default
        this._loadLeaderboard();
        
        // Select chatbot and trigger automatic background connection (which will handle device init)
        await this._selectChatbot(this.currentChatbotId, true);
      } catch (e) {
        console.error('Lỗi checkLoginState:', e);
        this._logout();
      }
    } else {
      this.currentUser = null;
      this.device = null;
      
      // Hide App Layout and show Landing Page
      if (appLayout) appLayout.classList.add('hidden');
      if (this.$.landingView) this.$.landingView.classList.remove('hidden');
      
      // Hide Login overlay by default on Landing Page
      if (this.$.loginOverlay) this.$.loginOverlay.classList.add('hidden');
      if (this.$.userProfileBadge) this.$.userProfileBadge.classList.add('hidden');
      if (this.$.logoutBtn) this.$.logoutBtn.classList.add('hidden');
      if (this.$.adminDashboardBtn) this.$.adminDashboardBtn.classList.add('hidden');
      
      // Load Leaderboard for the Landing Page
      this._loadLeaderboard();
    }
  }

  _bindAuthAndTabsEvents() {
    // Landing Page events
    if (this.$.landingStartBtn) {
      this.$.landingStartBtn.addEventListener('click', () => {
        if (this.$.loginOverlay) this.$.loginOverlay.classList.remove('hidden');
      });
    }

    if (this.$.closeLoginBtn) {
      this.$.closeLoginBtn.addEventListener('click', () => {
        if (this.$.loginOverlay) this.$.loginOverlay.classList.add('hidden');
      });
    }

    // Submit Login form
    if (this.$.loginSubmitBtn) {
      this.$.loginSubmitBtn.addEventListener('click', () => {
        const u = this.$.loginUsername.value.trim();
        const p = this.$.loginPassword.value.trim();
        this._login(u, p);
      });

      const handleKey = (e) => {
        if (e.key === 'Enter') {
          const u = this.$.loginUsername.value.trim();
          const p = this.$.loginPassword.value.trim();
          this._login(u, p);
        }
      };
      this.$.loginUsername?.addEventListener('keydown', handleKey);
      this.$.loginPassword?.addEventListener('keydown', handleKey);
    }

    // Logout click
    if (this.$.logoutBtn) {
      this.$.logoutBtn.addEventListener('click', () => this._logout());
    }

    // Toggle Admin Dashboard
    if (this.$.adminDashboardBtn) {
      this.$.adminDashboardBtn.addEventListener('click', () => {
        this.$.adminDashboardView.classList.toggle('hidden');
        if (!this.$.adminDashboardView.classList.contains('hidden')) {
          this._loadAdminUsers();
          this._loadAdminPool();
          this._loadAdminStats();
        }
      });
      this.$.closeAdminDashboardBtn?.addEventListener('click', () => {
        this.$.adminDashboardView.classList.add('hidden');
      });
    }

    // Switch Admin tabs
    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    adminTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        adminTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetTab = btn.dataset.tab;
        this.$.adminTabAccounts.classList.add('hidden');
        this.$.adminTabConnections.classList.add('hidden');
        this.$.adminTabStats.classList.add('hidden');

        if (targetTab === 'accounts') {
          this.$.adminTabAccounts.classList.remove('hidden');
          this._loadAdminUsers();
        } else if (targetTab === 'connections') {
          this.$.adminTabConnections.classList.remove('hidden');
          this._loadAdminPool();
        } else if (targetTab === 'stats') {
          this.$.adminTabStats.classList.remove('hidden');
          this._loadAdminStats();
        }
      });
    });

    // Create User click
    if (this.$.createUserBtn) {
      this.$.createUserBtn.addEventListener('click', () => {
        const username = this.$.newUserUsername.value.trim();
        const password = this.$.newUserPassword.value.trim();
        this._adminCreateUser(username, password);
      });
    }

    // Bulk Create User click
    if (this.$.bulkCreateUserBtn) {
      this.$.bulkCreateUserBtn.addEventListener('click', () => {
        const prefix = this.$.bulkUserPrefix.value.trim();
        const startNum = parseInt(this.$.bulkUserStart.value) || 1;
        const count = parseInt(this.$.bulkUserCount.value) || 0;
        const password = this.$.bulkUserPassword.value.trim();
        this._adminBulkCreateUsers(prefix, startNum, count, password);
      });
    }

    // Refresh Users list click
    if (this.$.adminRefreshUsersBtn) {
      this.$.adminRefreshUsersBtn.addEventListener('click', () => {
        this._loadAdminUsers();
      });
    }

    // Realtime search input
    if (this.$.adminSearchInput) {
      this.$.adminSearchInput.addEventListener('input', (e) => {
        this._filterAdminUsers(e.target.value);
      });
    }

    // Select all users checkbox
    if (this.$.adminSelectAllUsers) {
      this.$.adminSelectAllUsers.addEventListener('change', (e) => {
        this._toggleSelectAllUsers(e.target.checked);
      });
    }

    // Bulk actions
    if (this.$.adminBulkResetBtn) {
      this.$.adminBulkResetBtn.addEventListener('click', () => {
        this._adminBulkResetPassword();
      });
    }

    if (this.$.adminBulkDeleteBtn) {
      this.$.adminBulkDeleteBtn.addEventListener('click', () => {
        this._adminBulkDeleteUsers();
      });
    }

    if (this.$.adminBulkCancelBtn) {
      this.$.adminBulkCancelBtn.addEventListener('click', () => {
        this._adminClearUserSelection();
      });
    }

    // (Save connection button removed - now using per-device save buttons)

    // Sidebar tabs switching
    this.$.sidebarTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.$.sidebarTabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.dataset.sidebarTab;
        this.$.panelTranslation.classList.add('hidden');
        this.$.panelLeaderboard.classList.add('hidden');

        if (target === 'translation') {
          this.$.panelTranslation.classList.remove('hidden');
        } else if (target === 'leaderboard') {
          this.$.panelLeaderboard.classList.remove('hidden');
          this._loadLeaderboard();
        }
      });
    });

    // Close achievement overlay
    this.$.achievementCloseBtn?.addEventListener('click', () => {
      this.$.achievementOverlay.classList.add('hidden');
    });
  }

  async _login(username, password) {
    if (!username || !password) {
      this._showLoginError('Vui lòng điền đầy đủ Tên đăng nhập và Mật khẩu.');
      return;
    }

    try {
      const response = await fetch(getApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Đăng nhập thất bại.');
      }

      const userData = await response.json();
      // Lưu per-user connections từ login response
      this.userConnections = userData.connections || {};
      const user = { username: userData.username, displayName: userData.displayName, role: userData.role, score: userData.score || 0, chatCount: userData.chatCount || 0 };
      localStorage.setItem('currentUser', JSON.stringify(user));
      this._showLoginError(null);
      this._checkLoginState();
      this.showToast(`Chào mừng ${user.username} đã quay trở lại! 👋`);
    } catch (err) {
      console.warn('[Auth] Login error, falling back to simulated localStorage DB:', err.message);
      
      // Fallback local simulated DB
      if (username.toLowerCase() === 'admin' && password === 'admin123') {
        const adminUser = { username: 'admin', role: 'admin', score: 0, chatCount: 0 };
        this.userConnections = {};
        localStorage.setItem('currentUser', JSON.stringify(adminUser));
        this._showLoginError(null);
        this._checkLoginState();
        this.showToast('Chào mừng Admin (Simulated)! 👋');
        return;
      }

      // Check simulated users list in localStorage
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const hasTestAccounts = users.some(u => u.username.startsWith('test'));
      if (!users || users.length === 0 || !hasTestAccounts) {
        users = [
          { username: 'test1', password: 'test123', role: 'user', score: 30, chatCount: 3 },
          { username: 'test2', password: 'test123', role: 'user', score: 0, chatCount: 0 },
          { username: 'test3', password: 'test123', role: 'user', score: 0, chatCount: 0 },
          { username: 'alex_speak', password: '123', role: 'user', score: 350, chatCount: 35 },
          { username: 'mary_english', password: '123', role: 'user', score: 520, chatCount: 52 },
          { username: 'john_talker', password: '123', role: 'user', score: 180, chatCount: 18 },
          { username: 'linda_learner', password: '123', role: 'user', score: 90, chatCount: 9 }
        ];
        localStorage.setItem('simulated_users', JSON.stringify(users));
      }

      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (user && user.password === password) {
        const loggedUser = { username: user.username, displayName: user.displayName, role: user.role || 'user', score: user.score || 0, chatCount: user.chatCount || 0 };
        this.userConnections = JSON.parse(localStorage.getItem('simulated_connections')) || {};
        localStorage.setItem('currentUser', JSON.stringify(loggedUser));
        this._showLoginError(null);
        this._checkLoginState();
        this.showToast(`Chào mừng ${loggedUser.username} (Simulated)! 👋`);
      } else {
        this._showLoginError('Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
    }
  }

  _showLoginError(msg) {
    if (msg) {
      this.$.loginError.textContent = msg;
      this.$.loginError.classList.remove('hidden');
    } else {
      this.$.loginError.textContent = '';
      this.$.loginError.classList.add('hidden');
    }
  }

  _logout() {
    if (this.currentActivation) {
      this.currentActivation.cancel();
      this.currentActivation = null;
    }

    // Release leased device on logout
    if (this.currentUser && this.currentDevice && this.currentDevice.isActivated) {
      this._releaseDevice(this.currentChatbotId, this.currentDevice.deviceId);
    }
    if (this.poolHeartbeatTimer) {
      clearInterval(this.poolHeartbeatTimer);
      this.poolHeartbeatTimer = null;
    }

    localStorage.removeItem('currentUser');
    this.currentUser = null;
    this._checkLoginState();
    
    // Close audio connection if active
    this.shouldReconnect = false;
    this.protocol.close();
    this.audio.stopCapture();
    this._setState(STATE.IDLE);
    
    // Clear login inputs
    if (this.$.loginUsername) this.$.loginUsername.value = '';
    if (this.$.loginPassword) this.$.loginPassword.value = '';
  }

  _getRank(score) {
    const RANKS = [
      { min: 0, max: 49, name: 'Newbie', icon: '🌱' },
      { min: 50, max: 149, name: 'Bronze Speaker', icon: '🥉' },
      { min: 150, max: 349, name: 'Silver Talker', icon: '🥈' },
      { min: 350, max: 699, name: 'Gold Communicator', icon: '🥇' },
      { min: 700, max: 1199, name: 'Platinum Orator', icon: '💎' },
      { min: 1200, max: 1999, name: 'Diamond Expert', icon: '💠' },
      { min: 2000, max: 3499, name: 'Master Legend', icon: '👑' },
      { min: 3500, max: Infinity, name: 'Grandmaster', icon: '🏆' }
    ];
    return RANKS.find(r => score >= r.min && score <= r.max) || RANKS[0];
  }

  _updateProfileBadgeUI() {
    if (!this.currentUser) return;
    const rank = this._getRank(this.currentUser.score);
    this.$.profileRank.textContent = `${rank.icon} ${rank.name}`;
    this.$.profileScore.textContent = `${this.currentUser.score} pts / ${this.currentUser.chatCount} chats`;
    
    let percent = 0;
    if (rank.max === Infinity) {
      percent = 100;
    } else {
      const range = rank.max - rank.min + 1;
      const progress = this.currentUser.score - rank.min;
      percent = Math.min(100, Math.max(0, (progress / range) * 100));
    }
    this.$.profileProgress.style.width = `${percent}%`;
  }

  // Toggle talk mode
  _toggleTalk() {
    if (this.state === STATE.LISTENING && !this.keepListening) {
      // Đang ghi âm → dừng và gửi
      this._stopManualListening();
      this.$.talkBtn.classList.remove('recording');
      const label = this.$.talkBtn.querySelector('.btn-label');
      if (label) label.textContent = 'Nhấn để nói';
    } else if (this.state === STATE.IDLE || this.state === STATE.SPEAKING) {
      // Chưa ghi → bắt đầu
      this._startManualListening();
      this.$.talkBtn.classList.add('recording');
      const label = this.$.talkBtn.querySelector('.btn-label');
      if (label) label.textContent = 'Nhấn để dừng';
    }
  }

  async _addScoreAndCheckMilestones(isVoice = false) {
    if (!this.currentUser) return;

    // +10 points per message, +5 bonus for voice
    let pointsEarned = 10;
    if (isVoice) pointsEarned += 5;

    // Streak bonus: nếu chat liên tục ≥5 tin không ngắt quãng >5 phút
    const now = Date.now();
    if (this._lastChatTime && (now - this._lastChatTime) < 300000) {
      this._streakCount = (this._streakCount || 0) + 1;
      if (this._streakCount >= 5 && this._streakCount % 5 === 0) {
        pointsEarned += 20;
        this.showToast(`🔥 Streak x${this._streakCount}! +20 bonus pts`);
      }
    } else {
      this._streakCount = 1;
    }
    this._lastChatTime = now;

    this.currentUser.score += pointsEarned;
    this.currentUser.chatCount += 1;

    // Milestones — 10 mốc thưởng
    const milestones = [
      { count: 5, bonus: 30, title: 'Bắt Đầu Hội Thoại', desc: 'Tuyệt vời! Bạn đã hoàn thành 5 câu thoại giao tiếp đầu tiên!' },
      { count: 10, bonus: 50, title: 'Chăm Chỉ Luyện Nói', desc: 'Thật kiên trì! 10 tin nhắn nói chuyện trôi chảy!' },
      { count: 20, bonus: 100, title: 'Giao Tiếp Tự Tin', desc: 'Đỉnh cao! 20 câu thoại — phát âm tự tin hơn từng ngày!' },
      { count: 35, bonus: 150, title: 'Tiến Bộ Vượt Bậc', desc: 'Ấn tượng! 35 tin nhắn, bạn đang tiến bộ rất nhanh!' },
      { count: 50, bonus: 250, title: 'English Explorer', desc: 'Xuất sắc! 50 tin nhắn giao tiếp với AI — bạn là nhà thám hiểm ngôn ngữ!' },
      { count: 75, bonus: 350, title: 'Communication Pro', desc: 'Chuyên nghiệp! 75 tin nhắn, kỹ năng giao tiếp đã lên tầm mới!' },
      { count: 100, bonus: 500, title: 'Kỹ Năng Hoàn Hảo', desc: 'Không thể cản phá! 100 tin nhắn, speaking level MAX!' },
      { count: 150, bonus: 750, title: 'Speaking Champion', desc: 'Nhà vô địch nói! 150 tin nhắn — bạn là tấm gương học tập!' },
      { count: 200, bonus: 1000, title: 'Huyền Thoại Giao Tiếp', desc: 'LEGENDARY! 200 tin nhắn — kỹ năng giao tiếp tiếng Anh siêu đẳng!' },
      { count: 300, bonus: 1500, title: 'Grandmaster Đàm Thoại', desc: 'GRANDMASTER! 300 tin nhắn — bạn đã đạt đỉnh cao tuyệt đối!' }
    ];

    const hit = milestones.find(m => this.currentUser.chatCount === m.count);
    if (hit) {
      this.currentUser.score += hit.bonus;
      this._triggerCelebration(hit.title, hit.desc, hit.bonus);
    }

    // Save locally immediately, debounce API call
    localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
    this._updateProfileBadgeUI();
    this._scheduleScoreSave();
  }

  _scheduleScoreSave() {
    clearTimeout(this._scoreSaveTimer);
    this._scoreSaveTimer = setTimeout(() => this._flushScoreToServer(), 10000);
  }

  async _flushScoreToServer() {
    if (!this.currentUser) return;
    try {
      await fetch(getApiUrl('/api/user/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.currentUser.username,
          score: this.currentUser.score,
          chatCount: this.currentUser.chatCount
        })
      });
    } catch (err) {
      console.warn('[Score] API save failed:', err.message);
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const userIdx = users.findIndex(u => u.username.toLowerCase() === this.currentUser.username.toLowerCase());
      if (userIdx !== -1) {
        users[userIdx].score = this.currentUser.score;
        users[userIdx].chatCount = this.currentUser.chatCount;
        localStorage.setItem('simulated_users', JSON.stringify(users));
      }
    }
  }

  _triggerCelebration(title, desc, bonus) {
    if (this.$.achievementOverlay) {
      this.$.achievementTitle.textContent = title;
      this.$.achievementDesc.textContent = desc;
      this.$.achievementPointsBonus.textContent = `+${bonus} Điểm Thưởng!`;
      this.$.achievementOverlay.classList.remove('hidden');
    }
  }

  async _loadLeaderboard() {
    let leaderboard = [];
    try {
      const res = await fetch(getApiUrl('/api/leaderboard'));
      if (!res.ok) throw new Error();
      leaderboard = await res.json();
    } catch (e) {
      // simulated fallback
      const simulatedUsers = JSON.parse(localStorage.getItem('simulated_users')) || [
        { username: 'alex_speak', score: 350, chatCount: 35 },
        { username: 'mary_english', score: 520, chatCount: 52 },
        { username: 'john_talker', score: 180, chatCount: 18 },
        { username: 'linda_learner', score: 90, chatCount: 9 }
      ];
      
      // also push current user if not present
      if (this.currentUser && this.currentUser.role !== 'admin') {
        const idx = simulatedUsers.findIndex(u => u.username.toLowerCase() === this.currentUser.username.toLowerCase());
        if (idx === -1) {
          simulatedUsers.push({
            username: this.currentUser.username,
            score: this.currentUser.score,
            chatCount: this.currentUser.chatCount
          });
        } else {
          simulatedUsers[idx].score = this.currentUser.score;
          simulatedUsers[idx].chatCount = this.currentUser.chatCount;
        }
      }

      leaderboard = simulatedUsers
        .filter(u => u.username !== 'admin')
        .sort((a, b) => b.score - a.score);
    }

    if (this.$.leaderboardList) {
      this.$.leaderboardList.innerHTML = leaderboard.map((user, idx) => {
        const rank = idx + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const myRowClass = (this.currentUser && user.username.toLowerCase() === this.currentUser.username.toLowerCase()) ? 'my-row' : '';
        return `
          <div class="leaderboard-row ${rankClass} ${myRowClass}">
            <span class="rank-cell">${rank}</span>
            <span class="name-cell" title="${user.username}">${user.username}</span>
            <span class="chat-cell">${user.chatCount}</span>
            <span class="score-cell">${user.score} pts</span>
          </div>
        `;
      }).join('');
    }

    // Render to landing page leaderboard list
    if (this.$.landingLeaderboardList) {
      if (leaderboard.length === 0) {
        this.$.landingLeaderboardList.innerHTML = `<div class="landing-leaderboard-placeholder">Chưa có dữ liệu thi đua.</div>`;
      } else {
        this.$.landingLeaderboardList.innerHTML = leaderboard.map((user, idx) => {
          const rank = idx + 1;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
          const medalHtml = medal ? `<span style="font-size:1.1rem; margin-right:4px;">${medal}</span>` : '';
          const rankNumClass = rank <= 3 ? `rank-num-${rank}` : '';
          const isMe = (this.currentUser && user.username.toLowerCase() === this.currentUser.username.toLowerCase()) ? 'my-row' : '';
          const rankBadge = this._getRank(user.score || 0);
          const userDisplayName = user.displayName || user.username;
          return `
            <div class="landing-leaderboard-row ${isMe}">
              <span class="rank-num ${rankNumClass}">${rank}</span>
              <div class="user-name-wrapper">
                ${medalHtml}
                <span class="user-name">${userDisplayName}</span>
                <span class="top-user-rank-badge rank-${rankBadge.name.toLowerCase().split(' ')[0]}" style="font-size: 0.65rem; padding: 1px 4px; border-radius:4px; margin-left: 6px;">${rankBadge.icon} ${rankBadge.name.split(' ')[0]}</span>
              </div>
              <span>${user.chatCount}</span>
              <span style="font-weight:700; color:var(--accent);">${user.score} pts</span>
            </div>
          `;
        }).join('');
      }
    }
  }

  // ─── ADMIN DASHBOARD LOGIC ───

  async _loadAdminUsers() {
    if (!this.$.adminUsersList) return;

    let usersList = [];
    try {
      // Dùng endpoint full để có cả password
      const res = await fetch(getApiUrl('/api/admin/users/full'));
      if (!res.ok) throw new Error();
      usersList = await res.json();
    } catch (e) {
      usersList = JSON.parse(localStorage.getItem('simulated_users')) || [];
    }

    this.loadedAdminUsers = usersList;
    this.selectedUsernames = [];
    if (this.$.adminSelectAllUsers) {
      this.$.adminSelectAllUsers.checked = false;
    }
    if (this.$.adminSearchInput) {
      this.$.adminSearchInput.value = '';
    }

    this._renderAdminUsersTable(usersList);
  }

  _renderAdminUsersTable(usersList) {
    if (!this.$.adminUsersList) return;

    if (usersList.length === 0) {
      this.$.adminUsersList.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; color:var(--text-dim); padding:20px;">Không tìm thấy tài khoản người dùng nào.</td>
        </tr>
      `;
      this._updateBulkBarUI();
      return;
    }

    this.$.adminUsersList.innerHTML = usersList.map(u => {
      const isAdmin = u.username.toLowerCase() === 'admin';
      const pwId = `pw-${u.username.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const passwordCell = isAdmin ? '<span style="color:var(--text-dim);">—</span>'
        : `<span id="${pwId}" style="font-family:monospace; cursor:pointer;" onclick="this.textContent = this.dataset.shown === '1' ? '••••••' : this.dataset.pw; this.dataset.shown = this.dataset.shown === '1' ? '0' : '1';" data-pw="${u.password || ''}" data-shown="0">••••••</span>`;
      
      const actions = isAdmin
        ? `<span style="font-size:0.85rem; color:var(--text-dim);">Admin</span>`
        : `<button class="btn-action-reset" onclick="window.appInstance._adminResetPassword('${u.username}')" title="Reset mật khẩu">🔑</button>
           <button class="btn-action-delete" onclick="window.appInstance._adminDeleteUser('${u.username}')" title="Xóa">🗑️</button>`;

      const rank = this._getRank(u.score || 0);
      const isChecked = this.selectedUsernames.includes(u.username);
      const checkboxCell = isAdmin 
        ? '<td></td>'
        : `<td style="text-align: center;"><input type="checkbox" class="admin-user-checkbox" data-username="${u.username}" ${isChecked ? 'checked' : ''} onclick="window.appInstance._toggleSelectUser('${u.username}', this.checked)"></td>`;

      const rankClass = `rank-${rank.name.toLowerCase().split(' ')[0]}`;
      const rankBadge = `<span class="top-user-rank-badge ${rankClass}">${rank.icon} ${rank.name.split(' ')[0]}</span>`;

      return `
        <tr class="${isChecked ? 'row-selected' : ''}">
          ${checkboxCell}
          <td style="font-weight:600;">${u.username}</td>
          <td>${u.displayName || ''} <button class="btn-icon-only" onclick="window.appInstance._adminRenameUser('${u.username}', '${(u.displayName || '').replace(/'/g, "\\'")}')" style="font-size: 0.8em;" title="Đổi tên hiển thị">✏️</button></td>
          <td>${passwordCell}</td>
          <td>${u.role}</td>
          <td>${rankBadge}</td>
          <td>${u.chatCount}</td>
          <td style="color:var(--accent); font-weight:700;">${u.score}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');

    this._updateBulkBarUI();
  }

  _toggleSelectUser(username, isChecked) {
    if (isChecked) {
      if (!this.selectedUsernames.includes(username)) {
        this.selectedUsernames.push(username);
      }
    } else {
      this.selectedUsernames = this.selectedUsernames.filter(u => u !== username);
    }

    // Toggle row selection class in UI
    const checkboxes = document.querySelectorAll('.admin-user-checkbox');
    checkboxes.forEach(cb => {
      if (cb.dataset.username === username) {
        const row = cb.closest('tr');
        if (row) {
          if (isChecked) row.classList.add('row-selected');
          else row.classList.remove('row-selected');
        }
      }
    });

    // Update select all header checkbox
    if (this.$.adminSelectAllUsers) {
      const nonAdminUsers = this.loadedAdminUsers.filter(u => u.username.toLowerCase() !== 'admin');
      const allSelected = nonAdminUsers.length > 0 && nonAdminUsers.every(u => this.selectedUsernames.includes(u.username));
      this.$.adminSelectAllUsers.checked = allSelected;
    }

    this._updateBulkBarUI();
  }

  _toggleSelectAllUsers(isChecked) {
    const query = this.$.adminSearchInput ? this.$.adminSearchInput.value.trim().toLowerCase() : '';
    const visibleUsers = this.loadedAdminUsers.filter(u => {
      const matchesSearch = u.username.toLowerCase().includes(query);
      const isNotAdmin = u.username.toLowerCase() !== 'admin';
      return matchesSearch && isNotAdmin;
    });

    if (isChecked) {
      visibleUsers.forEach(u => {
        if (!this.selectedUsernames.includes(u.username)) {
          this.selectedUsernames.push(u.username);
        }
      });
    } else {
      const visibleUsernames = visibleUsers.map(u => u.username);
      this.selectedUsernames = this.selectedUsernames.filter(username => !visibleUsernames.includes(username));
    }

    // Update checkbox elements and row styles in DOM
    const checkboxes = document.querySelectorAll('.admin-user-checkbox');
    checkboxes.forEach(cb => {
      const username = cb.dataset.username;
      const isVisible = visibleUsers.some(u => u.username === username);
      if (isVisible) {
        cb.checked = isChecked;
        const row = cb.closest('tr');
        if (row) {
          if (isChecked) row.classList.add('row-selected');
          else row.classList.remove('row-selected');
        }
      }
    });

    this._updateBulkBarUI();
  }

  _updateBulkBarUI() {
    if (!this.$.adminBulkBar || !this.$.adminSelectedCount) return;

    const count = this.selectedUsernames.length;
    this.$.adminSelectedCount.textContent = count;

    if (count > 0) {
      this.$.adminBulkBar.classList.remove('hidden');
    } else {
      this.$.adminBulkBar.classList.add('hidden');
    }
  }

  _adminClearUserSelection() {
    this.selectedUsernames = [];
    if (this.$.adminSelectAllUsers) {
      this.$.adminSelectAllUsers.checked = false;
    }
    const checkboxes = document.querySelectorAll('.admin-user-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = false;
      const row = cb.closest('tr');
      if (row) row.classList.remove('row-selected');
    });
    this._updateBulkBarUI();
  }

  _filterAdminUsers(query) {
    const q = query.trim().toLowerCase();
    const filtered = this.loadedAdminUsers.filter(u => u.username.toLowerCase().includes(q));
    
    // Clear select all checkbox header
    if (this.$.adminSelectAllUsers) {
      this.$.adminSelectAllUsers.checked = false;
    }

    this._renderAdminUsersTable(filtered);
  }

  async _adminRenameUser(username, currentDisplayName) {
    const newName = prompt(`Nhập Tên hiển thị mới cho tài khoản "${username}":`, currentDisplayName);
    if (newName === null) return; // Cancelled
    
    try {
      const res = await fetch(getApiUrl('/api/admin/users/rename'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: newName.trim() })
      });
      if (!res.ok) throw new Error('Lỗi đổi tên hiển thị.');
      this._loadAdminUsers();
    } catch (err) {
      alert(err.message);
    }
  }

  async _adminCreateUser(username, password) {
    if (!username || !password) {
      this._showCreateUserError('Tên đăng nhập và Mật khẩu không được để trống.');
      return;
    }

    try {
      const res = await fetch(getApiUrl('/api/admin/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi thêm tài khoản.');
      }

      this._showCreateUserError(null);
      this.$.newUserUsername.value = '';
      this.$.newUserPassword.value = '';
      this.showToast(`Tạo thành công tài khoản ${username}! ✨`);
      this._loadAdminUsers();
      this._loadAdminStats();
    } catch (err) {
      console.warn('[Admin] Server create failed, simulating in localStorage:', err.message);
      
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
      if (exists) {
        this._showCreateUserError('Tài khoản đã tồn tại (Simulated).');
        return;
      }

      users.push({ username, password, role: 'user', score: 0, chatCount: 0 });
      localStorage.setItem('simulated_users', JSON.stringify(users));

      this._showCreateUserError(null);
      this.$.newUserUsername.value = '';
      this.$.newUserPassword.value = '';
      this.showToast(`Tạo thành công tài khoản ${username} (Simulated)! ✨`);
      this._loadAdminUsers();
      this._loadAdminStats();
    }
  }

  async _adminDeleteUser(username) {
    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${username}" không?`)) return;

    try {
      const res = await fetch(getApiUrl('/api/admin/users/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi xóa tài khoản.');
      }

      this.showToast(`Đã xóa tài khoản "${username}" thành công!`);
      this._loadAdminUsers();
      this._loadAdminStats();
    } catch (err) {
      console.warn('[Admin] Server delete failed, simulating in localStorage:', err.message);
      
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
      localStorage.setItem('simulated_users', JSON.stringify(users));

      this.showToast(`Đã xóa tài khoản "${username}" (Simulated) thành công!`);
      this._loadAdminUsers();
      this._loadAdminStats();
    }
  }

  async _adminBulkCreateUsers(prefix, startNum, count, password) {
    this._showBulkCreateUserError(null);
    if (!prefix || !count || !password) {
      this._showBulkCreateUserError('Prefix, số lượng và mật khẩu không được để trống.');
      return;
    }

    if (count <= 0 || count > 50) {
      this._showBulkCreateUserError('Số lượng phải từ 1 đến 50.');
      return;
    }

    try {
      const res = await fetch(getApiUrl('/api/admin/users/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, startNum, count, password })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi tạo tài khoản hàng loạt.');
      }

      const result = await res.json();
      this.showToast(result.message || `Đã tạo ${result.created.length} tài khoản thành công!`);
      
      // Clear inputs
      if (this.$.bulkUserPrefix) this.$.bulkUserPrefix.value = '';
      if (this.$.bulkUserStart) this.$.bulkUserStart.value = '1';
      if (this.$.bulkUserCount) this.$.bulkUserCount.value = '';
      if (this.$.bulkUserPassword) this.$.bulkUserPassword.value = '';

      this._loadAdminUsers();
      this._loadAdminStats();
    } catch (err) {
      console.warn('[Admin] Server bulk create failed, simulating locally:', err.message);
      
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const created = [];
      const skipped = [];
      
      for (let i = 0; i < count; i++) {
        const num = (startNum + i).toString().padStart(2, '0');
        const username = `${prefix}${num}`;
        const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
        if (exists) {
          skipped.push(username);
          continue;
        }
        users.push({ username, password, role: 'user', score: 0, chatCount: 0 });
        created.push(username);
      }

      if (created.length > 0) {
        localStorage.setItem('simulated_users', JSON.stringify(users));
      }

      this.showToast(`Đã tạo ${created.length} tài khoản (Simulated)${skipped.length > 0 ? `, bỏ qua ${skipped.length} trùng lặp` : ''}.`);
      
      // Clear inputs
      if (this.$.bulkUserPrefix) this.$.bulkUserPrefix.value = '';
      if (this.$.bulkUserStart) this.$.bulkUserStart.value = '1';
      if (this.$.bulkUserCount) this.$.bulkUserCount.value = '';
      if (this.$.bulkUserPassword) this.$.bulkUserPassword.value = '';

      this._loadAdminUsers();
      this._loadAdminStats();
    }
  }

  _showBulkCreateUserError(msg) {
    if (!this.$.bulkCreateUserError) return;
    if (msg) {
      this.$.bulkCreateUserError.textContent = msg;
      this.$.bulkCreateUserError.classList.remove('hidden');
    } else {
      this.$.bulkCreateUserError.textContent = '';
      this.$.bulkCreateUserError.classList.add('hidden');
    }
  }

  async _adminBulkResetPassword() {
    const count = this.selectedUsernames.length;
    if (count === 0) return;

    const newPw = prompt(`Nhập mật khẩu mới cho ${count} tài khoản đang chọn:`);
    if (!newPw) return;

    try {
      const res = await fetch(getApiUrl('/api/admin/users/bulk-reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: this.selectedUsernames, newPassword: newPw })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi reset mật khẩu hàng loạt.');
      }

      const result = await res.json();
      this.showToast(result.message || `Đã reset mật khẩu cho ${result.resetCount} tài khoản!`);
      this._adminClearUserSelection();
      this._loadAdminUsers();
    } catch (err) {
      console.warn('[Admin] Server bulk reset failed, simulating locally:', err.message);

      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      let resetCount = 0;
      
      this.selectedUsernames.forEach(uname => {
        if (uname.toLowerCase() === 'admin') return;
        const u = users.find(u => u.username.toLowerCase() === uname.toLowerCase());
        if (u) {
          u.password = newPw;
          resetCount++;
        }
      });

      if (resetCount > 0) {
        localStorage.setItem('simulated_users', JSON.stringify(users));
      }

      this.showToast(`Đã reset mật khẩu cho ${resetCount} tài khoản (Simulated)!`);
      this._adminClearUserSelection();
      this._loadAdminUsers();
    }
  }

  async _adminBulkDeleteUsers() {
    const count = this.selectedUsernames.length;
    if (count === 0) return;

    if (!confirm(`Bạn có chắc chắn muốn xóa ${count} tài khoản đang chọn không? Thao tác này không thể hoàn tác.`)) {
      return;
    }

    try {
      const res = await fetch(getApiUrl('/api/admin/users/bulk-delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: this.selectedUsernames })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Lỗi xóa hàng loạt.');
      }

      const result = await res.json();
      this.showToast(result.message || `Đã xóa ${result.deletedCount} tài khoản!`);
      this._adminClearUserSelection();
      this._loadAdminUsers();
      this._loadAdminStats();
    } catch (err) {
      console.warn('[Admin] Server bulk delete failed, simulating locally:', err.message);

      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const toDelete = this.selectedUsernames.filter(u => u.toLowerCase() !== 'admin').map(u => u.toLowerCase());
      const initialLen = users.length;
      users = users.filter(u => !toDelete.includes(u.username.toLowerCase()));
      const deletedCount = initialLen - users.length;

      if (deletedCount > 0) {
        localStorage.setItem('simulated_users', JSON.stringify(users));
      }

      this.showToast(`Đã xóa ${deletedCount} tài khoản (Simulated)!`);
      this._adminClearUserSelection();
      this._loadAdminUsers();
      this._loadAdminStats();
    }
  }

  _showCreateUserError(msg) {
    if (msg) {
      this.$.createUserError.textContent = msg;
      this.$.createUserError.classList.remove('hidden');
    } else {
      this.$.createUserError.textContent = '';
      this.$.createUserError.classList.add('hidden');
    }
  }

  async _loadAdminConnections() {
    this._loadAdminPool();
  }

  async _loadAdminPool() {
    if (!this.$.adminConnectionsList) return;

    try {
      const res = await fetch(getApiUrl('/api/admin/pool/list'));
      if (!res.ok) throw new Error('Failed to fetch pool');
      const pools = await res.json();
      this._renderAdminPool(pools);
    } catch (err) {
      console.error('[Admin] Error loading pool:', err);
      this.$.adminConnectionsList.innerHTML = `<p style="color:var(--danger); text-align:center; padding:20px;">Lỗi tải bể thiết bị: ${err.message}</p>`;
    }
  }

  _renderAdminPool(pools) {
    if (!this.$.adminConnectionsList) return;

    this._renderAdminPoolSummary(pools);

    const botKeys = Object.keys(CHATBOTS);
    this.$.adminConnectionsList.innerHTML = botKeys.map(botId => {
      const bot = CHATBOTS[botId];
      const botDevices = pools.filter(p => p.chatbot_id === botId);

      const totalCount = botDevices.length;
      const activeCount = botDevices.filter(d => d.activated).length;
      const busyCount = botDevices.filter(d => {
        const LEASE_EXPIRY_MS = 300000;
        return d.activated && d.leased_to && (Date.now() - (d.leased_at || 0) < LEASE_EXPIRY_MS);
      }).length;
      const idleCount = activeCount - busyCount;
      const fillPercentage = activeCount > 0 ? (idleCount / activeCount) * 100 : 0;

      let devicesHtml = '';
      if (botDevices.length === 0) {
        devicesHtml = `<p style="color:var(--text-dim); font-size:0.8rem; margin:10px 0; text-align:center;">Chưa có thiết bị nào trong pool.</p>`;
      } else {
        devicesHtml = botDevices.map(d => {
          const isActivated = d.activated;
          const now = Date.now();
          const LEASE_EXPIRY_MS = 300000;
          const isBusy = d.leased_to && (now - (d.leased_at || 0) < LEASE_EXPIRY_MS);
          
          let statusText = '🔴 Chưa kích hoạt';
          let statusClass = 'offline';
          if (isActivated) {
            if (isBusy) {
              statusText = `🟡 Bận (${d.leased_to})`;
              statusClass = 'connecting';
            } else {
              statusText = '🟢 Rảnh';
              statusClass = 'online';
            }
          }

          let credsHtml = `
            <div style="font-size:0.75rem; color:var(--text-dim); margin-top:6px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>MAC: <code style="font-size:0.7rem; color:var(--text-main); font-family:monospace;">${d.mac_address}</code></span>
                <button class="btn-copy-sug" style="padding:1px 4px; font-size:0.65rem;" onclick="event.stopPropagation(); navigator.clipboard.writeText('${d.mac_address}'); window.appInstance.showToast('Đã sao chép MAC! 📋');" title="Sao chép MAC">📋</button>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>SN: <code style="font-size:0.7rem; color:var(--text-main); font-family:monospace;">${d.serial_number}</code></span>
                <button class="btn-copy-sug" style="padding:1px 4px; font-size:0.65rem;" onclick="event.stopPropagation(); navigator.clipboard.writeText('${d.serial_number}'); window.appInstance.showToast('Đã sao chép SN! 📋');" title="Sao chép SN">📋</button>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85%;">Key: <code style="font-size:0.65rem; color:var(--text-main); font-family:monospace;">${d.hmac_key}</code></span>
                <button class="btn-copy-sug" style="padding:1px 4px; font-size:0.65rem;" onclick="event.stopPropagation(); navigator.clipboard.writeText('${d.hmac_key}'); window.appInstance.showToast('Đã sao chép HMAC Key! 📋');" title="Sao chép HMAC Key">📋</button>
              </div>
            </div>
          `;

          let actionBtn = `
            <button class="btn-secondary" style="font-size:0.75rem; padding:4px 8px; ${isActivated ? 'opacity:0.6;' : ''}" onclick="window.appInstance._adminActivatePoolDevice('${d.chatbot_id}', '${d.device_key}')">
              🔑 ${isActivated ? 'Kích hoạt lại' : 'Kích hoạt'}
            </button>
            <button class="btn-secondary btn-danger-outline" style="font-size:0.75rem; padding:4px 8px; margin-left:4px;" onclick="window.appInstance._adminDeletePoolDevice('${d.device_key}')">
              🗑️ Xóa
            </button>
          `;

          return `
            <div id="pool-device-card-${d.device_key}" style="background:rgba(255,255,255,0.01); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:8px; margin-top:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.8rem; font-family:monospace; color:var(--text-dim); font-weight:600;">${d.device_key.slice(-8)}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="status-badge ${statusClass}" style="font-size:0.65rem; padding:2px 6px;">${statusText}</span>
                  ${actionBtn}
                </div>
              </div>
              ${credsHtml}
              <div class="activation-info" style="margin-top:8px; display:none;"></div>
            </div>
          `;
        }).join('');
      }

      return `
        <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:10px; padding:15px; margin-bottom:15px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <div style="font-weight:600; font-size:0.95rem; display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.2rem;">${bot.emoji}</span>
              <span>${bot.name}</span>
              <span style="font-size:0.75rem; font-weight:normal; color:var(--text-dim);">(${idleCount}/${totalCount} rảnh)</span>
            </div>
            <button onclick="window.appInstance._adminAddPoolDevice('${botId}')" class="btn-secondary" style="font-size:0.8rem; padding:5px 10px;">
              ➕ Thêm vào Pool
            </button>
          </div>
          <div class="pool-progress-bar" title="${idleCount} rảnh / ${activeCount} đã kích hoạt">
            <div class="pool-progress-fill" style="width: ${fillPercentage}%;"></div>
          </div>
          <div class="pool-devices-container">
            ${devicesHtml}
          </div>
        </div>
      `;
    }).join('');

    pools.forEach(d => {
      if (this.poolActivationStates[d.device_key]) {
        this._updatePoolDeviceCardUI(d.device_key);
      }
    });
  }

  _renderAdminPoolSummary(pools) {
    if (!this.$.poolStatTotal || !this.$.poolStatActive || !this.$.poolStatBusy || !this.$.poolStatIdle) return;

    const total = pools.length;
    const active = pools.filter(p => p.activated).length;
    
    const now = Date.now();
    const LEASE_EXPIRY_MS = 300000;
    const busy = pools.filter(p => p.activated && p.leased_to && (now - (p.leased_at || 0) < LEASE_EXPIRY_MS)).length;
    const idle = active - busy;

    this.$.poolStatTotal.textContent = total;
    this.$.poolStatActive.textContent = active;
    this.$.poolStatBusy.textContent = busy;
    this.$.poolStatIdle.textContent = idle;
  }

  async _adminDeletePoolDevice(deviceKey) {
    if (!confirm('Bạn có chắc chắn muốn xóa thiết bị này khỏi pool không?')) return;
    try {
      const res = await fetch(getApiUrl('/api/admin/pool/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_key: deviceKey })
      });
      if (!res.ok) throw new Error('Xóa thiết bị thất bại.');
      this.showToast('Đã xóa thiết bị khỏi pool! 🗑️');
      this._loadAdminPool();
    } catch (err) {
      this.showToast(`❌ Lỗi: ${err.message}`);
    }
  }

  async _adminAddPoolDevice(chatbotId) {
    this.showToast(`Đang tạo thiết bị ảo mới cho ${CHATBOTS[chatbotId]?.name}...`);
    try {
      const res = await fetch(getApiUrl('/api/admin/pool/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatbotId })
      });
      if (!res.ok) throw new Error('Create failed');
      this.showToast('Đã thêm thiết bị vào pool. Tiến hành kích hoạt!');
      this._loadAdminPool();
    } catch (err) {
      this.showToast(`❌ Lỗi tạo thiết bị: ${err.message}`);
    }
  }

  _updatePoolDeviceCardUI(deviceKey) {
    const cardEl = document.getElementById(`pool-device-card-${deviceKey}`);
    const infoEl = cardEl ? cardEl.querySelector('.activation-info') : null;
    if (!infoEl) return;

    const state = this.poolActivationStates[deviceKey];
    if (!state) {
      infoEl.style.display = 'none';
      infoEl.innerHTML = '';
      return;
    }

    infoEl.style.display = 'block';
    if (state.error) {
      infoEl.innerHTML = `
        <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:6px; padding:6px; font-size:0.75rem; color:#ef4444; text-align:center;">
          ❌ ${state.error}
          <button class="btn-secondary" style="font-size:0.7rem; padding:2px 6px; margin-top:5px; display:block; width:100%;" onclick="window.appInstance._adminCancelPoolActivation('${deviceKey}')">Đóng</button>
        </div>
      `;
    } else if (state.code) {
      infoEl.innerHTML = `
        <div style="background:rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 2px;">Mã kích hoạt thiết bị pool:</div>
          <div style="font-size: 1.5rem; font-weight: 700; color: #3b82f6; letter-spacing: 3px; margin: 4px 0; font-family: monospace;">${state.code}</div>
          <div style="font-size: 0.7rem; color: var(--text-dim); line-height: 1.2;">Nhập mã trên <a href="https://xiaozhi.me" target="_blank" style="color: #3b82f6; text-decoration: underline; font-weight: 600;">xiaozhi.me</a>.</div>
          <div class="activation-status-text" style="font-size: 0.75rem; color: #ffc107; margin-top: 8px;">⏳ ${state.status}</div>
          <button class="btn-secondary btn-danger-outline" style="font-size:0.7rem; padding:2px 6px; margin-top:8px; width:100%;" onclick="window.appInstance._adminCancelPoolActivation('${deviceKey}')">Hủy kích hoạt</button>
        </div>
      `;
    } else {
      infoEl.innerHTML = `
        <div style="background:rgba(255, 193, 7, 0.1); border:1px solid rgba(255, 193, 7, 0.3); border-radius:6px; padding:6px; font-size:0.75rem; color:#ffc107; text-align:center;">
          ⏳ ${state.status}
          <button class="btn-secondary btn-danger-outline" style="font-size:0.7rem; padding:2px 6px; margin-top:5px; display:block; width:100%;" onclick="window.appInstance._adminCancelPoolActivation('${deviceKey}')">Hủy</button>
        </div>
      `;
    }
  }

  _adminCancelPoolActivation(deviceKey) {
    if (this.poolActivations[deviceKey]) {
      this.poolActivations[deviceKey].cancel();
      delete this.poolActivations[deviceKey];
    }
    delete this.poolActivationStates[deviceKey];
    this._loadAdminPool();
  }

  async _adminActivatePoolDevice(chatbotId, deviceKey) {
    let pools = [];
    try {
      const res = await fetch(getApiUrl('/api/admin/pool/list'));
      if (res.ok) pools = await res.json();
    } catch (e) {}

    const deviceData = pools.find(p => p.device_key === deviceKey);
    if (!deviceData) {
      this.showToast('❌ Không tìm thấy thiết bị tương ứng trong pool.');
      return;
    }

    const tempDevice = new DeviceManager(deviceKey);
    await tempDevice.init();
    tempDevice.data.mac_address = deviceData.mac_address;
    tempDevice.data.device_id = deviceData.mac_address;
    tempDevice.data.serial_number = deviceData.serial_number;
    tempDevice.data.hmac_key = deviceData.hmac_key;
    tempDevice._save();

    const ota = new OtaClient(tempDevice);
    const cardEl = document.getElementById(`pool-device-card-${deviceKey}`);
    const infoEl = cardEl ? cardEl.querySelector('.activation-info') : null;

    // Cancel previous active activation for this device if any
    if (this.poolActivations[deviceKey]) {
      this.poolActivations[deviceKey].cancel();
      delete this.poolActivations[deviceKey];
    }

    // Initialize state
    this.poolActivationStates[deviceKey] = {
      status: 'Đang kết nối server...',
      code: null,
      error: null
    };
    this._updatePoolDeviceCardUI(deviceKey);

    this.showToast(`Đang chạy kích hoạt thiết bị ${deviceKey.slice(-8)}...`);
    const activation = new ActivationManager(tempDevice, ota, {
      onStatus: (msg) => {
        if (this.poolActivationStates[deviceKey]) {
          this.poolActivationStates[deviceKey].status = msg;
          this._updatePoolDeviceCardUI(deviceKey);
        }
      },
      onCode: (code, msg) => {
        if (this.poolActivationStates[deviceKey]) {
          this.poolActivationStates[deviceKey].code = code;
          this.poolActivationStates[deviceKey].status = msg || 'Vui lòng nhập mã kích hoạt trên xiaozhi.me';
          this._updatePoolDeviceCardUI(deviceKey);
        }
        this.showToast(`Mã kích hoạt: ${code}`);
      },
      onError: (msg) => {
        this.showToast(`❌ ${msg}`);
        if (this.poolActivationStates[deviceKey]) {
          this.poolActivationStates[deviceKey].error = msg;
          this.poolActivationStates[deviceKey].code = null;
          this._updatePoolDeviceCardUI(deviceKey);
        }
      },
    });

    this.poolActivations[deviceKey] = activation;

    const success = await activation.run();

    // Clean up activation reference
    if (this.poolActivations[deviceKey] === activation) {
      delete this.poolActivations[deviceKey];
    }

    if (success) {
      // Clean up activation state on success
      delete this.poolActivationStates[deviceKey];

      const d = tempDevice.data;
      try {
        const saveRes = await fetch(getApiUrl('/api/admin/pool/activate-success'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_key: deviceKey,
            mac_address: d.mac_address || d.device_id,
            serial_number: d.serial_number,
            hmac_key: d.hmac_key
          })
        });
        if (!saveRes.ok) throw new Error('Save failed');
        this.showToast('✅ Kích hoạt thành công và lưu vào pool!');
      } catch (err) {
        this.showToast(`⚠️ Kích hoạt thành công nhưng lỗi đồng bộ: ${err.message}`);
      }
      this._loadAdminPool();
    }
  }

  async _releaseDevice(chatbotId, macAddress) {
    if (!this.currentUser || !macAddress) return;
    try {
      await fetch(getApiUrl('/api/pool/release'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.currentUser.username,
          chatbotId: chatbotId,
          mac_address: macAddress
        })
      });
      console.log(`[Pool] Released device: ${macAddress}`);
    } catch (err) {
      console.warn('[Pool] Failed to release device:', err.message);
    }
  }

  async _sendPoolHeartbeat(chatbotId, macAddress) {
    if (!this.currentUser || !macAddress) return;
    try {
      await fetch(getApiUrl('/api/pool/heartbeat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.currentUser.username,
          chatbotId: chatbotId,
          mac_address: macAddress
        })
      });
      console.log(`[Pool] Sent heartbeat for device: ${macAddress}`);
    } catch (err) {
      console.warn('[Pool] Heartbeat failed:', err.message);
    }
  }

  async _loadAdminStats() {
    let usersList = [];
    try {
      const res = await fetch(getApiUrl('/api/admin/users'));
      if (!res.ok) throw new Error();
      usersList = await res.json();
    } catch (e) {
      usersList = JSON.parse(localStorage.getItem('simulated_users')) || [];
    }

    const regularUsers = usersList.filter(u => u.role !== 'admin');
    const totalUsers = regularUsers.length;
    
    let totalMessages = 0;
    let totalScore = 0;
    let topUser = '—';
    let topScore = -1;

    const rankCounts = {
      'Newbie': 0,
      'Bronze': 0,
      'Silver': 0,
      'Gold': 0,
      'Platinum': 0,
      'Diamond': 0,
      'Master': 0,
      'Grandmaster': 0
    };

    regularUsers.forEach(u => {
      totalMessages += (u.chatCount || 0);
      totalScore += (u.score || 0);
      if ((u.score || 0) > topScore) {
        topScore = u.score;
        topUser = u.username;
      }

      const rank = this._getRank(u.score || 0);
      const name = rank.name.split(' ')[0]; // 'Newbie', 'Bronze', 'Silver', etc.
      if (rankCounts[name] !== undefined) {
        rankCounts[name]++;
      }
    });

    const avgScore = totalUsers > 0 ? Math.round(totalScore / totalUsers) : 0;

    if (this.$.statTotalUsers) this.$.statTotalUsers.textContent = totalUsers;
    if (this.$.statTotalMessages) this.$.statTotalMessages.textContent = totalMessages;
    if (this.$.statAvgScore) this.$.statAvgScore.textContent = avgScore;
    if (this.$.statTopUser) this.$.statTopUser.textContent = topUser + (topScore > -1 ? ` (${topScore} pts)` : '');

    // Render rank chart
    if (this.$.rankChartContainer) {
      const maxCount = Math.max(...Object.values(rankCounts), 1);
      this.$.rankChartContainer.innerHTML = Object.entries(rankCounts).map(([name, count]) => {
        const percent = (count / maxCount) * 100;
        const colorClass = `rank-${name.toLowerCase()}`;
        return `
          <div class="rank-row">
            <span class="rank-name">${name}</span>
            <div class="rank-bar-wrapper">
              <div class="rank-bar ${colorClass}" style="width: ${percent}%;"></div>
            </div>
            <span class="rank-count">${count}</span>
          </div>
        `;
      }).join('');
    }

    // Render top 5 users
    if (this.$.topUsersContainer) {
      const topUsers = [...regularUsers]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

      if (topUsers.length === 0) {
        this.$.topUsersContainer.innerHTML = `<p style="color:var(--text-dim); text-align:center; padding:15px; font-size:0.85rem;">Chưa có dữ liệu học viên.</p>`;
      } else {
        this.$.topUsersContainer.innerHTML = topUsers.map((u, index) => {
          const rank = this._getRank(u.score || 0);
          const rankClass = `rank-${rank.name.toLowerCase().split(' ')[0]}`;
          const rankBadge = `<span class="top-user-rank-badge ${rankClass}" style="font-size: 0.65rem; padding: 1px 4px;">${rank.icon} ${rank.name.split(' ')[0]}</span>`;
          return `
            <div class="top-user-item">
              <div class="top-user-info">
                <span style="font-weight:700; color:var(--accent); font-size:0.9rem;">#${index + 1}</span>
                <span class="top-user-name">${u.username}</span>
                ${rankBadge}
              </div>
              <span class="top-user-stats"><strong>${u.score} pts</strong> / ${u.chatCount} chats</span>
            </div>
          `;
        }).join('');
      }
    }
  }

  async _syncConnections() {
    // Deprecated in favor of device pool leasing
  }

  async _adminResetPassword(username) {
    const newPw = prompt(`Nhập mật khẩu mới cho "${username}":`);
    if (!newPw) return;

    try {
      const res = await fetch(getApiUrl('/api/admin/users/reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, newPassword: newPw })
      });
      if (!res.ok) throw new Error();
      this.showToast(`Đã reset mật khẩu cho "${username}"! 🔑`);
      this._loadAdminUsers();
    } catch (err) {
      // Fallback simulated
      let users = JSON.parse(localStorage.getItem('simulated_users')) || [];
      const u = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (u) { u.password = newPw; localStorage.setItem('simulated_users', JSON.stringify(users)); }
      this.showToast(`Đã reset mật khẩu cho "${username}" (Simulated)! 🔑`);
      this._loadAdminUsers();
    }
  }

  _adminExportCSV() {
    // Tải CSV trực tiếp từ API
    const url = getApiUrl('/api/admin/users/export');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nova_users.csv';
    a.click();
    this.showToast('Đang tải xuống danh sách tài khoản CSV... 📥');
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
