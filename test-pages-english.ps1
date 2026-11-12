if (-not $env:ADMIN_PASSWORD) { Write-Host "请先设置环境变量 ADMIN_PASSWORD（管理员口令）"; exit 1 }
# VIPB-AI-System Page Rendering Test
$ErrorActionPreference = "Stop"

# Create session
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Login
Write-Host "Logging in..."
$loginPage = Invoke-WebRequest -Uri "http://localhost:3001/login" -UseBasicParsing -WebSession $sess
$csrf = ''
if ($loginPage.Content -match 'name="_csrf".+?value="([^"]+)"') {
    $csrf = $Matches[1]
    Write-Host "CSRF token: $csrf"
}

$login = Invoke-WebRequest -Uri "http://localhost:3001/login" -Method POST -ContentType "application/x-www-form-urlencoded" -Body "username=admin&password=$env:ADMIN_PASSWORD&_csrf=$csrf" -UseBasicParsing -WebSession $sess -MaximumRedirection 5
Write-Host "Login completed"

# Pages list
$pages = @(
    @{Path="/"; Name="dashboard"},
    @{Path="/env"; Name="environments"},
    @{Path="/inbox"; Name="inbox"},
    @{Path="/seo"; Name="seo"},
    @{Path="/video"; Name="video"},
    @{Path="/workflow"; Name="workflow"},
    @{Path="/deals"; Name="trade"},
    @{Path="/matrix"; Name="matrix"},
    @{Path="/environments"; Name="environments2"},
    @{Path="/settings"; Name="settings"},
    @{Path="/ai"; Name="ai"},
    @{Path="/ai-command"; Name="ai-command"},
    @{Path="/marketing"; Name="marketing"},
    @{Path="/social"; Name="social"},
    @{Path="/analytics"; Name="analytics"}
)

Write-Host "`nStarting page tests..."
$results = @()

foreach ($page in $pages) {
    try {
        $url = "http://localhost:3001" + $page.Path
        Write-Host "Testing: $($page.Name) ($url)"
        
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -WebSession $sess
        $sizeKB = [Math]::Round($response.RawContentLength / 1KB, 2)
        
        # Check for issues
        $issues = @()
        if ($response.StatusCode -ne 200) {
            $issues += "HTTP $($response.StatusCode)"
        }
        if ($sizeKB -lt 5) {
            $issues += "Page too small($sizeKB KB)"
        }
        if ($response.Content -match "ReferenceError|is not defined|Cannot read|EJS Error") {
            $issues += "EJS Error"
        }
        
        $result = if ($issues.Count -eq 0) { "PASS" } else { "WARNING" }
        
        $results += [PSCustomObject]@{
            Page = $page.Name
            URL = $page.Path
            StatusCode = $response.StatusCode
            Size = "$sizeKB KB"
            Result = $result
            Issues = ($issues -join ", ")
        }
        
        Start-Sleep -Milliseconds 100
        
    } catch {
        $results += [PSCustomObject]@{
            Page = $page.Name
            URL = $page.Path
            StatusCode = "ERROR"
            Size = "N/A"
            Result = "FAIL"
            Issues = $_.Exception.Message
        }
    }
}

Write-Host "`nTest Results:"
$results | Format-Table -AutoSize

# Save results
$results | Export-Csv -Path "D:\VIPB-AI-System\page-test-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "Results saved to CSV file"