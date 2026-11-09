@echo off
title SATEX - stop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-demo.ps1"
