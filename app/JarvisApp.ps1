# J.A.R.V.I.S. Desktop Application (System Tray + Managed Core + Chrome App Window)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$appDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir    = Split-Path -Parent $appDir
$backendDir = Join-Path $rootDir "Backend"
$iconPath   = Join-Path $appDir "jarvis.ico"
$logPath    = Join-Path $appDir "jarvis.log"
$baseUrl    = "http://localhost:3001"

function Find-Chrome {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

function Open-JarvisWindow {
    $chrome = Find-Chrome
    if ($chrome) {
        Start-Process -FilePath $chrome -ArgumentList "--app=$baseUrl --window-size=1440,900"
    } else {
        Start-Process $baseUrl
    }
}

function Test-CoreHealthy {
    try {
        $req = [System.Net.WebRequest]::Create("$baseUrl/health")
        $req.Timeout = 1000
        $resp = $req.GetResponse()
        $ok = ($resp.StatusCode -eq [System.Net.HttpStatusCode]::OK)
        $resp.Close()
        return $ok
    } catch {
        return $false
    }
}

$script:backendProc = $null

function Start-JarvisCore {
    if (Test-CoreHealthy) { return $true }

    $nodeExe = "C:\Program Files\nodejs\node.exe"
    if (-not (Test-Path $nodeExe)) { $nodeExe = "node" }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeExe
    $psi.Arguments = "server.js"
    $psi.WorkingDirectory = $backendDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    try {
        $script:backendProc = [System.Diagnostics.Process]::Start($psi)
        # Drain stdout/stderr asynchronously into jarvis.log so buffers never fill
        $script:backendProc.BeginOutputReadLine()
        $script:backendProc.BeginErrorReadLine()
    } catch {
        Set-Content -Path $logPath -Value "Failed to start Node: $_"
        return $false
    }

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-CoreHealthy) { return $true }
        if ($script:backendProc -and $script:backendProc.HasExited) { return $false }
    }
    return $false
}

function Stop-JarvisCore {
    if ($script:backendProc -and -not $script:backendProc.HasExited) {
        try { $script:backendProc.Kill() } catch {}
    }
    $script:backendProc = $null
    Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

# Single-instance check: if already running, just open the window immediately
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\JARVIS_DESKTOP_APP_SARA", [ref]$createdNew)
if (-not $createdNew) {
    Open-JarvisWindow
    exit 0
}

try {
    if (-not (Start-JarvisCore)) {
        [System.Windows.Forms.MessageBox]::Show(
            "J.A.R.V.I.S. core could not start, Ma'am.",
            "J.A.R.V.I.S.",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        exit 1
    }

    # System Tray Icon & Menu
    $tray = New-Object System.Windows.Forms.NotifyIcon
    if (Test-Path $iconPath) {
        $tray.Icon = New-Object System.Drawing.Icon($iconPath)
    } else {
        $tray.Icon = [System.Drawing.SystemIcons]::Application
    }
    $tray.Text = "J.A.R.V.I.S. — Online (Click to open)"
    $tray.Visible = $true

    $menu = New-Object System.Windows.Forms.ContextMenuStrip

    $openItem = $menu.Items.Add("Open J.A.R.V.I.S.")
    $openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
    $openItem.Add_Click({ Open-JarvisWindow })

    $restartItem = $menu.Items.Add("Restart Core")
    $restartItem.Add_Click({
        Stop-JarvisCore
        Start-Sleep -Milliseconds 500
        if (Start-JarvisCore) {
            $tray.ShowBalloonTip(2500, "J.A.R.V.I.S.", "Core restarted and online, Ma'am.", [System.Windows.Forms.ToolTipIcon]::Info)
            Open-JarvisWindow
        }
    })

    $menu.Items.Add("-") | Out-Null

    $exitItem = $menu.Items.Add("Exit J.A.R.V.I.S.")
    $exitItem.Add_Click({
        $tray.Visible = $false
        $tray.Dispose()
        Stop-JarvisCore
        [System.Windows.Forms.Application]::Exit()
    })

    $tray.ContextMenuStrip = $menu
    $tray.Add_MouseClick({
        param($sender, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            Open-JarvisWindow
        }
    })

    Open-JarvisWindow
    [System.Windows.Forms.Application]::Run()
} finally {
    Stop-JarvisCore
    $mutex.ReleaseMutex() | Out-Null
    $mutex.Dispose()
}
