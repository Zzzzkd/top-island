@echo off
title Top Island
cd /d "%~dp0"
echo Starting Top Island...
call npm run dev
if errorlevel 1 pause
