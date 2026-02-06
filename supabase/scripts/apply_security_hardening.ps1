param(
  [string]$ProjectRef = "",
  [string]$AccessToken = ""
)

$ErrorActionPreference = 'Stop'

function Exec($label, [scriptblock]$cmd) {
  WriteStep $label
  & $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($label) with exit code $LASTEXITCODE"
  }
}

function WriteStep($msg) {
  Write-Host "\n=== $msg ===\n" -ForegroundColor Cyan
}

WriteStep "Checking Supabase CLI"
$null = (Get-Command supabase -ErrorAction Stop)

if ($AccessToken) {
  WriteStep "Setting SUPABASE_ACCESS_TOKEN for this session"
  $env:SUPABASE_ACCESS_TOKEN = $AccessToken
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  WriteStep "Missing SUPABASE_ACCESS_TOKEN"
  throw (
    "Set `$env:SUPABASE_ACCESS_TOKEN in this PowerShell session (do not commit tokens to the repo), then rerun. " +
    "Example: `$env:SUPABASE_ACCESS_TOKEN='sbp_...'; .\\supabase\\scripts\\apply_security_hardening.ps1"
  )
}

if (-not $ProjectRef) {
  WriteStep "Missing ProjectRef"
  throw (
    "Pass your Supabase project ref explicitly. Example: " +
    ".\\supabase\\scripts\\apply_security_hardening.ps1 -ProjectRef 'YOUR_PROJECT_REF'"
  )
}

$ProjectRef = $ProjectRef.Trim()
if ($ProjectRef -notmatch '^[a-z0-9]{20}$') {
  WriteStep "Invalid ProjectRef"
  throw (
    "Invalid project ref format. It should be a 20-char lowercase string (e.g. 'yxrmfzxxzswjcixmhcql'). " +
    "Copy it from Supabase Dashboard (Project Settings → General)."
  )
}

$env:SUPABASE_ACCESS_TOKEN = $env:SUPABASE_ACCESS_TOKEN.Trim()
if ($env:SUPABASE_ACCESS_TOKEN -notmatch '^sbp_[A-Za-z0-9]+$') {
  WriteStep "Invalid SUPABASE_ACCESS_TOKEN"
  throw (
    "Invalid access token format. SUPABASE_ACCESS_TOKEN must be a Supabase Personal Access Token that starts with 'sbp_'. " +
    "(This is NOT your project anon key, service role key, or a JWT.) " +
    "Re-copy it from Supabase Dashboard → Account → Access Tokens, then run: " +
    "`$env:SUPABASE_ACCESS_TOKEN='sbp_...'; .\\supabase\\scripts\\apply_security_hardening.ps1"
  )
}

WriteStep "Checking Supabase login"
supabase projects list | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw (
    "Supabase CLI not authenticated. This environment can't complete the interactive 'supabase login' prompt. " +
    "Create an access token in Supabase Dashboard (Account → Access Tokens), then run: " +
    "`$env:SUPABASE_ACCESS_TOKEN='YOUR_TOKEN'; .\\supabase\\scripts\\apply_security_hardening.ps1"
  )
}

Exec "Linking project ($ProjectRef)" { supabase link --project-ref $ProjectRef }

Exec "Pushing migrations (will apply 20260205_security_hardening.sql)" { supabase db push }

WriteStep "Done"
Write-Host "Security hardening migration pushed. Re-run your pg_policies/pg_proc checks to confirm." -ForegroundColor Green
