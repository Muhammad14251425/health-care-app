<#
.SYNOPSIS
    Make the WSL-hosted clinic backend reachable from a phone on the same Wi-Fi.

.DESCRIPTION
    The backend runs inside WSL2, which sits behind a NAT on its own private
    network (172.x). A phone on the Wi-Fi cannot route to that address, so:

        phone ──wifi──> <windows-lan-ip>:8000
                             │  netsh portproxy
                             └──────────────────> <wsl-ip>:8000  (bench)

    Both the Windows Wi-Fi IP (DHCP) and the WSL IP (reassigned on every WSL
    restart) change over time, which is what silently breaks the phone. This
    script re-derives both and repairs:

      1. the netsh portproxy rule
      2. the inbound firewall rule for TCP 8000
      3. mobile/.env  ->  EXPO_PUBLIC_API_URL

.NOTES
    Steps 1 and 2 need an ELEVATED PowerShell. Run this from an admin prompt:

        powershell -ExecutionPolicy Bypass -File scripts\setup-lan-access.ps1

    Without elevation it still reports what is wrong and rewrites .env, so it is
    useful (and safe) unelevated too.
#>

[CmdletBinding()]
param(
    [int]    $Port     = 8000,
    [string] $Distro   = 'Ubuntu-24.04',
    [string] $WslUser  = 'fawwad',
    # Set the Wi-Fi network to Private as well. Off by default: it changes how
    # Windows treats every service on this machine, so it should be a decision,
    # not a side effect.
    [switch] $SetNetworkPrivate
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Bad($msg)  { Write-Host "  FAIL  $msg" -ForegroundColor Red }

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile  = Join-Path $repoRoot 'mobile\.env'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# --------------------------------------------------------------------------- #
Write-Step 'Addresses'

# The Wi-Fi address the phone will dial. Prefer a real Wi-Fi adapter; fall back
# to any non-loopback, non-APIPA, non-WSL address.
$lan = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.InterfaceAlias -notlike '*WSL*' -and
        $_.InterfaceAlias -notlike '*Loopback*'
    } |
    Sort-Object { if ($_.InterfaceAlias -like '*Wi-Fi*') { 0 } else { 1 } } |
    Select-Object -First 1

if (-not $lan) { Write-Bad 'No usable LAN address found. Are you on Wi-Fi?'; exit 1 }
Write-Ok "Windows LAN IP : $($lan.IPAddress)  ($($lan.InterfaceAlias))"

$wslIp = (& wsl -d $Distro -u $WslUser -- bash -lc 'hostname -I' 2>$null).Trim().Split(' ')[0]
if (-not $wslIp) { Write-Bad "Could not read the WSL IP. Is '$Distro' running?"; exit 1 }
Write-Ok "WSL IP         : $wslIp"

# --------------------------------------------------------------------------- #
Write-Step 'Backend is listening inside WSL'

$listening = & wsl -d $Distro -u $WslUser -- bash -lc "ss -tln 2>/dev/null | grep -c ':$Port'"
if ([int]$listening -gt 0) {
    Write-Ok "bench is listening on port $Port"
    # It must bind 0.0.0.0, not 127.0.0.1, or the portproxy has nothing to reach.
    $anyAddr = & wsl -d $Distro -u $WslUser -- bash -lc "ss -tln 2>/dev/null | grep ':$Port' | grep -c '0.0.0.0'"
    if ([int]$anyAddr -eq 0) {
        Write-Warn2 "Bound to loopback only. Start bench with: bench serve --port $Port"
    }
} else {
    Write-Warn2 "Nothing is listening on $Port inside WSL. Start it with:"
    Write-Host  "        wsl -d $Distro -u $WslUser -- bash -lc 'cd ~/projects/clinic-platform/backend/frappe-bench && bench serve --port $Port'"
}

# --------------------------------------------------------------------------- #
Write-Step 'Port forwarding (Windows -> WSL)'

$existing = (& netsh interface portproxy show all) -join "`n"
$needsProxy = $existing -notmatch [regex]::Escape($wslIp)

if (-not $needsProxy) {
    Write-Ok "portproxy already points at $wslIp"
} elseif ($isAdmin) {
    & netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0 2>$null | Out-Null
    & netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 `
        connectport=$Port connectaddress=$wslIp | Out-Null
    Write-Ok "portproxy 0.0.0.0:$Port -> ${wslIp}:$Port"
} else {
    Write-Warn2 "portproxy is stale and this shell is NOT elevated. Run from an admin prompt:"
    Write-Host  "        netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=0.0.0.0"
    Write-Host  "        netsh interface portproxy add v4tov4 listenport=$Port listenaddress=0.0.0.0 connectport=$Port connectaddress=$wslIp"
}

# --------------------------------------------------------------------------- #
Write-Step 'Firewall'

$ruleName = "Clinic Backend $Port (dev)"
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($rule) {
    Write-Ok "inbound rule '$ruleName' exists (enabled: $($rule.Enabled))"
} elseif ($isAdmin) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
    Write-Ok "created inbound rule '$ruleName'"
} else {
    Write-Warn2 "No firewall rule and this shell is NOT elevated. Run from an admin prompt:"
    Write-Host  "        New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any"
}

# A Public network applies the strictest filtering. The rule above is scoped to
# 'Any' so it should still apply, but this is the usual culprit when a phone
# cannot connect while the laptop itself can.
$profileInfo = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -eq $lan.InterfaceAlias }
if ($profileInfo -and $profileInfo.NetworkCategory -eq 'Public') {
    if ($SetNetworkPrivate -and $isAdmin) {
        Set-NetConnectionProfile -InterfaceAlias $lan.InterfaceAlias -NetworkCategory Private
        Write-Ok "network '$($profileInfo.Name)' set to Private"
    } else {
        Write-Warn2 "Wi-Fi '$($profileInfo.Name)' is a PUBLIC network."
        Write-Host  "        Usually still fine (the rule is scoped to Any), but if the phone"
        Write-Host  "        cannot connect, re-run elevated with -SetNetworkPrivate, or:"
        Write-Host  "        Set-NetConnectionProfile -InterfaceAlias '$($lan.InterfaceAlias)' -NetworkCategory Private"
    }
} elseif ($profileInfo) {
    Write-Ok "network '$($profileInfo.Name)' is $($profileInfo.NetworkCategory)"
}

# --------------------------------------------------------------------------- #
Write-Step 'mobile/.env'

$apiUrl = "http://$($lan.IPAddress):$Port"
$header = @"
# Backend base URL for the phone. GENERATED by scripts/setup-lan-access.ps1.
#
# The backend runs inside WSL2, whose private IP the phone cannot reach, so the
# phone talks to this laptop's Wi-Fi address and a netsh portproxy forwards the
# connection into WSL.
#
# Re-run scripts/setup-lan-access.ps1 whenever the Wi-Fi network changes or WSL
# restarts -- both addresses move, and a stale value here is the usual reason
# the app suddenly cannot reach the backend.
"@

Set-Content -Path $envFile -Encoding utf8 -Value "$header`nEXPO_PUBLIC_API_URL=$apiUrl`n"
Write-Ok "EXPO_PUBLIC_API_URL=$apiUrl"

# --------------------------------------------------------------------------- #
Write-Step 'Reachability check'

try {
    $probe = "$apiUrl/api/method/clinic_core.api.v1.public.departments.list_departments"
    $resp = Invoke-WebRequest -Uri $probe -TimeoutSec 8 -UseBasicParsing
    Write-Ok "HTTP $($resp.StatusCode) from $($lan.IPAddress):$Port"
} catch {
    Write-Bad "Could not reach $apiUrl -- $($_.Exception.Message)"
}

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  1. Restart Expo so it picks up the new .env:  npx expo start -c"
Write-Host "  2. Phone and laptop must be on the SAME Wi-Fi."
Write-Host "  3. From the phone's browser, open:  $apiUrl/api/method/ping"
Write-Host "     A JSON reply means the network path is good.`n"
