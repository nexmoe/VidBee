$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Resolve-Path -LiteralPath (Join-Path $ScriptDir '..')
$DistDir = Join-Path $AppDir 'dist'
$PackageJson = Get-Content -LiteralPath (Join-Path $AppDir 'package.json') -Raw | ConvertFrom-Json
$Version = $PackageJson.version
$WinUnpackedDir = Join-Path $DistDir 'win-unpacked'
$PortableDir = Join-Path $DistDir 'VidBee-portable'
$AppOutputDir = Join-Path $PortableDir 'app'
$ZipPath = Join-Path $DistDir "vidbee-$Version-windows-portable.zip"

if (-not (Test-Path -LiteralPath $WinUnpackedDir)) {
  throw "Missing win-unpacked build output: $WinUnpackedDir"
}

Remove-Item -LiteralPath $PortableDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Path $AppOutputDir -Force | Out-Null
Copy-Item -Path (Join-Path $WinUnpackedDir '*') -Destination $AppOutputDir -Recurse -Force

$DataDir = Join-Path $PortableDir 'Data'
$TempDir = Join-Path $PortableDir 'Temp'
$DownloadsDir = Join-Path $PortableDir 'Downloads'
$HomeDir = Join-Path $DataDir 'Home'
$LauncherDirs = @(
  (Join-Path $DataDir 'Roaming'),
  (Join-Path $DataDir 'Local'),
  (Join-Path $DataDir 'UserData'),
  (Join-Path $DataDir 'SessionData'),
  $HomeDir,
  (Join-Path $HomeDir 'Desktop'),
  (Join-Path $HomeDir 'Documents'),
  (Join-Path $HomeDir 'Downloads'),
  (Join-Path $HomeDir 'Music'),
  (Join-Path $HomeDir 'Pictures'),
  (Join-Path $HomeDir 'Videos'),
  (Join-Path $DataDir 'Cache'),
  (Join-Path $DataDir 'Config'),
  (Join-Path $DataDir 'LocalShare'),
  (Join-Path $DataDir 'Deno'),
  $TempDir,
  $DownloadsDir
)

foreach ($dir in $LauncherDirs) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$PowerShellLauncher = @'
$ErrorActionPreference = 'Stop'

$PortableRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $PortableRoot 'app'
$DataDir = Join-Path $PortableRoot 'Data'
$TempDir = Join-Path $PortableRoot 'Temp'
$DownloadsDir = Join-Path $PortableRoot 'Downloads'
$HomeDir = Join-Path $DataDir 'Home'
$ExePath = Join-Path $AppDir 'vidbee.exe'

$paths = @(
    (Join-Path $DataDir 'Roaming'),
    (Join-Path $DataDir 'Local'),
    (Join-Path $DataDir 'UserData'),
    (Join-Path $DataDir 'SessionData'),
    $HomeDir,
    (Join-Path $HomeDir 'Desktop'),
    (Join-Path $HomeDir 'Documents'),
    (Join-Path $HomeDir 'Downloads'),
    (Join-Path $HomeDir 'Music'),
    (Join-Path $HomeDir 'Pictures'),
    (Join-Path $HomeDir 'Videos'),
    (Join-Path $DataDir 'Cache'),
    (Join-Path $DataDir 'Config'),
    (Join-Path $DataDir 'LocalShare'),
    (Join-Path $DataDir 'Deno'),
    $TempDir,
    $DownloadsDir
)

foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$env:APPDATA = Join-Path $DataDir 'Roaming'
$env:LOCALAPPDATA = Join-Path $DataDir 'Local'
$env:USERPROFILE = $HomeDir
$env:HOME = $HomeDir
$env:XDG_CACHE_HOME = Join-Path $DataDir 'Cache'
$env:XDG_CONFIG_HOME = Join-Path $DataDir 'Config'
$env:XDG_DATA_HOME = Join-Path $DataDir 'LocalShare'
$env:DENO_DIR = Join-Path $DataDir 'Deno'
$env:TEMP = $TempDir
$env:TMP = $TempDir
$env:VIDBEE_PORTABLE = '1'
$env:VIDBEE_PORTABLE_DIR = $PortableRoot
$env:NO_UPDATE_NOTIFIER = '1'
$env:SENTRYCLI_SKIP_DOWNLOAD = '1'

$UserDataDir = Join-Path $DataDir 'UserData'
Start-Process -FilePath $ExePath -WorkingDirectory $AppDir -ArgumentList ('--user-data-dir="{0}"' -f $UserDataDir)
'@

$VbsLauncher = @'
Option Explicit

Dim shell, fso, scriptDir, ps1, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(scriptDir, "Start-VidBee-Portable.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps1 & Chr(34)
shell.Run command, 0, False
'@

$Readme = @"
VidBee portable folder
======================

Run VidBee Portable.lnk from this folder.

Do not run app\vidbee.exe directly if you want the app data to stay portable.
The shortcut starts a hidden WSH launcher, which starts a hidden PowerShell
launcher. The launcher redirects APPDATA, LOCALAPPDATA, USERPROFILE, HOME, XDG
paths, DENO_DIR, TEMP, and TMP into this folder, and also passes a local
Chromium --user-data-dir path.

Default download folder:
Downloads

Move this folder only while VidBee is closed. Keep the path reasonably short;
very deep Windows paths can fail when browser profile/cache files exist under
Data.
"@

[System.IO.File]::WriteAllText(
  (Join-Path $PortableDir 'Start-VidBee-Portable.ps1'),
  $PowerShellLauncher,
  [System.Text.UTF8Encoding]::new($false)
)
[System.IO.File]::WriteAllText(
  (Join-Path $PortableDir 'Start-VidBee-Portable.vbs'),
  $VbsLauncher,
  [System.Text.Encoding]::ASCII
)
[System.IO.File]::WriteAllText(
  (Join-Path $PortableDir 'README-portable.txt'),
  $Readme,
  [System.Text.UTF8Encoding]::new($false)
)

$ShellLinkCode = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
public class ShellLink { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
public interface IShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, uint fFlags);
  void GetIDList(out IntPtr ppidl);
  void SetIDList(IntPtr pidl);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
  void GetHotkey(out short pwHotkey);
  void SetHotkey(short wHotkey);
  void GetShowCmd(out int piShowCmd);
  void SetShowCmd(int iShowCmd);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
  void Resolve(IntPtr hwnd, uint fFlags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
public interface IPersistFile {
  void GetClassID(out Guid pClassID);
  void IsDirty();
  void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
  void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
  void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
  void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}

public static class PortableShortcutMaker {
  public static void Create(string linkPath, string targetPath, string workDir, string iconPath) {
    var link = (IShellLinkW)new ShellLink();
    link.SetPath(targetPath);
    link.SetWorkingDirectory(workDir);
    link.SetRelativePath(linkPath, 0);
    link.SetIconLocation(iconPath, 0);
    link.SetDescription("VidBee Portable");
    ((IPersistFile)link).Save(linkPath, true);
  }
}
'@

Add-Type -TypeDefinition $ShellLinkCode
$ShortcutPath = Join-Path $PortableDir 'VidBee Portable.lnk'
$VbsPath = Join-Path $PortableDir 'Start-VidBee-Portable.vbs'
$IconPath = 'app\vidbee.exe'
[PortableShortcutMaker]::Create($ShortcutPath, $VbsPath, $PortableDir, $IconPath)

$RequiredFiles = @(
  'VidBee Portable.lnk',
  'Start-VidBee-Portable.vbs',
  'Start-VidBee-Portable.ps1',
  'README-portable.txt',
  'app\vidbee.exe',
  'app\resources\app.asar'
)

foreach ($relativePath in $RequiredFiles) {
  $candidate = Join-Path $PortableDir $relativePath
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "Missing portable folder file: $relativePath"
  }
}

Compress-Archive -LiteralPath $PortableDir -DestinationPath $ZipPath -CompressionLevel Optimal -Force
Write-Host "Created Windows portable folder archive: $ZipPath"
