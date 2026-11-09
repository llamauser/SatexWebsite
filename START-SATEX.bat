@echo off
title SATEX - start
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-demo.ps1" %*
if errorlevel 1 pause
