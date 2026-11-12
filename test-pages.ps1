if (-not $env:ADMIN_PASSWORD) { Write-Host "请先设置环境变量 ADMIN_PASSWORD（管理员口令）"; exit 1 }
# VIPB-AI-System 页面渲染测试脚本
# 作者：QA测试工程师
# 日期：2026-03-15

$ErrorActionPreference = "Stop"

# 创建会话
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 首先登录获取cookie
Write-Host "正在登录系统..." -ForegroundColor Cyan
$loginPage = Invoke-WebRequest -Uri "http://localhost:3001/login" -UseBasicParsing -WebSession $sess
$csrf = ''
if ($loginPage.Content -match 'name="_csrf"\s+value="([^"]+)"') {
    $csrf = $Matches[1]
    Write-Host "找到CSRF token: $csrf" -ForegroundColor Green
}

$login = Invoke-WebRequest -Uri "http://localhost:3001/login" -Method POST -ContentType "application/x-www-form-urlencoded" -Body "username=admin&password=$env:ADMIN_PASSWORD&_csrf=$csrf" -UseBasicParsing -WebSession $sess -MaximumRedirection 5
Write-Host "登录完成，状态码: $($login.StatusCode)" -ForegroundColor Green

# 要测试的页面列表
$pages = @(
    @{Path = "/"; Name = "dashboard"},
    @{Path = "/env"; Name = "environments"},
    @{Path = "/inbox"; Name = "inbox"},
    @{Path = "/seo"; Name = "seo"},
    @{Path = "/video"; Name = "video"},
    @{Path = "/workflow"; Name = "workflow"},
    @{Path = "/deals"; Name = "trade"},
    @{Path = "/matrix"; Name = "matrix"},
    @{Path = "/environments"; Name = "environments2"},
    @{Path = "/settings"; Name = "settings"},
    @{Path = "/ai"; Name = "ai"},
    @{Path = "/ai-command"; Name = "ai-command"},
    @{Path = "/marketing"; Name = "marketing"},
    @{Path = "/social"; Name = "social"},
    @{Path = "/analytics"; Name = "analytics"}
)

Write-Host "`n开始页面渲染测试..." -ForegroundColor Cyan
Write-Host "=" * 80

$results = @()

foreach ($page in $pages) {
    try {
        Write-Host "测试页面: $($page.Name) ($($page.Path))" -ForegroundColor Yellow
        $response = Invoke-WebRequest -Uri "http://localhost:3001$($page.Path)" -UseBasicParsing -WebSession $sess
        $sizeKB = [Math]::Round($response.RawContentLength / 1KB, 2)
        
        # 检查常见错误
        $hasEjsError = $response.Content -match "ReferenceError|is not defined|Cannot read|EJS Error"
        $isRedirect = $response.StatusCode -eq 302 -or $response.Content -match "Redirecting|302 Found"
        $hasHtmlErrors = $false
        
        # 简单检查HTML结构
        $openTags = [regex]::Matches($response.Content, "<(?!\/)([a-zA-Z]+)").Count
        $closeTags = [regex]::Matches($response.Content, "<\/[a-zA-Z]+>").Count
        if ([Math]::Abs($openTags - $closeTags) > 5) {
            $hasHtmlErrors = $true
        }
        
        $result = "✅ 通过"
        $issues = ""
        
        if ($isRedirect) {
            $result = "🟡 警告"
            $issues = "页面重定向"
        } elseif ($response.StatusCode -ne 200) {
            $result = "❌ 失败"
            $issues = "HTTP $($response.StatusCode)"
        } elseif ($sizeKB -lt 5) {
            $result = "🟡 警告"
            $issues = "页面过小 ($sizeKB KB)"
        } elseif ($hasEjsError) {
            $result = "❌ 失败"
            $issues = "EJS模板错误"
        } elseif ($hasHtmlErrors) {
            $result = "🟡 警告"
            $issues = "HTML标签可能未闭合"
        }
        
        $results += [PSCustomObject]@{
            页面 = $page.Name
            URL = $page.Path
            状态码 = $response.StatusCode
            大小 = "$sizeKB KB"
            结果 = $result
            问题 = $issues
        }
        
        Write-Host "  状态码: $($response.StatusCode), 大小: $sizeKB KB, 结果: $result" -ForegroundColor ($result -eq "✅ 通过" ? "Green" : ($result -eq "🟡 警告" ? "Yellow" : "Red"))
        if ($issues) {
            Write-Host "  问题: $issues" -ForegroundColor Magenta
        }
        
        # 休眠一小会儿，避免请求过快
        Start-Sleep -Milliseconds 200
        
    } catch {
        $results += [PSCustomObject]@{
            页面 = $page.Name
            URL = $page.Path
            状态码 = "错误"
            大小 = "N/A"
            结果 = "❌ 失败"
            问题 = $_.Exception.Message
        }
        Write-Host "  错误: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n" + "=" * 80
Write-Host "页面渲染测试完成!" -ForegroundColor Cyan

# 输出结果表
$results | Format-Table -AutoSize

# 保存结果到文件
$results | ConvertTo-Csv -NoTypeInformation | Out-File "D:\VIPB-AI-System\page-test-results.csv" -Encoding UTF8
Write-Host "`n结果已保存到: D:\VIPB-AI-System\page-test-results.csv" -ForegroundColor Green