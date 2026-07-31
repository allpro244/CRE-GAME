@echo off
REM Double-click this to play Broadway & Wall.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 serve.py & goto :eof)
where python >nul 2>nul && (python serve.py & goto :eof)
echo Python 3 is required. Install it from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH" in the installer), then double-click this again.
pause
