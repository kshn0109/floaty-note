<#
.SYNOPSIS
  Floaty Note MSIX 패키지를 만든다 (Microsoft Store 제출용 · 서명하지 않는다 — Store가 다시 서명한다).

.DESCRIPTION
  1) (-Build) 릴리스 빌드를 돌린다.
  2) src-tauri/icons 의 아이콘을 src-tauri/msix/Assets 로 모으고, 없는 것(Wide310x150·SplashScreen 등)은
     icon.png 에서 투명 캔버스 가운데에 얹어 만든다.
  3) src-tauri/msix/AppxManifest.template.xml 의 {{...}} 를 msix.config.json 값으로 바꾼다.
  4) src-tauri/target/msix/layout 에 'Floaty Note.exe' + Assets + AppxManifest.xml 을 깔고 makeappx pack 한다.

.PARAMETER Build
  릴리스 빌드(npm run tauri build -- --bundles nsis)를 먼저 돌린다.

.PARAMETER AllowPlaceholder
  msix.config.json 에 REPLACE_ME 가 남아 있어도 진행한다(점검용 · 제출 불가).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\msix\make-msix.ps1 -AllowPlaceholder
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$AllowPlaceholder
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

# ---------------------------------------------------------------- 경로
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Resolve-Path (Join-Path $ScriptDir '..\..')
$SrcTauri    = Join-Path $RepoRoot 'src-tauri'
$MsixDir     = Join-Path $SrcTauri 'msix'
$ConfigPath  = Join-Path $MsixDir 'msix.config.json'
$TemplatePath= Join-Path $MsixDir 'AppxManifest.template.xml'
$AssetsDir   = Join-Path $MsixDir 'Assets'
$IconsDir    = Join-Path $SrcTauri 'icons'
$OutRoot     = Join-Path $SrcTauri 'target\msix'
$LayoutDir   = Join-Path $OutRoot 'layout'
$ExePath     = Join-Path $SrcTauri 'target\release\Floaty Note.exe'

function Step($m) { Write-Host "[msix] $m" -ForegroundColor Cyan }
function Fail($m) { throw "[msix] $m" }

# BOM 없는 UTF-8 로 쓴다 (PS5.1 의 -Encoding utf8 은 BOM 을 붙인다).
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-TextNoBom($path, $text) { [IO.File]::WriteAllText($path, $text, $Utf8NoBom) }

# ---------------------------------------------------------------- 1. 빌드
if ($Build) {
    Step '릴리스 빌드'
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
    Push-Location $RepoRoot
    try {
        & npm run tauri build -- --bundles nsis
        if ($LASTEXITCODE -ne 0) { Fail "빌드 실패 (exit $LASTEXITCODE). 앱이 실행 중이면(os error 5) 먼저 닫을 것." }
    } finally { Pop-Location }
}
if (-not (Test-Path $ExePath)) {
    Fail "Floaty Note.exe 가 없다: $ExePath`n    -Build 를 주거나 먼저 릴리스 빌드를 돌릴 것."
}

# ---------------------------------------------------------------- 2. 설정 읽기
if (-not (Test-Path $ConfigPath))   { Fail "설정 파일이 없다: $ConfigPath" }
if (-not (Test-Path $TemplatePath)) { Fail "매니페스트 템플릿이 없다: $TemplatePath" }

$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Cfg($name, $fallback = '') {
    if ($cfg.PSObject.Properties.Name -contains $name -and $null -ne $cfg.$name -and "$($cfg.$name)" -ne '') {
        return "$($cfg.$name)"
    }
    return $fallback
}

$identityName        = Cfg 'identityName'
$publisher           = Cfg 'publisher'
$publisherDisplayName= Cfg 'publisherDisplayName'
$displayName         = Cfg 'displayName' 'Floaty Note'
$description         = Cfg 'description' 'A quiet notepad for Windows.'

# 버전: 설정에 없으면 tauri.conf.json 에서 가져와 4자리(마지막 0)로.
$version = Cfg 'version'
if ($version -eq '') {
    $tauriConf = Get-Content (Join-Path $SrcTauri 'tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $parts = @([string]$tauriConf.version -split '[-+]')[0] -split '\.'
    while ($parts.Count -lt 3) { $parts += '0' }
    $version = '{0}.{1}.{2}.0' -f $parts[0], $parts[1], $parts[2]
}
if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$') { Fail "버전 형식이 4자리가 아니다: $version" }
if (-not $version.EndsWith('.0')) { Fail "Store 는 버전의 마지막 자리가 0 이어야 한다: $version" }

# 언어
$languages = @('ko-KR', 'en-US')
if ($cfg.PSObject.Properties.Name -contains 'languages' -and $cfg.languages) { $languages = @($cfg.languages) }

# 자리표시자 검사
$placeholders = @()
foreach ($pair in @(@('identityName', $identityName), @('publisher', $publisher), @('publisherDisplayName', $publisherDisplayName))) {
    if ($pair[1] -eq '' -or $pair[1] -match 'REPLACE_ME') { $placeholders += $pair[0] }
}
if ($placeholders.Count -gt 0) {
    $list = $placeholders -join ', '
    if (-not $AllowPlaceholder) {
        Fail @"
msix.config.json 의 값이 아직 자리표시자다: $list
    Partner Center > 제품 > 제품 관리 > 제품 ID 에서 다음을 복사해 채울 것:
      identityName         = 패키지/ID 이름 (예: 12345Publisher.FloatyNote)
      publisher            = 패키지 게시자 ID (예: CN=ABCD1234-...)
      publisherDisplayName = 게시자 표시 이름
    점검만 할 거면 -AllowPlaceholder 를 줄 것(이 패키지는 제출할 수 없다).
"@
    }
    # REPLACE_ME 에는 밑줄이 있어 Identity/@Name 패턴([-.A-Za-z0-9]+)에 맞지 않는다.
    # 점검용이므로 스키마에 맞는 더미로 바꿔 끼운다.
    $dummies = @{ identityName = 'Placeholder.FloatyNote'; publisher = 'CN=Test'; publisherDisplayName = 'Test' }
    foreach ($name in $placeholders) {
        switch ($name) {
            'identityName'         { $identityName = $dummies.identityName }
            'publisher'            { $publisher = $dummies.publisher }
            'publisherDisplayName' { $publisherDisplayName = $dummies.publisherDisplayName }
        }
    }
    Write-Warning "[msix] 자리표시자가 남아 있다($list). -AllowPlaceholder 라서 더미 값(Placeholder.FloatyNote / CN=Test / Test)으로 계속한다 — 이 패키지는 Store 에 제출할 수 없다."
}

# ---------------------------------------------------------------- 3. 에셋
# icon.png 를 투명 캔버스 가운데에 contentSize 크기로 얹는다.
function New-Asset($name, $w, $h, $contentSize) {
    $dest = Join-Path $AssetsDir $name
    $bmp  = New-Object System.Drawing.Bitmap @($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g    = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $src = [System.Drawing.Image]::FromFile((Join-Path $IconsDir 'icon.png'))
        try {
            $x = [int](($w - $contentSize) / 2)
            $y = [int](($h - $contentSize) / 2)
            $g.DrawImage($src, $x, $y, $contentSize, $contentSize)
        } finally { $src.Dispose() }
        $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $g.Dispose(); $bmp.Dispose() }
    Write-Host "       만듦  $name (${w}x${h})"
}

Step '에셋 준비'
if (Test-Path $AssetsDir) { Remove-Item $AssetsDir -Recurse -Force }
New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null

# 있는 것은 그대로 복사한다.
$copies = @{
    'Square44x44Logo.png'   = 'Square44x44Logo.png'
    'Square71x71Logo.png'   = 'Square71x71Logo.png'
    'Square150x150Logo.png' = 'Square150x150Logo.png'
    'Square310x310Logo.png' = 'Square310x310Logo.png'
    'StoreLogo.png'         = 'StoreLogo.png'
}
foreach ($name in $copies.Keys) {
    $src = Join-Path $IconsDir $copies[$name]
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $AssetsDir $name) -Force
        Write-Host "       복사  $name"
    } else {
        # 정사각형은 icon.png 에서 꽉 채워 만든다.
        $n = [int](($name -replace '^Square(\d+)x.*$', '$1'))
        New-Asset $name $n $n $n
    }
}

# 없는 것: 와이드 타일 · 스플래시 · 작업 표시줄용 unplated 변형.
New-Asset 'Wide310x150Logo.png' 310 150 135
New-Asset 'SplashScreen.png'    620 300 180
foreach ($s in 16, 24, 32, 48, 256) {
    New-Asset "Square44x44Logo.targetsize-${s}_altform-unplated.png" $s $s $s
}

# ---------------------------------------------------------------- 4. 매니페스트
Step '매니페스트 생성'
$resourceLines = ($languages | ForEach-Object { '    <Resource Language="' + $_ + '" />' }) -join "`r`n"
$manifest = Get-Content $TemplatePath -Raw -Encoding UTF8
$map = @{
    'identityName'         = $identityName
    'publisher'            = $publisher
    'publisherDisplayName' = $publisherDisplayName
    'displayName'          = $displayName
    'description'          = $description
    'version'              = $version
    'resourceLanguages'    = $resourceLines
}
foreach ($k in $map.Keys) { $manifest = $manifest.Replace("{{$k}}", $map[$k]) }
if ($manifest -match '\{\{(\w+)\}\}') { Fail "템플릿에 채우지 못한 자리가 남았다: {{$($Matches[1])}}" }

# ---------------------------------------------------------------- 5. 레이아웃
Step '레이아웃 구성'
if (Test-Path $LayoutDir) { Remove-Item $LayoutDir -Recurse -Force }
New-Item -ItemType Directory -Path $LayoutDir -Force | Out-Null
Copy-Item $ExePath (Join-Path $LayoutDir 'Floaty Note.exe') -Force
Copy-Item $AssetsDir (Join-Path $LayoutDir 'Assets') -Recurse -Force
Write-TextNoBom (Join-Path $LayoutDir 'AppxManifest.xml') $manifest

# ---------------------------------------------------------------- 6. pack
$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { Fail 'makeappx.exe 를 찾지 못했다 (Windows SDK 필요).' }

$outFile = Join-Path $OutRoot "FloatyNote_${version}_x64.msix"
Step "pack → $outFile"
& $makeappx.FullName pack /o /d $LayoutDir /p $outFile
if ($LASTEXITCODE -ne 0) { Fail "makeappx pack 실패 (exit $LASTEXITCODE)" }

$size = (Get-Item $outFile).Length
Write-Host ("[msix] 완료: {0} ({1:N2} MB)" -f $outFile, ($size / 1MB)) -ForegroundColor Green
Write-Host '[msix] 서명하지 않는다 — Microsoft Store 가 제출 후 다시 서명한다.' -ForegroundColor DarkGray
