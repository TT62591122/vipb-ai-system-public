if (-not $env:ADMIN_PASSWORD) { Write-Host "请先设置环境变量 ADMIN_PASSWORD（管理员口令）"; exit 1 }
# eSIM Functionality Test
$ErrorActionPreference = "Stop"

# Create session
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Login
Write-Host "Logging in..."
$loginPage = Invoke-WebRequest -Uri "http://localhost:3001/login" -UseBasicParsing -WebSession $sess
$csrf = ''
if ($loginPage.Content -match 'name="_csrf".+?value="([^"]+)"') {
    $csrf = $Matches[1]
}

$login = Invoke-WebRequest -Uri "http://localhost:3001/login" -Method POST -ContentType "application/x-www-form-urlencoded" -Body "username=admin&password=$env:ADMIN_PASSWORD&_csrf=$csrf" -UseBasicParsing -WebSession $sess -MaximumRedirection 5
Write-Host "Login completed"

$headers = @{
    "Content-Type" = "application/json"
}

Write-Host "`n=== eSIM FUNCTIONALITY TEST ==="

$esimResults = @()

# 1. Get eSIM providers (GET /api/esim/providers)
try {
    Write-Host "1. Testing GET /api/esim/providers"
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/providers" -Method GET -UseBasicParsing -WebSession $sess
    $data = $response.Content | ConvertFrom-Json
    $providersCount = $data.providers.Count
    Write-Host "   Found $providersCount providers"
    $esimResults += [PSCustomObject]@{
        Test = "GET Providers"
        Result = "PASS"
        Details = "Found $providersCount providers"
    }
} catch {
    $esimResults += [PSCustomObject]@{
        Test = "GET Providers"
        Result = "FAIL"
        Details = $_.Exception.Message
    }
}

# 2. Create a test eSIM provider (POST /api/esim/providers)
try {
    Write-Host "2. Testing POST /api/esim/providers"
    $testProvider = @{
        name = "Test Provider"
        code = "TEST001"
        countries = @("US", "UK")
        config_fields = @(@{name="api_key"; label="API Key"; type="password"})
        website = "https://test.example.com"
    }
    
    $body = $testProvider | ConvertTo-Json
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/providers" -Method POST -Body $body -UseBasicParsing -WebSession $sess -Headers $headers
    $data = $response.Content | ConvertFrom-Json
    $testProviderId = $data.id
    Write-Host "   Created test provider with ID: $testProviderId"
    $esimResults += [PSCustomObject]@{
        Test = "POST Provider"
        Result = "PASS"
        Details = "Created provider ID: $testProviderId"
    }
} catch {
    $esimResults += [PSCustomObject]@{
        Test = "POST Provider"
        Result = "FAIL"
        Details = $_.Exception.Message
    }
    $testProviderId = $null
}

# 3. Add eSIM phone number (POST /api/esim/phones)
$testPhoneId = $null
if ($testProviderId) {
    try {
        Write-Host "3. Testing POST /api/esim/phones"
        $testPhone = @{
            phone_number = "+15551234567"
            esim_provider_id = $testProviderId
            country_code = "US"
            data_plan = "1GB"
            status = "active"
            activation_date = "2026-03-15T10:00:00Z"
        }
        
        $body = $testPhone | ConvertTo-Json
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/phones" -Method POST -Body $body -UseBasicParsing -WebSession $sess -Headers $headers
        $data = $response.Content | ConvertFrom-Json
        $testPhoneId = $data.id
        Write-Host "   Created test phone with ID: $testPhoneId"
        $esimResults += [PSCustomObject]@{
            Test = "POST Phone"
            Result = "PASS"
            Details = "Created phone ID: $testPhoneId"
        }
    } catch {
        $esimResults += [PSCustomObject]@{
            Test = "POST Phone"
            Result = "FAIL"
            Details = $_.Exception.Message
        }
    }
}

# 4. Get phone list (GET /api/esim/phones)
try {
    Write-Host "4. Testing GET /api/esim/phones"
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/phones" -Method GET -UseBasicParsing -WebSession $sess
    $data = $response.Content | ConvertFrom-Json
    $phonesCount = $data.phones.Count
    Write-Host "   Found $phonesCount phones"
    $esimResults += [PSCustomObject]@{
        Test = "GET Phones"
        Result = "PASS"
        Details = "Found $phonesCount phones"
    }
} catch {
    $esimResults += [PSCustomObject]@{
        Test = "GET Phones"
        Result = "FAIL"
        Details = $_.Exception.Message
    }
}

# 5. Set master phone (PUT /api/esim/master-phone)
if ($testPhoneId) {
    try {
        Write-Host "5. Testing PUT /api/esim/master-phone"
        $masterData = @{
            phone_id = $testPhoneId
            is_master = $true
        }
        
        $body = $masterData | ConvertTo-Json
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/master-phone" -Method PUT -Body $body -UseBasicParsing -WebSession $sess -Headers $headers
        $data = $response.Content | ConvertFrom-Json
        Write-Host "   Set phone $testPhoneId as master"
        $esimResults += [PSCustomObject]@{
            Test = "Set Master Phone"
            Result = "PASS"
            Details = "Set phone as master"
        }
    } catch {
        $esimResults += [PSCustomObject]@{
            Test = "Set Master Phone"
            Result = "FAIL"
            Details = $_.Exception.Message
        }
    }
}

# 6. Get master phone (GET /api/esim/master-phone)
try {
    Write-Host "6. Testing GET /api/esim/master-phone"
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/master-phone" -Method GET -UseBasicParsing -WebSession $sess
    $data = $response.Content | ConvertFrom-Json
    Write-Host "   Master phone: $(if ($data.phone) { $data.phone.phone_number } else { 'None' })"
    $esimResults += [PSCustomObject]@{
        Test = "GET Master Phone"
        Result = "PASS"
        Details = "Retrieved master phone"
    }
} catch {
    $esimResults += [PSCustomObject]@{
        Test = "GET Master Phone"
        Result = "FAIL"
        Details = $_.Exception.Message
    }
}

# 7. Get logs (GET /api/esim/logs)
try {
    Write-Host "7. Testing GET /api/esim/logs"
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/logs" -Method GET -UseBasicParsing -WebSession $sess
    $data = $response.Content | ConvertFrom-Json
    $logsCount = $data.logs.Count
    Write-Host "   Found $logsCount logs"
    $esimResults += [PSCustomObject]@{
        Test = "GET Logs"
        Result = "PASS"
        Details = "Found $logsCount logs"
    }
} catch {
    $esimResults += [PSCustomObject]@{
        Test = "GET Logs"
        Result = "FAIL"
        Details = $_.Exception.Message
    }
}

# 8. Delete test phone (DELETE /api/esim/phones/:id)
if ($testPhoneId) {
    try {
        Write-Host "8. Testing DELETE /api/esim/phones/:id"
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/phones/$testPhoneId" -Method DELETE -UseBasicParsing -WebSession $sess
        $data = $response.Content | ConvertFrom-Json
        Write-Host "   Deleted test phone $testPhoneId"
        $esimResults += [PSCustomObject]@{
            Test = "DELETE Phone"
            Result = "PASS"
            Details = "Deleted test phone"
        }
    } catch {
        $esimResults += [PSCustomObject]@{
            Test = "DELETE Phone"
            Result = "FAIL"
            Details = $_.Exception.Message
        }
    }
}

# 9. Delete test provider (DELETE /api/esim/providers/:id)
if ($testProviderId) {
    try {
        Write-Host "9. Testing DELETE /api/esim/providers/:id"
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/esim/providers/$testProviderId" -Method DELETE -UseBasicParsing -WebSession $sess
        $data = $response.Content | ConvertFrom-Json
        Write-Host "   Deleted test provider $testProviderId"
        $esimResults += [PSCustomObject]@{
            Test = "DELETE Provider"
            Result = "PASS"
            Details = "Deleted test provider"
        }
    } catch {
        $esimResults += [PSCustomObject]@{
            Test = "DELETE Provider"
            Result = "FAIL"
            Details = $_.Exception.Message
        }
    }
}

# Display results
Write-Host "`n=== eSIM TEST RESULTS ==="
$esimResults | Format-Table -AutoSize

# Save results
$esimResults | Export-Csv -Path "D:\VIPB-AI-System\esim-test-results.csv" -NoTypeInformation -Encoding UTF8
Write-Host "`nResults saved to esim-test-results.csv"