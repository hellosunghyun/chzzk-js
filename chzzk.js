import axios from 'axios';

const BASE_OPEN_API_URL = 'https://openapi.chzzk.naver.com'; // Open API 도메인 ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/tips))
const ACCOUNT_INTERLOCK_URL = 'https://chzzk.naver.com/account-interlock'; // 인증 코드 발급용 ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization))
const CHAT_WEBSOCKET_URL = 'wss://chat.chzzk.naver.com/chat'; // 채팅 웹소켓 URL

export default class Chzzk {
  /**
   * @param {Object} options - 인증 및 설정 정보를 담은 객체
   * @param {string} options.clientId - 치지직 개발자센터에서 발급받은 Client ID
   * @param {string} options.clientSecret - 치지직 개발자센터에서 발급받은 Client Secret
   * @param {string} [options.accessToken] - 이미 발급받은 Access Token(있다면)
   * @param {string} [options.refreshToken] - 이미 발급받은 Refresh Token(있다면)
   * @param {boolean} [options.autoRefreshToken=true] - 토큰 만료 시 자동으로 갱신할지 여부
   * @param {number} [options.tokenRefreshThresholdMs=300000] - 토큰 갱신 임계값(ms) - 기본 5분
   */
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.accessToken = options.accessToken || '';
    this.refreshToken = options.refreshToken || '';
    this.autoRefreshToken = options.autoRefreshToken !== false; // 기본값 true
    this.tokenExpiry = null;
    this.tokenRefreshThresholdMs = options.tokenRefreshThresholdMs || 5 * 60 * 1000; // 기본 5분

    // 이벤트 핸들러 저장
    this.eventHandlers = {
      tokenRefresh: [],
      tokenExpired: [],
      chatMessage: [],
      chatDonation: [],
      chatSubscription: [],
      chatNotice: [],
      chatError: [],
      chatConnected: [],
      chatDisconnected: []
    };

    // 채팅 연결 관련
    this.chatSocket = null;
    this.chatChannelId = null;
    this.chatHeartbeatInterval = null;
    this.chatReconnectAttempts = 0;
    this.chatMaxReconnectAttempts = 5;

    this.httpClient = axios.create({
      baseURL: BASE_OPEN_API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 응답 인터셉터 추가 - API 응답 에러 처리 개선
    this.httpClient.interceptors.response.use(
      response => response,
      async error => {
        // 토큰 만료(401) 에러 자동 처리
        if (this.autoRefreshToken && 
            error.response && 
            error.response.status === 401 && 
            this.refreshToken) {
          try {
            // 토큰 갱신
            await this.refreshAccessToken();
            this._triggerEvent('tokenRefresh', { timestamp: Date.now() });
            
            // 원래 요청 재시도
            const originalRequest = error.config;
            if (originalRequest.headers) {
              originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
            }
            return this.httpClient(originalRequest);
          } catch (refreshError) {
            this._triggerEvent('tokenExpired', { timestamp: Date.now(), error: refreshError });
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * ----------------------------------------------------------------------------
   * 1. 인증 관련 메서드
   * ----------------------------------------------------------------------------
   */

  /**
   * 인증 코드(Authorization Code) 요청 URL 생성
   * @param {string} redirectUri - 인증 완료 후 리다이렉트될 URL
   * @param {string} state - CSRF 방지용 상태값
   * @returns {string} 인증 코드 요청하기 위해 브라우저에서 이동할 URL
   * 
   * 사용자는 이 URL로 리다이렉트되어 code/state를 받습니다.
   * ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization))
   */
  getAuthorizationCodeUrl(redirectUri, state) {
    const params = new URLSearchParams({
      clientId: this.clientId,
      redirectUri,
      state,
    });
    return `${ACCOUNT_INTERLOCK_URL}?${params.toString()}`;
  }

  /**
   * 인증 코드로 Access Token 발급 받기
   * @param {string} code - 인증 코드
   * @param {string} state - state
   * @returns {Promise<Object>} 토큰 정보 객체
   * ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization))
   */
  async issueAccessTokenByCode(code, state) {
    const body = {
      grantType: 'authorization_code',
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      code,
      state,
    };

    try {
      const res = await this.httpClient.post('/auth/v1/token', body);
      this.accessToken = res.data.accessToken;
      this.refreshToken = res.data.refreshToken;
      this._setTokenExpiry(res.data.expiresIn);
      return res.data;
    } catch (error) {
      this._handleApiError(error, '액세스 토큰 발급 실패');
    }
  }

  /**
   * Refresh Token으로 Access Token 갱신
   * @returns {Promise<Object>} 갱신된 토큰 정보 객체
   * ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization#치지직-access-token-갱신))
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('refreshToken이 설정되어 있지 않습니다.');
    }
    const body = {
      grantType: 'refresh_token',
      refreshToken: this.refreshToken,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    };
    
    try {
      const res = await this.httpClient.post('/auth/v1/token', body);
      this.accessToken = res.data.accessToken;
      this.refreshToken = res.data.refreshToken;
      this._setTokenExpiry(res.data.expiresIn);
      return res.data;
    } catch (error) {
      this._handleApiError(error, '액세스 토큰 갱신 실패');
    }
  }

  /**
   * Access Token, Refresh Token 모두 폐기
   * ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization#치지직-access-token-삭제))
   * @param {string} token - 삭제할 토큰 (accessToken이나 refreshToken)
   * @param {'access_token'|'refresh_token'} tokenTypeHint - 토큰 타입
   * @returns {Promise<Object>} 토큰 폐기 결과
   */
  async revokeToken(token, tokenTypeHint = 'access_token') {
    const body = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      token,
      tokenTypeHint,
    };
    
    try {
      const res = await this.httpClient.post('/auth/v1/token/revoke', body);
      
      // 토큰이 성공적으로 폐기되면 관련 값 초기화
      if (tokenTypeHint === 'access_token' && token === this.accessToken) {
        this.accessToken = '';
        this.tokenExpiry = null;
      } else if (tokenTypeHint === 'refresh_token' && token === this.refreshToken) {
        this.refreshToken = '';
      }
      
      return res.data;
    } catch (error) {
      this._handleApiError(error, '토큰 폐기 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 2. User (유저 정보) ([2](https://chzzk.gitbook.io/chzzk/chzzk-api/user))
   * ----------------------------------------------------------------------------
   */

  /**
   * 현재 Access Token 소유 유저의 채널 정보를 조회
   * @returns {Promise<Object>} 유저 정보 객체
   * ([2](https://chzzk.gitbook.io/chzzk/chzzk-api/user#유저-정보-조회))
   */
  async getMyUserInfo() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '유저 정보 조회 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 3. Channel (채널 정보) ([3](https://chzzk.gitbook.io/chzzk/chzzk-api/channel))
   * ----------------------------------------------------------------------------
   */

  /**
   * 여러 채널의 정보를 조회
   * @param {string[]} channelIds - 조회할 채널 ID 배열
   * @returns {Promise<Object>} 채널 정보 객체
   * ([3](https://chzzk.gitbook.io/chzzk/chzzk-api/channel))
   */
  async getChannels(channelIds = []) {
    // Client 인증 API
    // => Client-Id, Client-Secret 헤더 필요 ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/tips#client-인증-api))
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const params = new URLSearchParams();
    channelIds.forEach(id => params.append('channelIds', id));

    try {
      const res = await this.httpClient.get('/open/v1/channels', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채널 정보 조회 실패');
    }
  }

  /**
   * 단일 채널 정보 조회 (편의 메서드)
   * @param {string} channelId - 조회할 채널 ID
   * @returns {Promise<Object>} 채널 정보 객체
   */
  async getChannel(channelId) {
    const result = await this.getChannels([channelId]);
    if (result && result.code === 200 && result.content && result.content.channels && result.content.channels.length > 0) {
      return {
        ...result,
        content: result.content.channels[0]
      };
    }
    return result;
  }

  /**
   * ----------------------------------------------------------------------------
   * 4. Category (카테고리 검색) ([4](https://chzzk.gitbook.io/chzzk/chzzk-api/category))
   * ----------------------------------------------------------------------------
   */

  /**
   * 카테고리 검색
   * @param {string} query - 검색어
   * @param {number} [size=20] - 요청 사이즈
   * @returns {Promise<Object>} 카테고리 검색 결과
   */
  async searchCategory(query, size = 20) {
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const params = new URLSearchParams();
    params.append('query', query);
    params.append('size', size);

    try {
      const res = await this.httpClient.get('/open/v1/categories/search', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '카테고리 검색 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 5. Live (방송) ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live))
   * ----------------------------------------------------------------------------
   */

  /**
   * 라이브 목록 조회
   * @param {number} [size=20] - 요청 사이즈
   * @param {string} [nextCursor] - 다음 페이지 커서
   * @returns {Promise<Object>} 라이브 목록 결과
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#라이브-목록-조회))
   */
  async getLiveList(size = 20, nextCursor = '') {
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const params = new URLSearchParams();
    params.append('size', size);
    if (nextCursor) {
      params.append('next', nextCursor);
    }

    try {
      const res = await this.httpClient.get('/open/v1/lives', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '라이브 목록 조회 실패');
    }
  }

  /**
   * 방송 스트림키 조회
   * @returns {Promise<Object>} 스트림키 정보
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-스트림키-조회))
   */
  async getStreamKey() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/streams/key', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '스트림키 조회 실패');
    }
  }

  /**
   * 방송 설정 조회
   * @returns {Promise<Object>} 방송 설정 정보
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-설정-조회))
   */
  async getLiveSetting() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/lives/setting', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '방송 설정 조회 실패');
    }
  }

  /**
   * 방송 설정 변경
   * 참고: 필요한 값만 변경하면 됩니다 (PATCH)
   * @param {Object} newSetting - 변경할 설정 값
   * @returns {Promise<Object>} 변경 결과
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-설정-변경))
   * 예시 -> { defaultLiveTitle: '새 제목', categoryId: '', tags: ['ABC'] }
   */
  async updateLiveSetting(newSetting) {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.patch('/open/v1/lives/setting', newSetting, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '방송 설정 변경 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 6. Chat (채팅) ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat))
   * ----------------------------------------------------------------------------
   */

  /**
   * 채팅 메시지 전송
   * @param {string} message - 전송할 메시지 (최대 100자)
   * @returns {Promise<Object>} 전송 결과
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-메시지-전송))
   */
  async sendChatMessage(message) {
    await this._ensureValidToken();
    
    try {
      const body = { message };
      const res = await this.httpClient.post('/open/v1/chats/send', body, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 메시지 전송 실패');
    }
  }

  /**
   * 채팅 공지 등록
   * @param {Object} payload - 공지 내용
   * @param {string} [payload.message] - 새 공지 메시지
   * @param {string} [payload.messageId] - 기존 전송 메시지를 공지로 등록
   * @returns {Promise<Object>} 등록 결과
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-공지-등록))
   */
  async setChatNotice(payload) {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.post('/open/v1/chats/notice', payload, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 공지 등록 실패');
    }
  }

  /**
   * 채팅 설정 조회
   * @returns {Promise<Object>} 채팅 설정 정보
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-설정-조회))
   */
  async getChatSettings() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/chats/settings', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 설정 조회 실패');
    }
  }

  /**
   * 채팅 설정 변경
   * @param {Object} newChatSettings - 변경할 설정 값
   * @returns {Promise<Object>} 변경 결과
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-설정-변경))
   * @param {string} [newChatSettings.chatAvailableCondition] - NONE 또는 REAL_NAME
   * @param {string} [newChatSettings.chatAvailableGroup] - ALL, FOLLOWER, MANAGER, SUBSCRIBER
   * @param {number} [newChatSettings.minFollowerMinute] - 팔로우 필요 시간(분)
   * @param {boolean} [newChatSettings.allowSubscriberInFollowerMode] - 팔로워 모드에서 구독자 허용 여부
   */
  async updateChatSettings(newChatSettings) {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.put('/open/v1/chats/settings', newChatSettings, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 설정 변경 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 7. Drops (드롭스) ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops))
   * ----------------------------------------------------------------------------
   */

  /**
   * 드롭스 리워드 지급 요청 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.from] - 시작 인덱스
   * @param {number} [options.size] - 조회 개수
   * @param {string} [options.claimId] - 클레임 ID
   * @param {string} [options.channelId] - 채널 ID
   * @param {string} [options.campaignId] - 캠페인 ID
   * @param {string} [options.categoryId] - 카테고리 ID
   * @param {string} [options.fulfillmentState] - 지급 상태
   * @returns {Promise<Object>} 조회 결과
   * ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops#1.2-드롭스-리워드-지급-요청-조회-api))
   */
  async getDropsRewardClaims(options = {}) {
    // Client 인증 필요
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const params = new URLSearchParams();
    if (options.from) params.append('page.from', options.from);
    if (options.size) params.append('page.size', options.size);
    if (options.claimId) params.append('claimId', options.claimId);
    if (options.channelId) params.append('channelId', options.channelId);
    if (options.campaignId) params.append('campaignId', options.campaignId);
    if (options.categoryId) params.append('categoryId', options.categoryId);
    if (options.fulfillmentState) params.append('fulfillmentState', options.fulfillmentState);

    try {
      const res = await this.httpClient.get('/open/v1/drops/reward-claims', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '드롭스 리워드 지급 요청 조회 실패');
    }
  }

  /**
   * 드롭스 리워드 지급 상태 변경
   * @param {string[]} claimIds - 클레임 ID 배열
   * @param {'CLAIMED'|'FULFILLED'} fulfillmentState - 변경할 상태
   * @returns {Promise<Object>} 변경 결과
   * ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops#1.3-드롭스-리워드-지급-api))
   */
  async updateDropsRewardClaims(claimIds, fulfillmentState) {
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const body = {
      claimIds,
      fulfillmentState,
    };
    
    try {
      const res = await this.httpClient.put('/open/v1/drops/reward-claims', body, {
        headers,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '드롭스 리워드 지급 상태 변경 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 8. 이벤트 핸들링
   * ----------------------------------------------------------------------------
   */

  /**
   * 이벤트 리스너 등록
   * @param {string} eventName - 이벤트 이름
   * @param {Function} handler - 이벤트 발생 시 호출할 함수
   * @returns {Function} 리스너 제거를 위한 함수
   */
  on(eventName, handler) {
    if (!this.eventHandlers[eventName]) {
      throw new Error(`지원하지 않는 이벤트: ${eventName}`);
    }

    this.eventHandlers[eventName].push(handler);
    
    // 리스너 제거 함수 반환
    return () => {
      this.off(eventName, handler);
    };
  }

  /**
   * 이벤트 리스너 제거
   * @param {string} eventName - 이벤트 이름
   * @param {Function} handler - 제거할 핸들러 함수
   */
  off(eventName, handler) {
    if (!this.eventHandlers[eventName]) {
      return;
    }

    const index = this.eventHandlers[eventName].indexOf(handler);
    if (index !== -1) {
      this.eventHandlers[eventName].splice(index, 1);
    }
  }

  /**
   * 이벤트 한 번만 수신
   * @param {string} eventName - 이벤트 이름
   * @param {Function} handler - 이벤트 핸들러
   * @returns {Function} 리스너 제거를 위한 함수
   */
  once(eventName, handler) {
    const onceHandler = (data) => {
      this.off(eventName, onceHandler);
      handler(data);
    };
    
    return this.on(eventName, onceHandler);
  }

  /**
   * ----------------------------------------------------------------------------
   * 9. 실시간 채팅 (웹소켓)
   * ----------------------------------------------------------------------------
   */

  /**
   * 채팅 웹소켓 연결
   * @param {string} channelId - 연결할 채널 ID
   * @returns {Promise<void>}
   */
  async connectChat(channelId) {
    if (!channelId) {
      throw new Error('채널 ID가 필요합니다.');
    }

    if (this.chatSocket) {
      await this.disconnectChat();
    }

    this.chatChannelId = channelId;
    
    try {
      // 채팅 접속 토큰 가져오기
      const chatAccessToken = await this._getChatAccessToken(channelId);
      
      return new Promise((resolve, reject) => {
        try {
          // 웹소켓 연결
          this.chatSocket = new WebSocket(CHAT_WEBSOCKET_URL);
          
          this.chatSocket.onopen = () => {
            // 웹소켓 연결 성공 후 인증 메시지 전송
            this._sendChatAuthMessage(chatAccessToken);
            
            // 하트비트 시작
            this._startChatHeartbeat();
            
            this._triggerEvent('chatConnected', { channelId });
            resolve();
          };
          
          this.chatSocket.onclose = (event) => {
            this._cleanupChatConnection();
            this._triggerEvent('chatDisconnected', { channelId, code: event.code, reason: event.reason });
            
            // 자동 재연결 시도
            if (this.chatReconnectAttempts < this.chatMaxReconnectAttempts) {
              this.chatReconnectAttempts++;
              setTimeout(() => {
                this.connectChat(channelId).catch(() => {});
              }, 1000 * Math.pow(2, this.chatReconnectAttempts));
            }
          };
          
          this.chatSocket.onerror = (error) => {
            this._triggerEvent('chatError', { error });
            reject(error);
          };
          
          this.chatSocket.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              this._handleChatMessage(message);
            } catch (error) {
              this._triggerEvent('chatError', { error, rawMessage: event.data });
            }
          };
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      this._handleApiError(error, '채팅 연결 실패');
    }
  }

  /**
   * 채팅 연결 종료
   * @returns {Promise<void>}
   */
  async disconnectChat() {
    return new Promise((resolve) => {
      if (!this.chatSocket) {
        resolve();
        return;
      }
      
      this._cleanupChatConnection();
      
      if (this.chatSocket.readyState === WebSocket.OPEN) {
        this.chatSocket.onclose = () => {
          this.chatSocket = null;
          resolve();
        };
        this.chatSocket.close();
      } else {
        this.chatSocket = null;
        resolve();
      }
    });
  }

  /**
   * 채팅 하트비트 시작
   * @private
   */
  _startChatHeartbeat() {
    this._stopChatHeartbeat();
    
    this.chatHeartbeatInterval = setInterval(() => {
      if (this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
        this.chatSocket.send(JSON.stringify({ type: 'PING' }));
      }
    }, 30000); // 30초마다 핑
  }

  /**
   * 채팅 하트비트 중지
   * @private
   */
  _stopChatHeartbeat() {
    if (this.chatHeartbeatInterval) {
      clearInterval(this.chatHeartbeatInterval);
      this.chatHeartbeatInterval = null;
    }
  }

  /**
   * 채팅 연결 정리
   * @private
   */
  _cleanupChatConnection() {
    this._stopChatHeartbeat();
    this.chatReconnectAttempts = 0;
  }

  /**
   * 채팅 인증 메시지 전송
   * @param {string} chatAccessToken - 채팅 접속 토큰
   * @private
   */
  _sendChatAuthMessage(chatAccessToken) {
    if (!this.chatSocket || this.chatSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const authMessage = {
      type: 'AUTH',
      token: chatAccessToken,
      channelId: this.chatChannelId,
    };
    
    this.chatSocket.send(JSON.stringify(authMessage));
  }

  /**
   * 채팅 메시지 처리
   * @param {Object} message - 받은 메시지 객체
   * @private
   */
  _handleChatMessage(message) {
    switch (message.type) {
      case 'CHAT':
        this._triggerEvent('chatMessage', {
          type: 'message',
          channelId: this.chatChannelId,
          userId: message.userId,
          nickname: message.nickname,
          message: message.content,
          badges: message.badges || [],
          timestamp: message.timestamp || Date.now()
        });
        break;
        
      case 'DONATION':
        this._triggerEvent('chatDonation', {
          type: 'donation',
          channelId: this.chatChannelId,
          userId: message.userId,
          nickname: message.nickname,
          message: message.content,
          amount: message.amount,
          currency: message.currency || 'KRW',
          isAnonymous: !!message.isAnonymous,
          badges: message.badges || [],
          timestamp: message.timestamp || Date.now()
        });
        break;
        
      case 'SUBSCRIPTION':
        this._triggerEvent('chatSubscription', {
          type: 'subscription',
          channelId: this.chatChannelId,
          userId: message.userId,
          nickname: message.nickname,
          message: message.content,
          months: message.months || 1,
          tier: message.tier || 1,
          tierName: message.tierName || '기본 구독',
          badges: message.badges || [],
          timestamp: message.timestamp || Date.now()
        });
        break;
        
      case 'NOTICE':
        this._triggerEvent('chatNotice', {
          type: 'notice',
          channelId: this.chatChannelId,
          message: message.content,
          noticeType: message.noticeType || 'NORMAL',
          timestamp: message.timestamp || Date.now()
        });
        break;
        
      case 'PONG':
        // 핑에 대한 응답, 무시
        break;
        
      default:
        // 알 수 없는 메시지 타입
        break;
    }
  }

  /**
   * 채팅 접속 토큰 가져오기
   * @param {string} channelId - 채널 ID
   * @returns {Promise<string>} 채팅 접속 토큰
   * @private
   */
  async _getChatAccessToken(channelId) {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get(`/open/v1/chats/access-token?channelId=${channelId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      
      if (res.data && res.data.content && res.data.content.accessToken) {
        return res.data.content.accessToken;
      }
      
      throw new Error('채팅 접속 토큰을 찾을 수 없습니다.');
    } catch (error) {
      this._handleApiError(error, '채팅 접속 토큰 가져오기 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 내부 유틸리티 메서드
   * ----------------------------------------------------------------------------
   */

  /**
   * 토큰 만료 시간 설정
   * @param {number} expiresIn - 토큰 만료 시간(초)
   * @private
   */
  _setTokenExpiry(expiresIn) {
    if (expiresIn) {
      // 만료 시간을 설정 (약간의 버퍼 적용)
      const bufferMs = 10 * 1000; // 10초 버퍼
      this.tokenExpiry = Date.now() + (expiresIn * 1000) - bufferMs;
    }
  }

  /**
   * 유효한 토큰 확보
   * @private
   */
  async _ensureValidToken() {
    if (!this.accessToken) {
      throw new Error('Access Token이 설정되어 있지 않습니다. 먼저 발급받으세요.');
    }

    // 자동 갱신이 활성화되어 있고, 토큰 만료 시간이 설정되어 있으며, 임계값에 도달한 경우
    if (this.autoRefreshToken && 
        this.tokenExpiry && 
        this.refreshToken &&
        Date.now() + this.tokenRefreshThresholdMs > this.tokenExpiry) {
      await this.refreshAccessToken();
    }
  }

  /**
   * 이벤트 트리거
   * @param {string} eventName - 이벤트 이름
   * @param {Object} data - 이벤트 데이터
   * @private
   */
  _triggerEvent(eventName, data) {
    if (!this.eventHandlers[eventName]) {
      return;
    }

    for (const handler of this.eventHandlers[eventName]) {
      try {
        handler(data);
      } catch (error) {
        console.error(`이벤트 핸들러 에러 (${eventName}):`, error);
      }
    }
  }

  /**
   * API 에러 처리
   * @param {Error} error - 발생한 에러
   * @param {string} message - 사용자 친화적 메시지
   * @private
   */
  _handleApiError(error, message) {
    if (error.response && error.response.data) {
      // API 응답에 에러 정보가 포함된 경우
      const errorData = error.response.data;
      const errorMsg = `${message}: ${errorData.message || JSON.stringify(errorData)}`;
      throw new Error(errorMsg);
    } else if (error.request) {
      // 요청은 보냈으나 응답을 받지 못한 경우
      throw new Error(`${message}: 서버로부터 응답이 없습니다. 네트워크 연결을 확인하세요.`);
    } else {
      // 요청 설정 중 에러가 발생한 경우
      throw new Error(`${message}: ${error.message}`);
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 10. 검색 API
   * ----------------------------------------------------------------------------
   */

  /**
   * 라이브 방송 검색
   * @param {Object} options - 검색 옵션
   * @param {string} options.query - 검색어
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @param {string} [options.categoryId] - 카테고리 ID 필터링
   * @returns {Promise<Object>} 검색 결과
   */
  async searchLives(options) {
    if (!options.query) {
      throw new Error('검색어가 필요합니다.');
    }

    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    
    const params = new URLSearchParams();
    params.append('query', options.query);
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    if (options.categoryId) params.append('categoryId', options.categoryId);
    
    try {
      const res = await this.httpClient.get('/open/v1/search/lives', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '라이브 방송 검색 실패');
    }
  }

  /**
   * 채널 검색
   * @param {Object} options - 검색 옵션
   * @param {string} options.query - 검색어
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 검색 결과
   */
  async searchChannels(options) {
    if (!options.query) {
      throw new Error('검색어가 필요합니다.');
    }

    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    
    const params = new URLSearchParams();
    params.append('query', options.query);
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/search/channels', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채널 검색 실패');
    }
  }

  /**
   * 통합 검색
   * @param {Object} options - 검색 옵션
   * @param {string} options.query - 검색어
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 검색 결과 (채널, 라이브, VOD 통합)
   */
  async search(options) {
    if (!options.query) {
      throw new Error('검색어가 필요합니다.');
    }

    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    
    const params = new URLSearchParams();
    params.append('query', options.query);
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/search', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '통합 검색 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 11. VOD (비디오 온 디맨드)
   * ----------------------------------------------------------------------------
   */

  /**
   * VOD 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {string} [options.channelId] - 특정 채널의 VOD만 조회할 경우 채널 ID
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} VOD 목록
   */
  async getVods(options = {}) {
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    
    const params = new URLSearchParams();
    if (options.channelId) params.append('channelId', options.channelId);
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/vods', {
        headers,
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, 'VOD 목록 조회 실패');
    }
  }

  /**
   * VOD 상세 정보 조회
   * @param {string} vodId - VOD ID
   * @returns {Promise<Object>} VOD 상세 정보
   */
  async getVod(vodId) {
    if (!vodId) {
      throw new Error('VOD ID가 필요합니다.');
    }

    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    
    try {
      const res = await this.httpClient.get(`/open/v1/vods/${vodId}`, {
        headers,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, 'VOD 상세 정보 조회 실패');
    }
  }

  /**
   * 내 채널의 VOD 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} VOD 목록
   */
  async getMyVods(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/vods/my', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '내 VOD 목록 조회 실패');
    }
  }

  /**
   * VOD 업로드 URL 생성
   * @param {Object} metadata - VOD 메타데이터
   * @param {string} metadata.title - VOD 제목
   * @param {string} [metadata.description] - VOD 설명
   * @param {string} [metadata.categoryId] - 카테고리 ID
   * @param {string[]} [metadata.tags] - 태그 배열
   * @param {string} [metadata.visibility="PUBLIC"] - 공개 여부 (PUBLIC, PRIVATE, UNLISTED)
   * @returns {Promise<Object>} 업로드 URL 정보
   */
  async createVodUploadUrl(metadata) {
    await this._ensureValidToken();
    
    if (!metadata.title) {
      throw new Error('VOD 제목이 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.post('/open/v1/vods/upload-urls', metadata, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, 'VOD 업로드 URL 생성 실패');
    }
  }

  /**
   * VOD 메타데이터 수정
   * @param {string} vodId - VOD ID
   * @param {Object} metadata - 수정할 메타데이터
   * @param {string} [metadata.title] - VOD 제목
   * @param {string} [metadata.description] - VOD 설명
   * @param {string} [metadata.categoryId] - 카테고리 ID
   * @param {string[]} [metadata.tags] - 태그 배열
   * @param {string} [metadata.visibility] - 공개 여부 (PUBLIC, PRIVATE, UNLISTED)
   * @returns {Promise<Object>} 수정 결과
   */
  async updateVodMetadata(vodId, metadata) {
    await this._ensureValidToken();
    
    if (!vodId) {
      throw new Error('VOD ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.patch(`/open/v1/vods/${vodId}`, metadata, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, 'VOD 메타데이터 수정 실패');
    }
  }

  /**
   * VOD 삭제
   * @param {string} vodId - 삭제할 VOD ID
   * @returns {Promise<Object>} 삭제 결과
   */
  async deleteVod(vodId) {
    await this._ensureValidToken();
    
    if (!vodId) {
      throw new Error('VOD ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.delete(`/open/v1/vods/${vodId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, 'VOD 삭제 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 12. 팔로워/구독자 관리
   * ----------------------------------------------------------------------------
   */

  /**
   * 내 채널의 팔로워 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 팔로워 목록
   */
  async getMyFollowers(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me/followers', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '팔로워 목록 조회 실패');
    }
  }

  /**
   * 내가 팔로우한 채널 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 팔로우 목록
   */
  async getMyFollowings(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me/followings', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '팔로우 목록 조회 실패');
    }
  }

  /**
   * 채널 팔로우
   * @param {string} channelId - 팔로우할 채널 ID
   * @returns {Promise<Object>} 팔로우 결과
   */
  async followChannel(channelId) {
    await this._ensureValidToken();
    
    if (!channelId) {
      throw new Error('채널 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.post(`/open/v1/channels/${channelId}/follow`, null, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채널 팔로우 실패');
    }
  }

  /**
   * 채널 팔로우 취소
   * @param {string} channelId - 팔로우 취소할 채널 ID
   * @returns {Promise<Object>} 팔로우 취소 결과
   */
  async unfollowChannel(channelId) {
    await this._ensureValidToken();
    
    if (!channelId) {
      throw new Error('채널 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.delete(`/open/v1/channels/${channelId}/follow`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채널 팔로우 취소 실패');
    }
  }

  /**
   * 구독자 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 구독자 목록
   */
  async getMySubscribers(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me/subscribers', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '구독자 목록 조회 실패');
    }
  }

  /**
   * 구독자 통계 조회
   * @returns {Promise<Object>} 구독자 통계 정보
   */
  async getMySubscriberStats() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me/subscriber-stats', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '구독자 통계 조회 실패');
    }
  }

  /**
   * 내 구독 정보 조회
   * @returns {Promise<Object>} 구독 정보
   */
  async getMySubscriptions() {
    await this._ensureValidToken();
    
    try {
      const res = await this.httpClient.get('/open/v1/users/me/subscriptions', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '구독 정보 조회 실패');
    }
  }

  /**
   * ----------------------------------------------------------------------------
   * 13. 채팅 모더레이션
   * ----------------------------------------------------------------------------
   */

  /**
   * 채팅 금지 사용자 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 채팅 금지 사용자 목록
   */
  async getChatBannedUsers(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/chats/banned-users', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 금지 사용자 목록 조회 실패');
    }
  }

  /**
   * 채팅 금지 사용자 추가
   * @param {Object} banInfo - 금지 정보
   * @param {string} banInfo.userId - 금지할 사용자 ID
   * @param {number} [banInfo.durationSeconds] - 금지 기간(초), 없으면 영구 금지
   * @param {string} [banInfo.reason] - 금지 사유
   * @returns {Promise<Object>} 채팅 금지 결과
   */
  async banChatUser(banInfo) {
    await this._ensureValidToken();
    
    if (!banInfo.userId) {
      throw new Error('사용자 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.post('/open/v1/chats/banned-users', banInfo, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 금지 사용자 추가 실패');
    }
  }

  /**
   * 채팅 금지 사용자 해제
   * @param {string} userId - 금지 해제할 사용자 ID
   * @returns {Promise<Object>} 채팅 금지 해제 결과
   */
  async unbanChatUser(userId) {
    await this._ensureValidToken();
    
    if (!userId) {
      throw new Error('사용자 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.delete(`/open/v1/chats/banned-users/${userId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 금지 사용자 해제 실패');
    }
  }

  /**
   * 채팅 모더레이터 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 채팅 모더레이터 목록
   */
  async getChatModerators(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/chats/moderators', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 모더레이터 목록 조회 실패');
    }
  }

  /**
   * 채팅 모더레이터 추가
   * @param {string} userId - 모더레이터로 추가할 사용자 ID
   * @returns {Promise<Object>} 모더레이터 추가 결과
   */
  async addChatModerator(userId) {
    await this._ensureValidToken();
    
    if (!userId) {
      throw new Error('사용자 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.post('/open/v1/chats/moderators', { userId }, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 모더레이터 추가 실패');
    }
  }

  /**
   * 채팅 모더레이터 제거
   * @param {string} userId - 모더레이터에서 제거할 사용자 ID
   * @returns {Promise<Object>} 모더레이터 제거 결과
   */
  async removeChatModerator(userId) {
    await this._ensureValidToken();
    
    if (!userId) {
      throw new Error('사용자 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.delete(`/open/v1/chats/moderators/${userId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 모더레이터 제거 실패');
    }
  }

  /**
   * 채팅 필터링 단어 목록 조회
   * @param {Object} options - 조회 옵션
   * @param {number} [options.size=20] - 요청 사이즈
   * @param {string} [options.next] - 다음 페이지 커서
   * @returns {Promise<Object>} 채팅 필터링 단어 목록
   */
  async getChatFilterWords(options = {}) {
    await this._ensureValidToken();
    
    const params = new URLSearchParams();
    if (options.size) params.append('size', options.size);
    if (options.next) params.append('next', options.next);
    
    try {
      const res = await this.httpClient.get('/open/v1/chats/filter-words', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        params,
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 필터링 단어 목록 조회 실패');
    }
  }

  /**
   * 채팅 필터링 단어 추가
   * @param {string} word - 필터링할 단어
   * @returns {Promise<Object>} 필터링 단어 추가 결과
   */
  async addChatFilterWord(word) {
    await this._ensureValidToken();
    
    if (!word) {
      throw new Error('필터링할 단어가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.post('/open/v1/chats/filter-words', { word }, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 필터링 단어 추가 실패');
    }
  }

  /**
   * 채팅 필터링 단어 삭제
   * @param {string} wordId - 삭제할 필터링 단어 ID
   * @returns {Promise<Object>} 필터링 단어 삭제 결과
   */
  async removeChatFilterWord(wordId) {
    await this._ensureValidToken();
    
    if (!wordId) {
      throw new Error('필터링 단어 ID가 필요합니다.');
    }
    
    try {
      const res = await this.httpClient.delete(`/open/v1/chats/filter-words/${wordId}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return res.data;
    } catch (error) {
      this._handleApiError(error, '채팅 필터링 단어 삭제 실패');
    }
  }
} 