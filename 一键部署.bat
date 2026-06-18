@echo off
chcp 65001 >nul
title PhyFog Deploy
cd /d "%~dp0"

echo.
echo  PhyFog Deploy - GitHub + rw.udclass.top
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location '%~dp0'; & '.\deploy.ps1' %* }"
set ERR=%ERRORLEVEL%

if %ERR% NEQ 0 (
    echo.
    echo [FAILED] exit code %ERR%
    pause
    exit /b %ERR%
)

echo.
echo [OK] Press any key to close...
pause >nul
