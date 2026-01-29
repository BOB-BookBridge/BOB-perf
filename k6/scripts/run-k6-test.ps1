# k6 테스트 실행 스크립트 (windows)
# Prometheus로 메트릭을 전송하여 Grafana에서 실시간 모니터링 가능
#
# 사용법:
#   .\run-k6-test.ps1 -Scenario load -Target dev -MaxVUs 300
#   .\run-k6-test.ps1 -TestFile post-detail-test -Scenario load
#
# 파라미터:
#   -Scenario: baseline, load, stress (기본값: load)
#   -Target:   local, dev (기본값: dev)
#   -MaxVUs:   최대 가상 사용자 수 (기본값: load=300, stress=500)
#   -TestFile: 테스트 파일명 (기본값: post-list-test)

param(
    [ValidateSet("baseline", "load", "stress")]
    [string]$Scenario = "load",

    [ValidateSet("local", "dev")]
    [string]$Target = "dev",

    [int]$MaxVUs = 0,

    [string]$TestFile = "post-list-test"
)

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# .env 파일 로드
$EnvFile = Join-Path $ProjectRoot ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()

            while ($value -match '\$\{([^}]+)\}') {
                $refVar = $matches[1]
                $refValue = [Environment]::GetEnvironmentVariable($refVar)
                if ($refValue) {
                    $value = $value -replace "\`$\{$refVar\}", $refValue
                } else {
                    break
                }
            }
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

# Target에 따른 BASE_URL 설정
$TargetUrls = @{
    "local" = "http://localhost:8080"
    "dev"   = "https://dev.bookbridge.kr"
}
$BASE_URL = $TargetUrls[$Target]

# Prometheus 설정
$PROMETHEUS_PORT = if ($env:PROMETHEUS_PORT) { $env:PROMETHEUS_PORT } else { "9090" }
$PROMETHEUS_URL = "http://localhost:$PROMETHEUS_PORT/api/v1/write"

# 기본 MaxVUs 설정
$DefaultMaxVUs = @{
    "baseline" = 1
    "load"     = 300
    "stress"   = 500
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
Write-Host "  Target:    $Target"
Write-Host "  BASE_URL:  $BASE_URL"
Write-Host "  Scenario:  $Scenario"
Write-Host "  Max VUs:   $MaxVUs"
Write-Host "  Test File: $TestFile"
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
