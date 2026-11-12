if (-not $env:ADMIN_PASSWORD) { Write-Host "请先设置环境变量 ADMIN_PASSWORD（管理员口令）"; exit 1 }
# VIPB-AI-System 页面渲染测试脚本（简化版）
$ErrorActionPreference = "Stop"

# 创建会话
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 登录
Write-Host "正在登录系统..."
$loginPage = Invoke-WebRequest -Uri "http://localhost:3001/login" -UseBasicParsing -WebSession $sess
$csrf = ''
if ($loginPage.Content -match 'name="_csrf".+?value="([^"]+)"') {
    $csrf = $Matches[1]
    Write-Host "找到CSRF token: $csrf"
}

$login = Invoke-WebRequest -Uri "http://localhost:3001/login" -Method POST -ContentType "application/x-www-form-urlencoded" -Body "username=admin&password=$env:ADMIN_PASSWORD&_csrf=$csrf" -UseBasicParsing -WebSession $sess -MaximumRedirection 5
Write-Host "登录完成"

# 页面列表
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

Write-Host "`n开始页面测试..."
$results = @()

foreach ($page in $pages) {
    try {
        $url = "http://localhost:3001" + $page.Path
        Write-Host "测试: $($page.Name) ($url)"
        
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -WebSession $sess
        $sizeKB = [Math]::Round($response.RawContentLength / 1KB, 2)
        
        # 检查问题
        $issues = @()
        if ($response.StatusCode -ne 200) {
            $issues += "HTTP $($response.StatusCode)"
        }
        if ($sizeKB -lt 5) {
            $issues += "页面过小($sizeKB KB)"
        }
        if ($response.Content -match "ReferenceError|is not defined|Cannot read|EJS Error") {
            $issues += "EJS错误"
        }
        
        $result = if ($issues.Count -eq 0) { "通过" } else { "警告" }
        
        $results += [PSCustomObject]@{
            页面 = $page.Name
            URL = $page.Path
            状态码 = $response.StatusCode
            大小 = "$sizeKB KB"
            结果 = $result
            问题 = ($issues -join ", ")
        }
        
        Start-Sleep -Milliseconds 100
        
    } catch {
        $results += [PSCustomObject]@{
            页面 = $page.Name
            URL = $page.Path
            状态码 = "错误"
            大小 = "N/A"
            结果 = "失败"
            问题 = $_.Exception.Message
        }
    }
}

Write-Host "`n测试结果:"
$results | Format-Table -AutoSize

# 保存结果
$results | Export-Csv -Path "D:\VIPB-AI-System\page-test-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "结果已保存到CSV文件"