@echo off

chcp 65001 >nul

title PhyFog SSH Key Setup

cd /d "%~dp0"

echo.

echo  One-time SSH key setup for deploy (enter server password once)

echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\setup-ssh-key.ps1" %*

pause

