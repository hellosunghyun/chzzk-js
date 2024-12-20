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
  clientSecret: 'YOUR_CLIENT_SECRET'
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

## 에러 처리

SDK는 API 호출 실패 시 적절한 에러를 throw합니다. try-catch 구문을 사용하여 에러를 처리하세요.

```javascript
try {
  await chzzk.refreshAccessToken();
} catch (error) {
  console.error('토큰 갱신 실패:', error.message);
}
```

## 문서

자세한 API 문서는 [치지직 개발자 문서](https://chzzk.gitbook.io/chzzk/)를 참고하세요.

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다.
