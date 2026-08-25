; ─── TomiLite NSIS Custom Installer/Uninstaller ───

!include LogicLib.nsh

; Kill running app before install (skip in silent mode to avoid sub-process noise)
; Also kill old TomatoLite.exe and clean up old shortcuts
!macro customInit
  ; Kill running processes before install
  nsExec::ExecToStack 'taskkill /F /IM TomiLite.exe /T'
  nsExec::ExecToStack 'taskkill /F /IM TomatoLite.exe /T'
  Sleep 1500
  ; Remove legacy TomatoLite shortcuts only (pre-rename product name).
  ; IMPORTANT: do NOT delete TomiLite.lnk here — electron-builder owns the
  ; current product's shortcuts, and OTA update mode does not recreate them.
  Delete "$SMPROGRAMS\TomatoLite.lnk"
  Delete "$DESKTOP\TomatoLite.lnk"
!macroend

; No-op in silent mode — electron-builder handles everything
!macro customInstall
!macroend

; Prompt user about data cleanup after uninstall (skip in silent mode)
!macro customUnInstall
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "TomiLite has been uninstalled.$\n$\nDelete all user data? (database, settings, reports, chat history)$\n$\nLocations:$\n  $APPDATA\tomilite$\n  $PROFILE\.tomilite (new)$\n  $PROFILE\.tomatolite (old)" /SD IDNO IDNO skipRemove
    RMDir /r "$APPDATA\tomilite"
    RMDir /r "$PROFILE\.tomilite"
    RMDir /r "$PROFILE\.tomatolite"
    skipRemove:
  ${EndIf}
!macroend
