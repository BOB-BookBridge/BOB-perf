export const thresholds = {
  http_req_duration: ['p(95)<500'],  // 95% 요청이 500ms 이하
  http_req_failed: ['rate<0.01'],    // 실패율 1% 이하
  http_reqs: ['rate>50'],            // 초당 50개 이상 처리
};
