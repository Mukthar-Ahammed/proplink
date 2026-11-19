param(
  [Parameter(Mandatory = $true)]
  [string]$EnvFile
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

function Read-DotEnvFile {
  param([string]$Path)

  $values = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)\s*$') {
      $name = $Matches.name
      $value = $Matches.value.Trim()
      if ($value.Length -ge 2 -and
        (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      } else {
        $value = [regex]::Replace($value, '\s+#.*$', '')
      }
      $values[$name] = $value
    }
  }
  return $values
}

$resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$envValues = Read-DotEnvFile -Path $resolvedEnvFile
$projectRef = $envValues["PROPLINK_STAGING_PROJECT_REF"]
$projectConfigPath = Join-Path $PSScriptRoot "..\config\supabase-projects.json"
$approvedStagingProjectRef = (Get-Content -Raw -LiteralPath $projectConfigPath | ConvertFrom-Json).staging
$supabaseUrl = $envValues["NEXT_PUBLIC_SUPABASE_URL"]
$publishableKey = $envValues["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]

if (-not $projectRef -or -not $supabaseUrl -or -not $publishableKey) {
  throw "Env file must define PROPLINK_STAGING_PROJECT_REF, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
}
Write-Output "Supabase project ref: $projectRef (staging)"
if ($projectRef -ne $approvedStagingProjectRef) {
  throw "Refusing Data API check: project reference is not the approved staging project."
}

$baseUri = [Uri]$supabaseUrl
if (
  $baseUri.Scheme -ne "https" -or
  $baseUri.Host -ne "$projectRef.supabase.co" -or
  $baseUri.Query -or
  $baseUri.Fragment
) {
  throw "Supabase URL does not match the project reference in the selected env file."
}

$requestUri = [UriBuilder]$baseUri
$requestUri.Path = $requestUri.Path.TrimEnd("/") + "/rest/v1/Property"
$requestUri.Query = "select=id&limit=1"

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$httpClient = [System.Net.Http.HttpClient]::new($handler)
$request = [System.Net.Http.HttpRequestMessage]::new(
  [System.Net.Http.HttpMethod]::Get,
  $requestUri.Uri
)
$response = $null
$null = $request.Headers.TryAddWithoutValidation("apikey", $publishableKey)

try {
  $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
  $statusCode = [int]$response.StatusCode

  if ($statusCode -eq 503) {
    Write-Output "PASS: Data API returned HTTP 503; no table data was returned."
    exit 0
  }
  if ($statusCode -eq 200) {
    Write-Error "FAIL: Data API returned HTTP 200. Disable it unless a specific need is justified and approved."
    exit 1
  }

  Write-Error "INCONCLUSIVE: Data API returned HTTP $statusCode; expected HTTP 503."
  exit 2
} finally {
  $request.Dispose()
  if ($response) {
    $response.Dispose()
  }
  $httpClient.Dispose()
}
