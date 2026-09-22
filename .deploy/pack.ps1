# Builds deploy.zip for a manual upload through the Hostinger File Manager.
#
# The GitHub Actions deploy assembles the same tree; this is that tree in a
# single archive, because uploading laravel/vendor file-by-file over FTP is
# thousands of files and one interrupted transfer away from a broken site.
#
# Extract the archive at ~/domains/micare.online/ so it lands as:
#   ~/domains/micare.online/laravel/      (beside public_html, not inside it)
#   ~/domains/micare.online/public_html/

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

npm run build
if ($LASTEXITCODE -ne 0) { throw 'client build failed' }

$upload = Join-Path $root 'upload'
$zip = Join-Path $root 'deploy.zip'
Remove-Item $upload, $zip -Recurse -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Path "$upload\public_html", "$upload\laravel" | Out-Null

Copy-Item 'dist\public\*' "$upload\public_html\" -Recurse
Copy-Item '.deploy\api-index.php' "$upload\public_html\api-index.php"
Copy-Item '.deploy\public_html.htaccess' "$upload\public_html\.htaccess"

# Everything Laravel needs at runtime. No tests, no fixtures, no .env: that
# file lives on the server, above the document root, and is never uploaded.
foreach ($path in 'app', 'bootstrap', 'config', 'routes', 'storage', 'vendor', 'artisan', 'composer.json', 'composer.lock') {
  Copy-Item "laravel\$path" "$upload\laravel\" -Recurse
}
Remove-Item "$upload\laravel\storage\logs\*.log" -Force -ErrorAction SilentlyContinue

# Entries are written one at a time with forward slashes: CreateFromDirectory
# on Windows PowerShell writes backslashes, and Linux unzip then produces files
# literally named "laravel\app\..." instead of a directory tree.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  foreach ($file in Get-ChildItem $upload -Recurse -File -Force) {
    $name = $file.FullName.Substring($upload.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name)
  }
} finally {
  $archive.Dispose()
}
Remove-Item $upload -Recurse -Force

"{0}  ({1:N0} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)
