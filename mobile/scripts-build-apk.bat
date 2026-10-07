@echo off
REM ============================================================
REM  PsychScreen mobile - local APK build
REM    scripts-build-apk.bat                 -> debug apk
REM    scripts-build-apk.bat assembleRelease -> release apk
REM  Output: mobile\android\app\build\outputs\apk\<variant>\
REM
REM  NOTE: Capacitor 7 compiles with Java 21 (source release 21).
REM        JDK 17 is NOT enough - it fails with 'invalid source release: 21'.
REM ============================================================
set "JDK21=C:\aaa\JAVA\jdk-21"
set "JDK17=C:\aaa\JAVA\jdk-17.0.2"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

if exist "%JDK21%\bin\java.exe" (
  set "JAVA_HOME=%JDK21%"
) else if exist "%JDK17%\bin\java.exe" (
  echo [WARN] JDK 21 not found, falling back to JDK 17.
  echo [WARN] Capacitor 7 needs JDK 21 - build will likely fail.
  set "JAVA_HOME=%JDK17%"
) else (
  echo [ERROR] No JDK found. Expected %JDK21% or %JDK17%
  exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo Using JAVA_HOME=%JAVA_HOME%
echo Using ANDROID_HOME=%ANDROID_HOME%

cd /d "%~dp0android"
if "%~1"=="" (
  call gradlew.bat assembleDebug
) else (
  call gradlew.bat %*
)
exit /b %ERRORLEVEL%
