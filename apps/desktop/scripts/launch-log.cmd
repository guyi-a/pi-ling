@echo off
set LOG=%TEMP%\pi-ling-launch.log
"%LOCALAPPDATA%\Programs\pi-ling\pi-ling.exe" > "%LOG%" 2>&1
