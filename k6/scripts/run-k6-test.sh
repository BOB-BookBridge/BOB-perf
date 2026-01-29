#!/bin/bash

# k6 테스트 실행 스크립트 (mac/linux)
# Prometheus로 메트릭을 전송하여 Grafana에서 실시간 모니터링 가능
#
# 사용법:
#   ./run-k6-test.sh [옵션]
#
# 옵션:
#   -s, --scenario   baseline, load, stress (기본값: load)
#   -t, --target     local, dev (기본값: dev)
#   -v, --max-vus    최대 가상 사용자 수 (기본값: load=300, stress=500)
#   -f, --file       테스트 파일명 (기본값: post-list-test)
#
# 예시:
#   ./run-k6-test.sh -s load -t dev -v 300
#   ./run-k6-test.sh --scenario stress --target local --max-vus 500
#   ./run-k6-test.sh -f post-detail-test -s load

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# 기본값 설정
SCENARIO="load"
TARGET="dev"
MAX_VUS=0
TEST_FILE="post-list-test"

# 인자 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--scenario)
            SCENARIO="$2"
            shift 2
            ;;
        -t|--target)
            TARGET="$2"
            shift 2
            ;;
        -v|--max-vus)
            MAX_VUS="$2"
            shift 2
            ;;
        -f|--file)
            TEST_FILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# .env 파일 로드
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Target에 따른 BASE_URL 설정
case $TARGET in
    local)
        BASE_URL="http://localhost:8080"
        ;;
    dev)
        BASE_URL="https://dev.bookbridge.kr"
        ;;
    *)
        echo "Invalid target: $TARGET (use: local, dev)"
        exit 1
        ;;
esac

# Prometheus 설정
PROMETHEUS_URL="http://localhost:${PROMETHEUS_PORT:-9090}/api/v1/write"

# 기본 MaxVUs 설정
if [ "$MAX_VUS" -eq 0 ]; then
    case $SCENARIO in
        baseline) MAX_VUS=1 ;;
        load)     MAX_VUS=300 ;;
        stress)   MAX_VUS=500 ;;
    esac
fi

# 테스트 파일 경로
TEST_SCRIPT="$PROJECT_ROOT/k6/tests/${TEST_FILE}.js"
if [ ! -f "$TEST_SCRIPT" ]; then
    echo "Test file not found: $TEST_SCRIPT"
    echo "Available tests:"
    ls -1 "$PROJECT_ROOT/k6/tests/"*.js 2>/dev/null | xargs -n1 basename | sed 's/\.js$//'
    exit 1
fi

echo ""
echo "======================================"
echo "  k6 Load Test Runner"
echo "======================================"
echo "  Target:    $TARGET"
echo "  BASE_URL:  $BASE_URL"
echo "  Scenario:  $SCENARIO"
echo "  Max VUs:   $MAX_VUS"
echo "  Test File: $TEST_FILE"
echo "  Prometheus: $PROMETHEUS_URL"
echo "======================================"
echo ""

# k6 테스트 실행 (Prometheus Remote Write 활성화)
K6_PROMETHEUS_RW_SERVER_URL="$PROMETHEUS_URL" \
K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true \
k6 run \
    --out experimental-prometheus-rw \
    -e BASE_URL="$BASE_URL" \
    -e SCENARIO="$SCENARIO" \
    -e MAX_VUS="$MAX_VUS" \
    "$TEST_SCRIPT"
