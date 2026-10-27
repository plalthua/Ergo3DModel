<#
.SYNOPSIS
Rebuilds the single-file viewer and refreshes both export folders, ZIPs and SHA256SUMS.
Run from anywhere: powershell -File tools\refresh_exports.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exports = Join-Path $root 'exports'
$single = Join-Path $exports 'EX60-3D-Viewer.html'
$desktop = Join-Path $exports 'EX60-3D-Viewer'
$teams = Join-Path $exports 'EX60-Teams-Web'

& python (Join-Path $PSScriptRoot 'build_shareable_html.py') --out $single
if ($LASTEXITCODE) { throw 'build_shareable_html.py failed' }

Copy-Item $single (Join-Path $desktop 'EX60-3D-Viewer.html') -Force
Copy-Item $single (Join-Path $teams 'index.html') -Force
foreach ($name in 'index.html', 'style.css', 'app.js', 'kinematics.js', 'model.js') {
    Copy-Item (Join-Path $root "viewer\$name") (Join-Path $desktop "viewer\$name") -Force
}

$lines = foreach ($name in 'index.html', 'DEPLOY-AND-SHARE.txt', 'CHANNEL-POST-TEMPLATE.txt') {
    '{0}  {1}' -f (Get-FileHash (Join-Path $teams $name) -Algorithm SHA256).Hash.ToLower(), $name
}
[IO.File]::WriteAllText((Join-Path $teams 'SHA256SUMS.txt'), (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function New-ExportZip([string]$folder) {
    $zipPath = "$folder.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath }
    $base = Split-Path $folder -Leaf
    $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        foreach ($file in Get-ChildItem $folder -Recurse -File) {
            $entry = $base + '/' + $file.FullName.Substring($folder.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, 'Optimal')
        }
    } finally { $zip.Dispose() }
}
New-ExportZip $desktop
New-ExportZip $teams
Get-ChildItem $exports -File | Where-Object Extension -in '.zip', '.html' | Select-Object Name, Length