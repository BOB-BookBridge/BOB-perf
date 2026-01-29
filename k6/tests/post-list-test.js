import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 커스텀 메트릭
const errorRate = new Rate('errors');
const postsListDuration = new Trend('posts_list_duration', true);

// 테스트 설정
// 환경변수로 설정 가능:
//   BASE_URL: 테스트 대상 서버 URL
//   SCENARIO: baseline, load, stress
//   MAX_VUS: 최대 가상 사용자 수 (기본값: load=300, stress=500)
const BASE_URL = __ENV.BASE_URL || 'https://dev.bookbridge.kr';
const SCENARIO = __ENV.SCENARIO || 'load';
const MAX_VUS = parseInt(__ENV.MAX_VUS) || null;

// 시나리오별 기본 최대 VU
const DEFAULT_MAX_VUS = {
  baseline: 1,
  load: 300,
  stress: 500,
};

// 실제 사용할 최대 VU (환경변수 우선)
const maxVUs = MAX_VUS || DEFAULT_MAX_VUS[SCENARIO] || 300;

// 동적 시나리오 생성
function buildScenarios(max) {
  return {
    // 1. 베이스라인 테스트 (1명, 1분)
    baseline: {
      vus: 1,
      duration: '1m',
    },

    // 2. 부하 테스트 (3분)
    load: {
      stages: [
        { duration: '30s', target: max },  // ramp-up
        { duration: '2m', target: max },   // steady
        { duration: '30s', target: 0 },    // ramp-down
      ],
    },

    // 3. 스트레스 테스트 (3분, 단계적 증가)
    stress: {
      stages: [
        { duration: '20s', target: Math.round(max * 0.2) },
        { duration: '20s', target: Math.round(max * 0.4) },
        { duration: '20s', target: Math.round(max * 0.6) },
        { duration: '20s', target: Math.round(max * 0.8) },
        { duration: '20s', target: max },  // peak
        { duration: '40s', target: max },  // hold peak
        { duration: '40s', target: 0 },    // recovery
      ],
    },
  };
}

const scenarios = buildScenarios(maxVUs);

export const options = {
  ...scenarios[SCENARIO],

  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95%: 500ms, 99%: 1초 이내
    http_req_failed: ['rate<0.01'],                  // 에러율 1% 미만
    errors: ['rate<0.01'],
  },
};

// 테스트 시나리오 데이터
const categoryIds = [21, 22, 23, 24, 25, 26, 27, 28, 29]; // 프로그래밍, 문학 등
const sortOptions = ['RECENT', 'OLD', 'LOW_PRICE', 'HIGH_PRICE'];
const pageSizes = [10, 20, 50];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 메인 테스트 함수
export default function () {
  // 다양한 쿼리 조합으로 테스트
  const testCases = [
    // 1. 기본 조회 (필터 없음) - 가장 빈번
    () => fetchPosts({}),

    // 2. 페이지네이션
    () => fetchPosts({ page: getRandomInt(0, 10), size: getRandomElement(pageSizes) }),

    // 3. 카테고리 필터
    () => fetchPosts({ categoryId: getRandomElement(categoryIds) }),

    // 4. 정렬 옵션
    () => fetchPosts({ sort: getRandomElement(sortOptions) }),

    // 5. 복합 필터 (카테고리 + 정렬 + 페이징)
    () => fetchPosts({
      categoryId: getRandomElement(categoryIds),
      sort: getRandomElement(sortOptions),
      page: getRandomInt(0, 5),
      size: 20,
    }),
  ];

  // 가중치 기반 테스트 케이스 선택
  // 기본 조회가 가장 많음 (50%), 나머지 균등 분배
  const weights = [50, 15, 15, 10, 10];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  let selectedCase = testCases[0];
  for (let i = 0; i < weights.length; i++) {
    if (random < weights[i]) {
      selectedCase = testCases[i];
      break;
    }
    random -= weights[i];
  }

  selectedCase();

  // 사용자 행동 시뮬레이션 (1-3초 대기)
  sleep(getRandomInt(1, 3));
}

function buildQueryString(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

function fetchPosts(params) {
  const queryParams = {};

  if (params.page !== undefined) queryParams.page = params.page;
  if (params.size !== undefined) queryParams.size = params.size;
  if (params.categoryId) queryParams.categoryId = params.categoryId;
  if (params.sort) queryParams.sort = params.sort;
  if (params.emdId) queryParams.emdId = params.emdId;
  if (params.postStatus) queryParams.postStatus = params.postStatus;
  if (params.bookStatus) queryParams.bookStatus = params.bookStatus;

  const url = `${BASE_URL}/posts${buildQueryString(queryParams)}`;

  const startTime = Date.now();

  const response = http.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    tags: { name: 'posts_list' },
  });

  const duration = Date.now() - startTime;
  postsListDuration.add(duration);

  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response has content': (r) => r.body && r.body.length > 0,
    'response is valid JSON': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch (e) {
        return false;
      }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!success);

  // 응답 디버깅 (베이스라인 테스트에서만)
  if (SCENARIO === 'baseline' && !success) {
    console.log(`Failed request: ${url}`);
    console.log(`Status: ${response.status}`);
    console.log(`Duration: ${duration}ms`);
  }

  return response;
}

// 테스트 시작 시 정보 출력
export function setup() {
  console.log(`
====================================
  Posts List Load Test
====================================
  Scenario: ${SCENARIO}
  Base URL: ${BASE_URL}
  Max VUs:  ${maxVUs}
====================================
  `);

  // 서버 헬스체크
  const healthCheck = http.get(`${BASE_URL}/posts?size=1`);
  if (healthCheck.status !== 200) {
    throw new Error(`Server is not healthy. Status: ${healthCheck.status}`);
  }
  console.log('Server health check passed');
}

// 테스트 종료 시 요약 출력
export function handleSummary(data) {
  const duration = data.metrics.http_req_duration;
  const reqs = data.metrics.http_reqs;

  if (duration && reqs) {
    console.log('\n====== Test Summary ======');
    console.log(`Total Requests: ${reqs.values.count}`);
    console.log(`Avg Duration: ${duration.values.avg.toFixed(2)}ms`);
    console.log(`P90 Duration: ${duration.values['p(90)'].toFixed(2)}ms`);
    console.log(`P95 Duration: ${duration.values['p(95)'].toFixed(2)}ms`);
    console.log(`Max Duration: ${duration.values.max.toFixed(2)}ms`);
    console.log(`Requests/sec: ${reqs.values.rate.toFixed(2)}`);
  }

  return {
    'stdout': textSummary(data, { indent: '  ', enableColors: true }),
    'k6/results/posts-list-summary.json': JSON.stringify(data, null, 2),
  };
}

// k6 내장 텍스트 요약 함수
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
