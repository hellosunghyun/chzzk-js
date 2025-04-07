# Chzzk SDK

네이버 치지직(CHZZK) API를 쉽게 사용할 수 있는 JavaScript SDK입니다.

## 설치 방법

```bash
npm install chzzk-js
```

## 시작하기

### 1. 인증 정보 설정

먼저 [치지직 개발자 센터](https://developers.chzzk.naver.com)에서 애플리케이션을 등록하고 Client ID와 Client Secret을 발급받으세요.

```javascript
import Chzzk from 'chzzk-js';

const chzzk = new Chzzk({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  // 자동 토큰 갱신 설정 (선택 사항)
  autoRefreshToken: true,
  tokenRefreshThresholdMs: 5 * 60 * 1000 // 토큰 만료 5분 전에 갱신
});
```

### 2. 사용자 인증

치지직 API를 사용하기 위해서는 사용자 인증이 필요합니다.

```javascript
// 1. 인증 URL 생성
const authUrl = chzzk.getAuthorizationCodeUrl('YOUR_REDIRECT_URI', 'STATE');
// 사용자를 authUrl로 리다이렉트

// 2. 인증 코드로 토큰 발급
const tokenInfo = await chzzk.issueAccessTokenByCode('AUTH_CODE', 'STATE');
```

## 주요 기능

### 1. 인증 관리
```javascript
// 인증 코드 URL 생성
const authUrl = chzzk.getAuthorizationCodeUrl('YOUR_REDIRECT_URI', 'STATE');

// 인증 코드로 토큰 발급
const tokenInfo = await chzzk.issueAccessTokenByCode('AUTH_CODE', 'STATE');

// 토큰 갱신
await chzzk.refreshAccessToken();

// 토큰 폐기
await chzzk.revokeToken(token, 'access_token');
```

### 2. 유저 정보
```javascript
// 내 유저 정보 조회
const myInfo = await chzzk.getMyUserInfo();
```

### 3. 채널 정보
```javascript
// 여러 채널 정보 조회
const channels = await chzzk.getChannels(['channel1', 'channel2']);

// 단일 채널 정보 조회 (편의 메서드)
const channel = await chzzk.getChannel('channel1');
```

### 4. 카테고리
```javascript
// 카테고리 검색
const categories = await chzzk.searchCategory('게임', 20);
```

### 5. 라이브 방송
```javascript
// 라이브 목록 조회
const lives = await chzzk.getLiveList(20, 'nextCursor');

// 스트림 키 조회
const streamKey = await chzzk.getStreamKey();

// 방송 설정 조회
const settings = await chzzk.getLiveSetting();

// 방송 설정 변경
await chzzk.updateLiveSetting({
  defaultLiveTitle: '새 방송 제목',
  categoryId: '카테고리ID',
  tags: ['태그1', '태그2']
});
```

### 6. 채팅
```javascript
// 채팅 메시지 전송
await chzzk.sendChatMessage('안녕하세요!');

// 채팅 공지 등록
await chzzk.setChatNotice({ message: '공지사항입니다!' });

// 채팅 설정 조회
const chatSettings = await chzzk.getChatSettings();

// 채팅 설정 변경
await chzzk.updateChatSettings({
  chatAvailableCondition: 'NONE',
  chatAvailableGroup: 'ALL',
  minFollowerMinute: 0,
  allowSubscriberInFollowerMode: true
});
```

### 7. 드롭스 (Drops)
```javascript
// 드롭스 리워드 지급 요청 조회
const claims = await chzzk.getDropsRewardClaims({
  size: 20,
  channelId: '채널ID'
});

// 드롭스 리워드 지급 상태 변경
await chzzk.updateDropsRewardClaims(
  ['claimId1', 'claimId2'],
  'FULFILLED'
);
```

### 8. 이벤트 핸들링

SDK는 다양한 이벤트를 발생시키며, 이를 구독하여 처리할 수 있습니다.

```javascript
// 이벤트 리스너 등록
const removeListener = chzzk.on('chatMessage', ({ nickname, message }) => {
  console.log(`${nickname}: ${message}`);
});

// 이벤트 리스너 제거
removeListener();

// 이벤트 한 번만 수신
chzzk.once('chatConnected', ({ channelId }) => {
  console.log(`채널 ${channelId}에 연결되었습니다`);
});

// 지원하는 이벤트 목록:
// - tokenRefresh: 토큰이 갱신되었을 때
// - tokenExpired: 토큰이 만료되었을 때
// - chatMessage: 채팅 메시지를 받았을 때
// - chatDonation: 후원을 받았을 때
// - chatSubscription: 구독 메시지를 받았을 때
// - chatNotice: 채팅 공지가 등록되었을 때
// - chatConnected: 채팅에 연결되었을 때
// - chatDisconnected: 채팅 연결이 끊겼을 때
// - chatError: 채팅 처리 중 오류가 발생했을 때
```

### 9. 실시간 채팅 (웹소켓)

실시간 채팅을 통해 채팅 메시지, 후원, 구독 등의 이벤트를 받을 수 있습니다.

```javascript
// 채팅 연결
await chzzk.connectChat('channelId');

// 채팅 메시지 이벤트 처리
chzzk.on('chatMessage', (data) => {
  console.log(`${data.nickname}: ${data.message}`);
});

// 후원 이벤트 처리
chzzk.on('chatDonation', (data) => {
  console.log(`${data.nickname}님이 ${data.amount}원 후원: ${data.message}`);
});

// 구독 이벤트 처리
chzzk.on('chatSubscription', (data) => {
  console.log(`${data.nickname}님이 ${data.months}개월 구독: ${data.message}`);
});

// 채팅 연결 종료
await chzzk.disconnectChat();
```

### 10. 검색 API

치지직의 다양한 콘텐츠를 검색할 수 있습니다.

```javascript
// 라이브 방송 검색
const liveResults = await chzzk.searchLives({
  query: '게임',
  size: 20,
  categoryId: '카테고리ID'
});

// 채널 검색
const channelResults = await chzzk.searchChannels({
  query: '스트리머',
  size: 20
});

// 통합 검색 (채널, 라이브, VOD)
const searchResults = await chzzk.search({
  query: '키워드',
  size: 20
});
```

### 11. VOD 관련 기능

VOD 목록 조회, 업로드, 관리 등의 기능을 제공합니다.

```javascript
// VOD 목록 조회
const vodList = await chzzk.getVods({
  channelId: '채널ID',
  size: 20
});

// 특정 VOD 상세 정보 조회
const vodInfo = await chzzk.getVod('vodId');

// 내 VOD 목록 조회
const myVods = await chzzk.getMyVods({ size: 20 });

// VOD 업로드 URL 생성
const uploadUrl = await chzzk.createVodUploadUrl({
  title: 'VOD 제목',
  description: 'VOD 설명',
  categoryId: '카테고리ID',
  tags: ['태그1', '태그2'],
  visibility: 'PUBLIC' // PUBLIC, PRIVATE, UNLISTED
});

// VOD 메타데이터 수정
await chzzk.updateVodMetadata('vodId', {
  title: '수정된 제목',
  description: '수정된 설명'
});

// VOD 삭제
await chzzk.deleteVod('vodId');
```

### 12. 팔로워/구독자 관리

팔로워 및 구독자 관련 정보를 관리합니다.

```javascript
// 내 팔로워 목록 조회
const followers = await chzzk.getMyFollowers({ size: 20 });

// 내가 팔로우한 채널 목록 조회
const followings = await chzzk.getMyFollowings({ size: 20 });

// 채널 팔로우
await chzzk.followChannel('channelId');

// 채널 팔로우 취소
await chzzk.unfollowChannel('channelId');

// 구독자 목록 조회
const subscribers = await chzzk.getMySubscribers({ size: 20 });

// 구독자 통계 조회
const subscriberStats = await chzzk.getMySubscriberStats();

// 내 구독 정보 조회
const subscriptions = await chzzk.getMySubscriptions();
```

### 13. 채팅 모더레이션

채팅 금지 사용자 관리, 모더레이터 관리, 필터링 단어 관리 등의 기능을 제공합니다.

```javascript
// 채팅 금지 사용자 목록 조회
const bannedUsers = await chzzk.getChatBannedUsers({ size: 20 });

// 채팅 금지 사용자 추가
await chzzk.banChatUser({
  userId: '사용자ID',
  durationSeconds: 3600, // 1시간, 없으면 영구 금지
  reason: '금지 사유'
});

// 채팅 금지 사용자 해제
await chzzk.unbanChatUser('사용자ID');

// 채팅 모더레이터 목록 조회
const moderators = await chzzk.getChatModerators({ size: 20 });

// 채팅 모더레이터 추가
await chzzk.addChatModerator('사용자ID');

// 채팅 모더레이터 제거
await chzzk.removeChatModerator('사용자ID');

// 채팅 필터링 단어 목록 조회
const filterWords = await chzzk.getChatFilterWords({ size: 20 });

// 채팅 필터링 단어 추가
await chzzk.addChatFilterWord('금지단어');

// 채팅 필터링 단어 삭제
await chzzk.removeChatFilterWord('필터단어ID');
```

## 에러 처리

SDK는 API 호출 실패 시 적절한 에러를 throw합니다. try-catch 구문을 사용하여 에러를 처리하세요.

```javascript
try {
  await chzzk.refreshAccessToken();
} catch (error) {
  console.error('토큰 갱신 실패:', error.message);
}
```

## 웹소켓 사용 시 주의사항

브라우저 환경에서는 내장 WebSocket을 사용하지만, Node.js 환경에서는 `ws` 패키지를 설치해야 합니다:

```bash
npm install ws
```

Node.js 환경에서 사용할 경우 WebSocket을 전역으로 설정:

```javascript
import WebSocket from 'ws';
global.WebSocket = WebSocket;
```

## 브라우저 지원

이 SDK는 모던 브라우저(Chrome, Firefox, Safari, Edge 등)에서 동작합니다. 단, 웹소켓 및 일부 기능은 브라우저의 CORS 정책으로 인해 제한될 수 있습니다.

## 자동 토큰 갱신

SDK는 기본적으로 토큰이 만료되기 전에 자동으로 갱신합니다. 이 기능을 비활성화하거나 설정을 변경하려면:

```javascript
const chzzk = new Chzzk({
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  autoRefreshToken: false, // 자동 갱신 비활성화
  tokenRefreshThresholdMs: 10 * 60 * 1000 // 만료 10분 전에 갱신 (기본값: 5분)
});
```

## 배포하기

이 패키지를 npm에 배포하려면 다음 단계를 따르세요:

1. npm에 로그인합니다:
```bash
npm login
```

2. 패키지를 배포합니다:
```bash
npm publish
```

### 버전 관리

새 버전을 배포할 때는 다음 명령어를 사용하세요:

```bash
# 패치 버전 업데이트 (1.0.0 -> 1.0.1)
npm version patch

# 마이너 버전 업데이트 (1.0.0 -> 1.1.0)
npm version minor

# 메이저 버전 업데이트 (1.0.0 -> 2.0.0)
npm version major
```

버전을 업데이트한 후 `npm publish`를 실행하여 새 버전을 배포합니다.

## 문서

자세한 API 문서는 [치지직 개발자 문서](https://chzzk.gitbook.io/chzzk/)를 참고하세요.

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다.
