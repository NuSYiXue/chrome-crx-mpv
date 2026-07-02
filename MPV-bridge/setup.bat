@echo off
title MPV Bridge ¹ÜÀí¹¤¾ß
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >NUL 2>&1
cls

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "EXE_FULL=%SCRIPT_DIR%\mpv_bridge.exe"
set "MPV_FULL=%SCRIPT_DIR%\mpv.exe"

echo ================================================
echo    MPV Bridge ¹ÜÀí¹¤¾ß
echo ================================================
echo.
echo   1. ×¢²á mpvreg:// Ğ­Òé
echo   2. ÒÆ³ı mpvreg:// Ğ­Òé
echo   0. ÍË³ö
echo.
set /p choice=ÇëÊäÈëÑ¡Ïî (0/1/2): 

if "%choice%"=="1" goto :register
if "%choice%"=="2" goto :unregister
if "%choice%"=="0" goto :end
echo ÎŞĞ§Ñ¡Ïî
goto :end

:register
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >NUL 2>&1
cls
echo ================================================
echo    ×¢²á mpvreg:// Ğ­Òé
echo ================================================
echo.
echo ´ËĞ­ÒéÓÃÓÚ½« mpv_bridge.exe Óëä¯ÀÀÆ÷¹ØÁª£¬
echo Ê¹µÃÀ©Õ¹ÖĞµã»÷Ò»¼ü×¢²áÊ±ÄÜ×Ô¶¯Íê³Éä¯ÀÀÆ÷×¢²á¡£
echo.
echo ÇëÈ·ÈÏÒÔÏÂÁ½¸öÎÄ¼şÓë mpv.exe ÔÚÍ¬Ò»Ä¿Â¼£º
echo.
if not exist "%MPV_FULL%" (
    echo   mpv.exe          [[31mÎ´ÕÒµ½[0m]
    echo   mpv_bridge.exe
    echo.
    echo [31m========================================[0m
    echo [31m  [´íÎó] µ±Ç°Ä¿Â¼Ã»ÓĞ mpv.exe£¡[0m
    echo [31m========================================[0m
    echo.
    echo   Çë½« setup.bat ºÍ mpv_bridge.exe
    echo   ¸´ÖÆµ½ mpv.exe ËùÔÚÄ¿Â¼ºóÔÙÔËĞĞ¡£
    echo   µ±Ç°Ä¿Â¼: %SCRIPT_DIR%
    goto :pause_end
) else (
    echo [32m  mpv.exe           [OK][0m
)
if not exist "%EXE_FULL%" (
    echo   mpv_bridge.exe    [[31mÎ´ÕÒµ½[0m]
    echo.
    echo [31m========================================[0m
    echo [31m  [´íÎó] ÕÒ²»µ½ mpv_bridge.exe£¡[0m
    echo [31m========================================[0m
    echo.
    echo   Çë½« mpv_bridge.exe ·ÅÔÚ mpv.exe Í¬Ä¿Â¼ÏÂ¡£
    echo   µ±Ç°Ä¿Â¼: %SCRIPT_DIR%
    goto :pause_end
) else (
    echo [32m  mpv_bridge.exe    [OK][0m
)
echo.
echo ========================================
echo [32m  »·¾³¼ì²éÍ¨¹ı£¬¿ªÊ¼×¢²á...[0m
echo ========================================
echo.
echo ÕıÔÚĞ´Èë×¢²á±í...
reg add "HKCU\Software\Classes\mpvreg" /ve /d "URL:MPV Bridge Protocol" /f >NUL 2>&1
reg add "HKCU\Software\Classes\mpvreg" /v "URL Protocol" /d "" /f >NUL 2>&1
reg add "HKCU\Software\Classes\mpvreg\shell\open\command" /ve /d "\"%EXE_FULL%\" --register \"%%1\"" /f >NUL 2>&1

if %errorlevel% neq 0 (
    echo [31m[Ê§°Ü] ×¢²áÊ§°Ü£¬ÇëÓÒ¼ü¹ÜÀíÔ±ÔËĞĞ[0m
    goto :pause_end
)

echo [32m[OK] mpvreg:// Ğ­Òé×¢²á³É¹¦[0m
echo.
echo --------------------------------------------------
echo [32m  ÏÂÒ»²½£ºÔÚä¯ÀÀÆ÷ÖĞÍê³É×¢²á[0m
echo --------------------------------------------------
echo.
echo   1. ´ò¿ª Chrome À©Õ¹µ¯´°
echo   2. ·ÃÎÊ chrome://version£¬¸´ÖÆ¸öÈË×ÊÁÏÂ·¾¶
echo   3. Õ³Ìùµ½µ¯´°£¬µã»÷Ò»¼ü×¢²á
echo.
echo   ÌáÊ¾£ºËùÓĞä¯ÀÀÆ÷×¢²áÍê³Éºó£¬
echo        mpvreg:// Ğ­Òé¾ÍÍê³ÉÁËÊ¹Ãü£¬
echo        ¿ÉÖØĞÂÔËĞĞ±¾½Å±¾Ñ¡ 2 ÒÆ³ı¡£
echo --------------------------------------------------

goto :pause_end

:unregister
cls
echo ================================================
echo    ÒÆ³ı mpvreg:// Ğ­Òé
echo ================================================
echo.
echo   mpvreg:// Ğ­Òé½öÓÃÓÚ³õ´Î×¢²áä¯ÀÀÆ÷¡£
echo   Èç¹ûËùÓĞä¯ÀÀÆ÷¶¼ÒÑ×¢²áÍê³É£¬¿ÉÒÔ°²È«ÒÆ³ı¡£
echo   ÒÆ³ıºó²»Ó°ÏìÒÑ×¢²áä¯ÀÀÆ÷Õı³£Ê¹ÓÃ¡£
echo.
set /p confirm=È·ÈÏÒÆ³ı£¿(y/n): 
if /i not "%confirm%"=="y" (
    echo ÒÑÈ¡Ïû
    goto :pause_end
)

reg delete "HKCU\Software\Classes\mpvreg" /f >NUL 2>&1
if %errorlevel% equ 0 (
    echo [32m[OK] mpvreg:// Ğ­ÒéÒÑÒÆ³ı[0m
) else (
    echo [33m[!] Î´ÕÒµ½×¢²áÏî£¬¿ÉÄÜÒÑ¾­ÒÆ³ı[0m
)

goto :pause_end

:pause_end
echo.
pause

:end
