# k6 테스트 실행 스크립트
#
# 사용법:
#   .\run-k6-test.ps1 -Scenario load -Target dev -MaxVUs 300
#
# 파라미터:
#   -Scenario: baseline, smoke, load, stress, spike (기본값: load)
#   -Target:   local, dev (기본값: dev)
#   -MaxVUs:   최대 가상 사용자 수 (기본값: 시나리오별 자동)
#   -TestFile: 테스트 파일명 (기본값: user-journey-test)

param(
    [ValidateSet("baseline", "smoke", "load", "stress", "spike")]
    [string]$Scenario = "load",

    [ValidateSet("local", "dev")]
    [string]$Target = "dev",

    [int]$MaxVUs = 0,

    [string]$TestFile = "user-journey-test"
)

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# .env 파일 로드
$EnvFile = Join-Path $ProjectRoot ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

# Target에 따른 BASE_URL 설정
$BASE_URL = if ($Target -eq "local") {
    "http://localhost:8080"
} else {
    "https://$($env:API_DOMAIN_DEV)"
}

# Prometheus 설정
$PROMETHEUS_PORT = if ($env:PROMETHEUS_PORT) { $env:PROMETHEUS_PORT } else { "9090" }
$PROMETHEUS_URL = "http://localhost:$PROMETHEUS_PORT/api/v1/write"

# 기본 MaxVUs 설정
$DefaultMaxVUs = @{
    "baseline" = 1
    "smoke"    = 10
    "load"     = 300
    "stress"   = 500
    "spike"    = 1000
}
if ($MaxVUs -eq 0) {
    $MaxVUs = $DefaultMaxVUs[$Scenario]
}

# 테스트 파일 경로 확인
$k6Script = Join-Path $ProjectRoot "k6\tests\$TestFile.js"
if (-not (Test-Path $k6Script)) {
    Write-Host "Test file not found: $k6Script" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available tests:" -ForegroundColor Yellow
    Get-ChildItem (Join-Path $ProjectRoot "k6\tests\*.js") | ForEach-Object {
        Write-Host "  - $($_.BaseName)"
    }
    exit 1
}

Write-Host ""
Write-Host "======================================"
Write-Host "  k6 Load Test Runner"
Write-Host "======================================"
Write-Host "  Target:     $Target"
Write-Host "  BASE_URL:   $BASE_URL"
Write-Host "  Scenario:   $Scenario"
Write-Host "  Max VUs:    $MaxVUs"
Write-Host "  Test File:  $TestFile"
Write-Host "  Prometheus: $PROMETHEUS_URL"
Write-Host "======================================"
Write-Host ""

# Prometheus Remote Write 환경변수 설정
$env:K6_PROMETHEUS_RW_SERVER_URL = $PROMETHEUS_URL
$env:K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM = "true"

# k6 테스트 실행
k6 run --out experimental-prometheus-rw `
    -e "BASE_URL=$BASE_URL" `
    -e "SCENARIO=$Scenario" `
    -e "MAX_VUS=$MaxVUs" `
    $k6Script
