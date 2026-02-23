param(
  [string]$ProjectRef = "yxrmfzxxzswjcixmhcql",
  [string]$Subject = ""
)

$ErrorActionPreference = "Stop"

function Test-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host "== Supabase Push Setup ==" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"
Write-Host "Project ref: $ProjectRef"

Test-Command supabase
Test-Command npx

# 1) Login (interactive)
Write-Host "\n[1/5] Supabase login (interactive)..." -ForegroundColor Yellow
Write-Host "If a browser window opens, complete the login and return here." -ForegroundColor DarkGray
supabase login

# 2) Link project
Write-Host "\n[2/5] Linking project..." -ForegroundColor Yellow
supabase link --project-ref $ProjectRef

# 3) Apply DB migrations
Write-Host "\n[3/5] Applying migrations (db push)..." -ForegroundColor Yellow
supabase db push

# 4) Generate VAPID keys (stored locally under supabase/.temp and ignored by git)
$vapidFile = Join-Path $repoRoot "supabase\.temp\vapid.json"
if (-not (Test-Path $vapidFile)) {
  Write-Host "\n[4/5] Generating VAPID keys (saved to $vapidFile)..." -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path (Split-Path $vapidFile) | Out-Null
  npx --yes web-push generate-vapid-keys --json | Out-File -Encoding utf8 $vapidFile
} else {
  Write-Host "\n[4/5] Using existing VAPID keys at $vapidFile" -ForegroundColor Yellow
}

$vapidJson = Get-Content $vapidFile -Raw | ConvertFrom-Json
$publicKey = [string]$vapidJson.publicKey
$privateKey = [string]$vapidJson.privateKey

if ([string]::IsNullOrWhiteSpace($publicKey) -or [string]::IsNullOrWhiteSpace($privateKey)) {
  throw "VAPID keys missing/invalid in $vapidFile"
}

if ([string]::IsNullOrWhiteSpace($Subject)) {
  $Subject = Read-Host "VAPID subject (recommended: mailto:you@domain)"
}
if ([string]::IsNullOrWhiteSpace($Subject)) {
  throw "VAPID subject is required (example: mailto:admin@yourdomain.com)"
}

# 5) Set Supabase secrets + deploy function
Write-Host "\n[5/5] Setting Supabase secrets + deploying Edge Function 'push'..." -ForegroundColor Yellow
supabase secrets set WEB_PUSH_VAPID_PUBLIC_KEY="$publicKey" WEB_PUSH_VAPID_PRIVATE_KEY="$privateKey" WEB_PUSH_VAPID_SUBJECT="$Subject"

supabase functions deploy push

# Update local frontend env (public key only)
$envLocal = Join-Path $repoRoot ".env.local"
if (Test-Path $envLocal) {
  $content = Get-Content $envLocal -Raw
  if ($content -match "(?m)^VITE_WEB_PUSH_PUBLIC_KEY=") {
    $content = [regex]::Replace($content, "(?m)^VITE_WEB_PUSH_PUBLIC_KEY=.*$", "VITE_WEB_PUSH_PUBLIC_KEY=`"$publicKey`"")
  } else {
    if (-not $content.EndsWith("`n")) { $content += "`n" }
    $content += "VITE_WEB_PUSH_PUBLIC_KEY=`"$publicKey`"`n"
  }
  Set-Content -Path $envLocal -Value $content -Encoding utf8
  Write-Host "`nUpdated .env.local with VITE_WEB_PUSH_PUBLIC_KEY" -ForegroundColor Green
}
else {
  Write-Host "`nCreate .env.local and add:" -ForegroundColor Green
  Write-Host "VITE_WEB_PUSH_PUBLIC_KEY=`"<public key from supabase/.temp/vapid.json>`"" -ForegroundColor Green
}

Write-Host "`nDone. Restart the dev server after updating env." -ForegroundColor Cyan
