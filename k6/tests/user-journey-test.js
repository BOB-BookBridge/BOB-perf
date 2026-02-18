import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration', true);
const memberInfoDuration = new Trend('member_info_duration', true);
const unreadMessagesDuration = new Trend('unread_messages_duration', true);
const postsListDuration = new Trend('posts_list_duration', true);
const postSearchDuration = new Trend('post_search_duration', true);
const postDetailDuration = new Trend('post_detail_duration', true);
const chatroomListDuration = new Trend('chatroom_list_duration', true);
const chatroomDetailDuration = new Trend('chatroom_detail_duration', true);
const chatMessagesDuration = new Trend('chat_messages_duration', true);
const chatSendDuration = new Trend('chat_send_duration', true);
const successfulLogins = new Counter('successful_logins');
const postDetailNotFound = new Counter('post_detail_not_found');

const BASE_URL = __ENV.BASE_URL || 'https://dev.bookbridge.kr';
const SCENARIO = __ENV.SCENARIO || 'load';
const MAX_VUS = parseInt(__ENV.MAX_VUS) || null;

const DEFAULT_MAX_VUS = {
  baseline: 1,
  smoke: 10,
  load: 300,
  stress: 500,
  spike: 1000,
};

const maxVUs = MAX_VUS || DEFAULT_MAX_VUS[SCENARIO] || 300;

function buildScenarios(max) {
  return {
    baseline: {
      vus: 1,
      duration: '1m',
    },
    smoke: {
      vus: Math.min(10, max),
      duration: '1m',
    },
    load: {
      stages: [
        { duration: '1m', target: Math.round(max * 0.5) },
        { duration: '1m', target: max },
        { duration: '6m', target: max },
        { duration: '2m', target: 0 },
      ],
    },
    stress: {
      stages: [
        { duration: '20s', target: Math.round(max * 0.2) },
        { duration: '20s', target: Math.round(max * 0.4) },
        { duration: '20s', target: Math.round(max * 0.6) },
        { duration: '20s', target: Math.round(max * 0.8) },
        { duration: '20s', target: max },
        { duration: '1m', target: max },
        { duration: '30s', target: 0 },
      ],
    },
    spike: {
      stages: [
        { duration: '10s', target: Math.round(max * 0.1) },
        { duration: '10s', target: max },
        { duration: '1m', target: max },
        { duration: '10s', target: Math.round(max * 0.1) },
        { duration: '30s', target: 0 },
      ],
    },
  };
}

const scenarios = buildScenarios(maxVUs);

export const options = {
  ...scenarios[SCENARIO],
  thresholds: {
    'http_req_duration{req_group:app}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_failed{req_group:app}': ['rate<0.05'],
    errors: ['rate<0.05'],
    login_duration: ['p(95)<500'],
    posts_list_duration: ['p(95)<500'],
    post_detail_duration: ['p(95)<300'],
  },
};

const TEST_USER_COUNT = 300;
const POST_ID_MIN = 15;
const POST_ID_MAX = 30014;
const searchKeys = ['ALL', 'AUTHOR', 'TITLE'];
const searchKeywords = ['내일', '대화', '나는', '집', '여행'];

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getUserCredentials(vuId) {
  const userNum = ((vuId - 1) % TEST_USER_COUNT) + 1;
  const paddedNum = String(userNum).padStart(3, '0');
  return {
    email: `tester${paddedNum}@bob.com`,
    password: '1Q2w3e4r',
  };
}

function buildQueryString(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function extractCookies(response) {
  const cookies = {};
  const cookieHeaders = response.headers['Set-Cookie'];

  if (cookieHeaders) {
    const headerArray = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
    headerArray.forEach((cookie) => {
      const match = cookie.match(/^([^=]+)=([^;]*)/);
      if (match) {
        cookies[match[1]] = match[2];
      }
    });
  }

  return cookies;
}

function getCookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function extractEmdIdFromMemberInfo(responseBody) {
  if (!responseBody) return null;
  try {
    const data = JSON.parse(responseBody);
    return data?.area?.emdId ?? data?.data?.area?.emdId ?? null;
  } catch (e) {
    return null;
  }
}

function login(credentials) {
  const response = http.post(`${BASE_URL}/auth/login`, JSON.stringify(credentials), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    tags: { name: 'login', req_group: 'auth' },
  });

  loginDuration.add(response.timings.duration);

  const success = check(response, {
    'login: status is 200': (r) => r.status === 200,
    'login: has AUTHORIZATION cookie': (r) => r.headers['Set-Cookie'] && r.headers['Set-Cookie'].includes('AUTHORIZATION'),
  });

  if (success) successfulLogins.add(1);

  return { success, cookies: extractCookies(response), response };
}

function getMemberInfo(cookies) {
  const response = http.get(`${BASE_URL}/members/me`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'member_info', req_group: 'app' },
  });

  memberInfoDuration.add(response.timings.duration);

  const success = check(response, {
    'member_info: status is 200': (r) => r.status === 200,
    'member_info: has response body': (r) => r.body && r.body.length > 0,
  });

  errorRate.add(!success);
  return { success, response, emdId: success ? extractEmdIdFromMemberInfo(response.body) : null };
}

function getUnreadMessages(cookies) {
  const response = http.get(`${BASE_URL}/chatrooms/messages/unread`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'unread_messages', req_group: 'app' },
  });

  unreadMessagesDuration.add(response.timings.duration);

  const success = check(response, {
    'unread_messages: status is 200': (r) => r.status === 200,
  });

  errorRate.add(!success);
  return { success, response };
}

function getPostsList(cookies, emdId) {
  const response = http.get(`${BASE_URL}/posts${buildQueryString({ emdId, sort: 'RECENT', size: 12, page: 0 })}`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'posts_list', req_group: 'app' },
  });

  postsListDuration.add(response.timings.duration);

  const success = check(response, {
    'posts_list: status is 200': (r) => r.status === 200,
    'posts_list: response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);
  return { success, response };
}

function searchPosts(cookies, emdId) {
  const params = {
    key: getRandomElement(searchKeys),
    keyword: getRandomElement(searchKeywords),
    emdId,
    sort: 'RECENT',
    size: 12,
    page: 0,
  };

  const response = http.get(`${BASE_URL}/posts${buildQueryString(params)}`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'posts_search', req_group: 'app' },
  });

  postSearchDuration.add(response.timings.duration);

  const success = check(response, {
    'posts_search: status is 200': (r) => r.status === 200,
  });

  errorRate.add(!success);
  return { success, response };
}

function getPostDetail(cookies) {
  const postId = getRandomInt(POST_ID_MIN, POST_ID_MAX);
  const response = http.get(`${BASE_URL}/posts/${postId}`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'post_detail', req_group: 'app' },
  });

  postDetailDuration.add(response.timings.duration);

  if (response.status === 404) postDetailNotFound.add(1);

  const success = check(response, {
    'post_detail: status is 200': (r) => r.status === 200,
    'post_detail: response time < 300ms': (r) => r.timings.duration < 300,
  });

  errorRate.add(!success && response.status !== 404);
  return { success, response };
}

function getChatroomList(cookies) {
  const response = http.get(`${BASE_URL}/chatrooms`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'chatroom_list', req_group: 'app' },
  });

  chatroomListDuration.add(response.timings.duration);

  const success = check(response, {
    'chatroom_list: status is 200': (r) => r.status === 200,
  });

  errorRate.add(!success);

  let firstChatroomId = null;
  if (success && response.body) {
    try {
      const data = JSON.parse(response.body);
      if (Array.isArray(data) && data.length > 0) {
        firstChatroomId = data[0].chatroomId || data[0].id;
      } else if (data.content && Array.isArray(data.content) && data.content.length > 0) {
        firstChatroomId = data.content[0].chatroomId || data.content[0].id;
      }
    } catch (e) {
      // ignore
    }
  }

  return { success, response, firstChatroomId };
}

function getChatroomDetail(cookies, chatroomId) {
  if (!chatroomId) return { success: false, response: null };

  const response = http.get(`${BASE_URL}/chatrooms/${chatroomId}`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'chatroom_detail', req_group: 'app' },
  });

  chatroomDetailDuration.add(response.timings.duration);

  const success = check(response, {
    'chatroom_detail: status is 200': (r) => r.status === 200,
  });

  errorRate.add(!success);
  return { success, response };
}

function getChatMessages(cookies, chatroomId) {
  if (!chatroomId) return { success: false, response: null };

  const response = http.get(`${BASE_URL}/chatrooms/${chatroomId}/messages`, {
    headers: {
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'chat_messages', req_group: 'app' },
  });

  chatMessagesDuration.add(response.timings.duration);

  const success = check(response, {
    'chat_messages: status is 200': (r) => r.status === 200,
  });

  errorRate.add(!success);
  return { success, response };
}

function sendChatMessage(cookies, chatroomId) {
  if (!chatroomId) return { success: false, response: null };

  const response = http.post(`${BASE_URL}/chatrooms/${chatroomId}/messages`, JSON.stringify({
    message: `테스트 메시지 ${Date.now()}`,
    fileNames: [],
  }), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: getCookieHeader(cookies),
    },
    tags: { name: 'chat_send', req_group: 'app' },
  });

  chatSendDuration.add(response.timings.duration);

  const success = check(response, {
    'chat_send: status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(!success);
  return { success, response };
}

export default function () {
  const credentials = getUserCredentials(__VU);

  const loginResult = group('1. Login', () => login(credentials));
  if (!loginResult.success) {
    sleep(getRandomInt(1, 3));
    return;
  }

  const cookies = loginResult.cookies;
  sleep(getRandomInt(1, 2));

  const memberInfoResult = group('2. Get Member Info', () => getMemberInfo(cookies));
  if (!memberInfoResult.success || !memberInfoResult.emdId) {
    sleep(getRandomInt(1, 3));
    return;
  }

  const emdId = memberInfoResult.emdId;
  sleep(getRandomInt(1, 2));

  group('3. Get Unread Messages', () => getUnreadMessages(cookies));
  sleep(getRandomInt(1, 2));

  group('4. Get Main Posts List', () => getPostsList(cookies, emdId));
  sleep(getRandomInt(1, 2));

  group('5. Search Posts', () => searchPosts(cookies, emdId));
  sleep(getRandomInt(1, 3));

  group('6. Get Post Detail', () => getPostDetail(cookies));
  sleep(getRandomInt(1, 2));

  const chatroomResult = group('7. Get Chatroom List', () => getChatroomList(cookies));
  sleep(getRandomInt(1, 2));

  const chatroomId = chatroomResult.firstChatroomId;

  if (chatroomId) {
    group('8. Get Chatroom Detail', () => getChatroomDetail(cookies, chatroomId));
    sleep(getRandomInt(1, 2));

    group('9. Get Chat Messages', () => getChatMessages(cookies, chatroomId));
    sleep(getRandomInt(1, 2));

    if (Math.random() < 0.5) {
      group('10. Send Chat Message', () => sendChatMessage(cookies, chatroomId));
      sleep(getRandomInt(1, 2));
    }
  }

  sleep(getRandomInt(2, 5));
}

export function setup() {
  console.log(`
====================================
  User Journey Load Test
====================================
  Base URL:  ${BASE_URL}
  Scenario:  ${SCENARIO}
  Max VUs:   ${maxVUs}
====================================
  `);

  const healthCheck = http.get(`${BASE_URL}/posts?size=1`);
  if (healthCheck.status !== 200) {
    throw new Error(`Server is not healthy. Status: ${healthCheck.status}`);
  }
  console.log('Server health check passed');

  const testCredentials = getUserCredentials(1);
  const loginTest = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify(testCredentials),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginTest.status !== 200) {
    console.log(`Warning: Login test failed. Status: ${loginTest.status}`);
  } else {
    console.log('Login test passed');
  }
}

export function teardown() {
  console.log('Test completed.');
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `k6/results/user-journey-${SCENARIO}-${timestamp}.json`;

  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
    [filename]: JSON.stringify(data, null, 2),
  };
}
