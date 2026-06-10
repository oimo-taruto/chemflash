# ChemFlash dev static file server (no deps, PowerShell only, concurrent)
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 4173]
param([int]$Port = 4173)

$root = $PSScriptRoot

# Handles a single request; each request runs in its own runspace.
$handler = {
  param($ctx, $root)
  $mime = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.js' = 'application/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.csv' = 'text/csv; charset=utf-8'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json'
  }
  try {
    $ctx.Response.KeepAlive = $false
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $root ($path -replace '/', '\')
    $full = [System.IO.Path]::GetFullPath($file)
    $isHead = $ctx.Request.HttpMethod -eq 'HEAD'
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
      $ctx.Response.ContentType = $type
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      if (-not $isHead) { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $ctx.Response.ContentLength64 = $msg.Length
      if (-not $isHead) { $ctx.Response.OutputStream.Write($msg, 0, $msg.Length) }
    }
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
  } finally {
    try { $ctx.Response.Close() } catch {}
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "ChemFlash dev server: http://localhost:$Port/  (root: $root)"

# Runspace pool so concurrent connections (e.g. screenshot + page) never block each other.
$pool = [runspacefactory]::CreateRunspacePool(1, 8)
$pool.Open()
$active = New-Object System.Collections.ArrayList

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($ctx).AddArgument($root)
    $async = $ps.BeginInvoke()
    [void]$active.Add(@{ ps = $ps; async = $async })
    for ($i = $active.Count - 1; $i -ge 0; $i--) {
      if ($active[$i].async.IsCompleted) {
        try { $active[$i].ps.EndInvoke($active[$i].async) } catch {}
        $active[$i].ps.Dispose()
        $active.RemoveAt($i)
      }
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
