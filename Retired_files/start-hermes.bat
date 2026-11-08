@echo off
rem Starts Lumen (Ollama + the chatbot web app). Use /nobrowser to skip opening the browser.
setlocal
cd /d "%~dp0"

set "OPENBROWSER=1"
if /i "%~1"=="/nobrowser" set "OPENBROWSER=0"

rem --- Ollama ---
tasklist /fi "imagename eq ollama.exe" | find /i "ollama.exe" >nul
if errorlevel 1 (
    tasklist /fi "imagename eq ollama app.exe" | find /i "ollama app.exe" >nul
    if errorlevel 1 (
        echo Starting Ollama...
        if exist "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe" (
            start "" /min "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
        ) else (
            start "Ollama" /min ollama serve
        )
    ) else (
        echo Ollama is already running.
    )
) else (
    echo Ollama is already running.
)

rem --- Lumen web app on port 8000 ---
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if errorlevel 1 (
    echo Starting Lumen on port 8000...
    start "Lumen" /min py -m uvicorn app.main:app --host 0.0.0.0 --port 8000
    timeout /t 5 /nobreak >nul
) else (
    echo Lumen is already running on port 8000.
)

if "%OPENBROWSER%"=="1" start "" "http://localhost:8000"
endlocal
exit /b 0
