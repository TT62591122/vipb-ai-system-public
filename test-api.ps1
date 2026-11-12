if (-not $env:ADMIN_PASSWORD) { Write-Host "请先设置环境变量 ADMIN_PASSWORD（管理员口令）"; exit 1 }
# VIPB-AI-System API Health Check
$ErrorActionPreference = "Stop"

# Create session
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Login first
Write-Host "Logging in..."
$loginPage = Invoke-WebRequest -Uri "http://localhost:3001/login" -UseBasicParsing -WebSession $sess
$csrf = ''
if ($loginPage.Content -match 'name="_csrf".+?value="([^"]+)"') {
    $csrf = $Matches[1]
}

$login = Invoke-WebRequest -Uri "http://localhost:3001/login" -Method POST -ContentType "application/x-www-form-urlencoded" -Body "username=admin&password=$env:ADMIN_PASSWORD&_csrf=$csrf" -UseBasicParsing -WebSession $sess -MaximumRedirection 5
Write-Host "Login completed"

# API endpoints to test
$apis = @(
    @{Method="GET"; Path="/api/health"},
    @{Method="GET"; Path="/api/esim/providers"},
    @{Method="GET"; Path="/api/esim/phones"},
    @{Method="GET"; Path="/api/esim/master-phone"},
    @{Method="GET"; Path="/api/esim/logs"},
    @{Method="GET"; Path="/api/env/proxies"},
    @{Method="GET"; Path="/api/env/phones"},
    @{Method="GET"; Path="/api/env/vpn-nodes"},
    @{Method="GET"; Path="/api/env/subscriptions"},
    @{Method="GET"; Path="/api/env/chains"},
    @{Method="GET"; Path="/api/products"},
    @{Method="GET"; Path="/api/customers"},
    @{Method="GET"; Path="/api/trade/deals"},
    @{Method="GET"; Path="/api/trade/inquiries"},
    @{Method="GET"; Path="/api/marketing/calendar"},
    @{Method="GET"; Path="/api/marketing/templates"},
    @{Method="GET"; Path="/api/social/posts"},
    @{Method="GET"; Path="/api/social-accounts"},
    @{Method="GET"; Path="/api/ai/logs"},
    @{Method="GET"; Path="/api/ai-command/tasks"},
    @{Method="GET"; Path="/api/ai-command/conversations"},
    @{Method="GET"; Path="/api/settings"},
    @{Method="GET"; Path="/api/inbox/conversations"},
    @{Method="GET"; Path="/api/inbox/unread"},
    @{Method="GET"; Path="/api/stats/overview"},
    @{Method="GET"; Path="/api/scoring/rules"},
    @{Method="GET"; Path="/api/antiban/rules"},
    @{Method="GET"; Path="/api/emergency/status"},
    @{Method="GET"; Path="/api/workflows"},
    @{Method="GET"; Path="/api/email-receiver/accounts"},
    @{Method="GET"; Path="/api/email-receiver/emails"},
    @{Method="GET"; Path="/api/followups/plans"},
    @{Method="GET"; Path="/api/wa-checker/status"},
    @{Method="GET"; Path="/api/dispatcher/status"},
    @{Method="GET"; Path="/api/calendar/events"},
    @{Method="GET"; Path="/api/analytics/overview"},
    @{Method="GET"; Path="/api/linkedin/prospects"},
    @{Method="GET"; Path="/api/digital-humans"},
    @{Method="GET"; Path="/api/videos"},
    @{Method="GET"; Path="/api/seo/status"},
    @{Method="GET"; Path="/api/restream/sessions"}
)

Write-Host "`nStarting API health checks..."
$apiResults = @()

foreach ($api in $apis) {
    try {
        $url = "http://localhost:3001" + $api.Path
        Write-Host "Testing: $($api.Method) $($api.Path)"
        
        $response = Invoke-WebRequest -Uri $url -Method $api.Method -UseBasicParsing -WebSession $sess
        $contentType = $response.Headers["Content-Type"]
        $isJson = $contentType -like "*json*"
        
        # Check if redirected to login (HTML page instead of JSON)
        $isHtmlLoginPage = $response.Content -match "<title>Login</title>|<form.*login"
        
        $result = "PASS"
        $issues = ""
        
        if ($response.StatusCode -ne 200) {
            $result = "FAIL"
            $issues += "HTTP $($response.StatusCode) "
        }
        if ($isHtmlLoginPage) {
            $result = "FAIL"
            $issues += "Redirected to login "
        } elseif (-not $isJson) {
            $result = "WARNING"
            $issues += "Not JSON ($contentType) "
        }
        
        $apiResults += [PSCustomObject]@{
            API = $api.Path
            Method = $api.Method
            StatusCode = $response.StatusCode
            ResponseType = $contentType
            Result = $result
            Issues = $issues.Trim()
        }
        
        Start-Sleep -Milliseconds 50
        
    } catch {
        $statusCode = "ERROR"
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode
        }
        
        $apiResults += [PSCustomObject]@{
            API = $api.Path
            Method = $api.Method
            StatusCode = $statusCode
            ResponseType = "N/A"
            Result = "FAIL"
            Issues = $_.Exception.Message
        }
    }
}

Write-Host "`nAPI Test Results:"
$apiResults | Format-Table -AutoSize

# Save results
$apiResults | Export-Csv -Path "D:\VIPB-AI-System\api-test-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "API results saved to CSV file"

# Summary
$passCount = ($apiResults | Where-Object { $_.Result -eq "PASS" }).Count
$warningCount = ($apiResults | Where-Object { $_.Result -eq "WARNING" }).Count
$failCount = ($apiResults | Where-Object { $_.Result -eq "FAIL" }).Count

Write-Host "`nAPI Test Summary:"
Write-Host "  PASS: $passCount"
Write-Host "  WARNING: $warningCount"
Write-Host "  FAIL: $failCount"