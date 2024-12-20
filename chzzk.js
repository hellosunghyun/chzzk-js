import axios from 'axios';

const BASE_OPEN_API_URL = 'https://openapi.chzzk.naver.com'; // Open API 도메인 ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/tips))
const ACCOUNT_INTERLOCK_URL = 'https://chzzk.naver.com/account-interlock'; // 인증 코드 발급용 ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization))

export default class Chzzk {
  /**
   * @param {Object} options - 인증 및 설정 정보를 담은 객체
   * @param {string} options.clientId - 치지직 개발자센터에서 발급받은 Client ID
   * @param {string} options.clientSecret - 치지직 개발자센터에서 발급받은 Client Secret
   * @param {string} [options.accessToken] - 이미 발급받은 Access Token(있다면)
   * @param {string} [options.refreshToken] - 이미 발급받은 Refresh Token(있다면)
   */
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.accessToken = options.accessToken || '';
    this.refreshToken = options.refreshToken || '';

    this.httpClient = axios.create({
      baseURL: BASE_OPEN_API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * ----------------------------------------------------------------------------
   * 1. 인증 관련 메서드
   * ----------------------------------------------------------------------------
   */

  /**
   * 인증 코드(Authorization Code) 요청 URL 생성
   * @param {string} redirectUri
   * @param {string} state
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

    const res = await this.httpClient.post('/auth/v1/token', body);
    this.accessToken = res.data.accessToken;
    this.refreshToken = res.data.refreshToken;
    return res.data;
  }

  /**
   * Refresh Token으로 Access Token 갱신
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
    const res = await this.httpClient.post('/auth/v1/token', body);
    this.accessToken = res.data.accessToken;
    this.refreshToken = res.data.refreshToken;
    return res.data;
  }

  /**
   * Access Token, Refresh Token 모두 폐기
   * ([1](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization#치지직-access-token-삭제))
   * @param {string} token - 삭제할 토큰 (accessToken이나 refreshToken)
   * @param {'access_token'|'refresh_token'} tokenTypeHint
   */
  async revokeToken(token, tokenTypeHint = 'access_token') {
    const body = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      token,
      tokenTypeHint,
    };
    const res = await this.httpClient.post('/auth/v1/token/revoke', body);
    // token 성공적으로 삭제하면 code=200
    return res.data;
  }

  /**
   * ----------------------------------------------------------------------------
   * 2. User (유저 정보) ([2](https://chzzk.gitbook.io/chzzk/chzzk-api/user))
   * ----------------------------------------------------------------------------
   */

  /**
   * 현재 Access Token 소유 유저의 채널 정보를 조회
   * ([2](https://chzzk.gitbook.io/chzzk/chzzk-api/user#유저-정보-조회))
   */
  async getMyUserInfo() {
    this._checkAccessToken();
    const res = await this.httpClient.get('/open/v1/users/me', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * ----------------------------------------------------------------------------
   * 3. Channel (채널 정보) ([3](https://chzzk.gitbook.io/chzzk/chzzk-api/channel))
   * ----------------------------------------------------------------------------
   */

  /**
   * 여러 채널의 정보를 조회
   * @param {string[]} channelIds
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

    const res = await this.httpClient.get('/open/v1/channels', {
      headers,
      params,
    });
    return res.data;
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
   */
  async searchCategory(query, size = 20) {
    const headers = {
      'Client-Id': this.clientId,
      'Client-Secret': this.clientSecret,
    };
    const params = new URLSearchParams();
    params.append('query', query);
    params.append('size', size);

    const res = await this.httpClient.get('/open/v1/categories/search', {
      headers,
      params,
    });
    return res.data;
  }

  /**
   * ----------------------------------------------------------------------------
   * 5. Live (방송) ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live))
   * ----------------------------------------------------------------------------
   */

  /**
   * 라이브 목록 조회
   * @param {number} [size=20]
   * @param {string} [nextCursor] - 다음 화면 페이지
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

    const res = await this.httpClient.get('/open/v1/lives', {
      headers,
      params,
    });
    return res.data;
  }

  /**
   * 방송 스트림키 조회
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-스트림키-조회))
   */
  async getStreamKey() {
    this._checkAccessToken();
    const res = await this.httpClient.get('/open/v1/streams/key', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * 방송 설정 조회
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-설정-조회))
   */
  async getLiveSetting() {
    this._checkAccessToken();
    const res = await this.httpClient.get('/open/v1/lives/setting', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * 방송 설정 변경
   * 참고: 필요한 값만 변경하면 됩니다 (PATCH)
   * ([5](https://chzzk.gitbook.io/chzzk/chzzk-api/live#방송-설정-변경))
   * @param {Object} newSetting 
   * 예시 -> { defaultLiveTitle: '새 제목', categoryId: '', tags: ['ABC'] }
   */
  async updateLiveSetting(newSetting) {
    this._checkAccessToken();
    const res = await this.httpClient.patch('/open/v1/lives/setting', newSetting, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * ----------------------------------------------------------------------------
   * 6. Chat (채팅) ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat))
   * ----------------------------------------------------------------------------
   */

  /**
   * 채팅 메시지 전송
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-메시지-전송))
   * @param {string} message - 전송할 메시지 (최대 100자)
   */
  async sendChatMessage(message) {
    this._checkAccessToken();
    const body = { message };
    const res = await this.httpClient.post('/open/v1/chats/send', body, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * 채팅 공지 등록
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-공지-등록))
   * @param {Object} payload - { message?: string, messageId?: string }
   *   - message: 새 공지 메시지
   *   - messageId: 기존 전송 메시지를 공지로 등록
   */
  async setChatNotice(payload) {
    this._checkAccessToken();
    const res = await this.httpClient.post('/open/v1/chats/notice', payload, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return res.data;
  }

  /**
   * 채팅 설정 조회
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-설정-조회))
   */
  async getChatSettings() {
    this._checkAccessToken();
    const res = await this.httpClient.get('/open/v1/chats/settings', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * 채팅 설정 변경
   * ([6](https://chzzk.gitbook.io/chzzk/chzzk-api/chat#채팅-설정-변경))
   * @param {Object} newChatSettings
   *   - {
   *       chatAvailableCondition, // NONE or REAL_NAME
   *       chatAvailableGroup, // ALL, FOLLOWER, MANAGER, SUBSCRIBER
   *       minFollowerMinute,
   *       allowSubscriberInFollowerMode
   *     }
   */
  async updateChatSettings(newChatSettings) {
    this._checkAccessToken();
    const res = await this.httpClient.put('/open/v1/chats/settings', newChatSettings, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    return res.data;
  }

  /**
   * ----------------------------------------------------------------------------
   * 7. Drops (드롭스) ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops))
   * ----------------------------------------------------------------------------
   */

  /**
   * 드롭스 리워드 지급 요청 조회
   * ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops#1.2-드롭스-리워드-지급-요청-조회-api))
   * @param {Object} options - { from, size, claimId, channelId, campaignId, categoryId, fulfillmentState }
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

    const res = await this.httpClient.get('/open/v1/drops/reward-claims', {
      headers,
      params,
    });
    return res.data;
  }

  /**
   * 드롭스 리워드 지급 상태 변경
   * ([7](https://chzzk.gitbook.io/chzzk/chzzk-api/drops#1.3-드롭스-리워드-지급-api))
   * @param {string[]} claimIds 
   * @param {'CLAIMED'|'FULFILLED'} fulfillmentState
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
    const res = await this.httpClient.put('/open/v1/drops/reward-claims', body, {
      headers,
    });
    return res.data;
  }

  /**
   * 내부에서 Access Token 확인
   */
  _checkAccessToken() {
    if (!this.accessToken) {
      throw new Error('Access Token이 설정되어 있지 않습니다. 먼저 발급받으세요.');
    }
  }
} 