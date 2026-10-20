# Launch UE 5.8 (not registered with Windows) with this PC's cache settings.
#   powershell -File unreal/tools/ue.ps1 <project.uproject> [extra args...]
# Processes started before UE-LocalDataCachePath was set (the Epic launcher, an
# old shell, the Claude app) never see it and put the DDC on C:. This reads the
# user-scope value fresh so the editor, and the Zen server it starts, use D:.
param([Parameter(Mandatory)] [string] $Project, [Parameter(ValueFromRemainingArguments)] [string[]] $Rest)
$ddc = [Environment]::GetEnvironmentVariable('UE-LocalDataCachePath', 'User')
if (-not $ddc) { $ddc = 'D:\UnrealDDC' }
New-Item -ItemType Directory -Force $ddc | Out-Null
${env:UE-LocalDataCachePath} = $ddc       # local DDC; Zen follows it to <ddc>\Zen
${env:UE-ZenDataPath} = Join-Path $ddc 'Zen'
$exe = 'D:\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe'
Start-Process $exe -ArgumentList (@("`"$Project`"") + $Rest)
