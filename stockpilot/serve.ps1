# Serveur HTTP statique minimal (aucune dépendance) pour StockPilot.
# Usage : powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8765]
param([int]$Port = 8765)

$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "StockPilot disponible sur http://localhost:$Port/  (Ctrl+C pour arreter)"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.md'   = 'text/plain; charset=utf-8'
    '.sql'  = 'text/plain; charset=utf-8'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $res = $ctx.Response
        try {
            $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
            if ($path -eq '') { $path = 'index.html' }
            $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $path))

            # Refuse toute tentative de sortir du dossier (../)
            if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($full)) {
                $bytes = [IO.File]::ReadAllBytes($full)
                $ext = [IO.Path]::GetExtension($full).ToLower()
                $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                $res.Headers.Add('Cache-Control', 'no-store')
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = 404
            }
            Write-Host ("{0} /{1} -> {2}" -f $ctx.Request.HttpMethod, $path, $res.StatusCode)
        } catch {
            $res.StatusCode = 500
            Write-Host "Erreur : $_"
        } finally {
            $res.Close()
        }
    }
} finally {
    $listener.Stop()
}
