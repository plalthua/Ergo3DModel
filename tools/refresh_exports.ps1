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
foreach ($name in 'index.html', 'style.css', 'app.js', 'kinematics.js', 'model.js', 'imported-car.js') {
    Copy-Item (Join-Path $root "viewer\$name") (Join-Path $desktop "viewer\$name") -Force
}
$desktopIndex = Join-Path $desktop 'viewer\index.html'
$indexText = [IO.File]::ReadAllText($desktopIndex).Replace(
    '<meta name="vehicle-default" content="local-glb" />',
    '<meta name="vehicle-default" content="parametric" />')
[IO.File]::WriteAllText($desktopIndex, $indexText, (New-Object Text.UTF8Encoding $false))
foreach ($name in 'loaders\GLTFLoader.js', 'utils\BufferGeometryUtils.js') {
    $target = Join-Path $desktop "viewer\vendor\addons\$name"
    [void](New-Item (Split-Path $target -Parent) -ItemType Directory -Force)
    Copy-Item (Join-Path $root "viewer\vendor\addons\$name") $target -Force
}
Copy-Item (Join-Path $root 'data\ex60_spec.json') (Join-Path $desktop 'data\ex60_spec.json') -Force
foreach ($file in Get-ChildItem (Join-Path $root 'ergo3d') -Filter '*.py' -File) {
    Copy-Item $file.FullName (Join-Path $desktop "ergo3d\$($file.Name)") -Force
}
Copy-Item (Join-Path $root 'README.md') (Join-Path $desktop 'README.md') -Force
$desktopDocs = Join-Path $desktop 'docs'
[void](New-Item $desktopDocs -ItemType Directory -Force)
Copy-Item (Join-Path $root 'docs\share-drive-connector.md') (Join-Path $desktopDocs 'share-drive-connector.md') -Force
foreach ($folder in 'viewer', 'ergo3d', 'data', 'config') {
    $files = if ($folder -eq 'data') {
        Get-Item (Join-Path $root 'data\ex60_spec.json')
    } elseif ($folder -eq 'config') {
        Get-ChildItem (Join-Path $root $folder) -File -Filter '*.json'
    } else {
        Get-ChildItem (Join-Path $root $folder) -File | Where-Object Extension -in '.py', '.js', '.html', '.css'
    }
    foreach ($file in $files) {
        $target = Join-Path $desktop "$folder\$($file.Name)"
        if ($folder -eq 'config') { Copy-Item $file.FullName $target -Force }
        if ($folder -eq 'viewer' -and $file.Name -eq 'index.html') {
            $expected = [IO.File]::ReadAllText($file.FullName).Replace(
                '<meta name="vehicle-default" content="local-glb" />',
                '<meta name="vehicle-default" content="parametric" />')
            if ([IO.File]::ReadAllText($target) -ne $expected) { throw 'Desktop HTML divergence' }
            continue
        }
        if ((Get-FileHash $file.FullName).Hash -ne (Get-FileHash $target).Hash) {
            throw "Desktop/source divergence: $folder\$($file.Name)"
        }
    }
}

$lines = foreach ($name in 'index.html', 'DEPLOY-AND-SHARE.txt', 'CHANNEL-POST-TEMPLATE.txt') {
    '{0}  {1}' -f (Get-FileHash (Join-Path $teams $name) -Algorithm SHA256).Hash.ToLower(), $name
}
[IO.File]::WriteAllText((Join-Path $teams 'SHA256SUMS.txt'), (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
$lines = foreach ($file in Get-ChildItem $desktop -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' -and $_.FullName -notmatch '\\__pycache__\\' }) {
    '{0}  {1}' -f (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower(), $file.FullName.Substring($desktop.Length + 1).Replace('\', '/')
}
[IO.File]::WriteAllText((Join-Path $desktop 'SHA256SUMS.txt'), (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function New-ExportZip([string]$folder) {
    $zipPath = "$folder.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath }
    $base = Split-Path $folder -Leaf
    $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        foreach ($file in Get-ChildItem $folder -Recurse -File) {
            if ($file.FullName -match '\\__pycache__\\' -or $file.Extension -eq '.pyc') { continue }
            $entry = $base + '/' + $file.FullName.Substring($folder.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, 'Optimal')
        }
    } finally { $zip.Dispose() }
}
New-ExportZip $desktop
New-ExportZip $teams
$lines = foreach ($file in Get-ChildItem $exports -File | Where-Object Extension -in '.zip', '.html') {
    '{0}  {1}' -f (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower(), $file.Name
}
[IO.File]::WriteAllText((Join-Path $exports 'SHA256SUMS.txt'), (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
Get-ChildItem $exports -File | Where-Object Extension -in '.zip', '.html' | Select-Object Name, Length