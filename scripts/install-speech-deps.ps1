# Cuesta speech setup — installs the optional neural dictation dependencies.
# Cuesta still dictates through built-in Windows Speech if this step is skipped.

$ErrorActionPreference = 'Stop'
$model = if ($env:CUESTA_WHISPER_MODEL) { $env:CUESTA_WHISPER_MODEL } else { 'small.en' }

if ($model -notmatch '^[A-Za-z0-9._/-]+$') {
    throw "CUESTA_WHISPER_MODEL contains unexpected characters: $model"
}

$python = $null
foreach ($candidate in @($env:PYTHON, 'python', 'python3', 'py')) {
    if (-not $candidate) { continue }
    try {
        $major = & $candidate -c "import sys; print(sys.version_info[0])" 2>$null
        if ($LASTEXITCODE -eq 0 -and "$major".Trim() -eq '3') {
            $python = $candidate
            break
        }
    } catch {
        continue
    }
}

if (-not $python) {
    Write-Host "Python 3 was not found." -ForegroundColor Yellow
    Write-Host "Install Python 3.10+ from https://www.python.org/downloads/windows/ (check 'Add python.exe to PATH'),"
    Write-Host "then run 'npm run speech:setup' again. Cuesta keeps working with Windows Speech meanwhile."
    exit 1
}

Write-Host "Using $python" -ForegroundColor Cyan
& $python -m pip install --upgrade faster-whisper sounddevice numpy
if ($LASTEXITCODE -ne 0) {
    throw "pip install failed. Check your network connection and Python installation."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& $python (Join-Path $scriptRoot 'warm_whisper.py') $model
if ($LASTEXITCODE -ne 0) {
    throw "Whisper model warm-up failed."
}

Write-Host ""
Write-Host "Speech setup complete. Restart Cuesta, then press Ctrl+Win to dictate." -ForegroundColor Green
