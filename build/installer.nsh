!macro PreserveRuntimeDirectory NAME
  ${if} ${FileExists} "$INSTDIR\${NAME}\*.*"
    ${ifNot} ${FileExists} "$runtimeBackupDir\${NAME}\*.*"
      ClearErrors
      Rename "$INSTDIR\${NAME}" "$runtimeBackupDir\${NAME}"
      ${if} ${Errors}
        Abort "Unable to preserve $INSTDIR\${NAME} during upgrade."
      ${endif}
    ${endif}
  ${endif}
!macroend

!macro RestoreRuntimeDirectory NAME
  ${if} ${FileExists} "$runtimeBackupDir\${NAME}\*.*"
    RMDir /r "$INSTDIR\${NAME}"
    ClearErrors
    Rename "$runtimeBackupDir\${NAME}" "$INSTDIR\${NAME}"
    ${if} ${Errors}
      Abort "Unable to restore $INSTDIR\${NAME} after upgrade. Preserved data remains in $runtimeBackupDir."
    ${endif}
  ${endif}
!macroend

Var /GLOBAL runtimeBackupDir

!macro customUnInstall
  ${if} ${isUpdated}
    StrCpy $runtimeBackupDir "$INSTDIR.__new-api-manager-runtime"
    CreateDirectory "$runtimeBackupDir"
    !insertmacro PreserveRuntimeDirectory "config"
    !insertmacro PreserveRuntimeDirectory "core"
    !insertmacro PreserveRuntimeDirectory "data"
    !insertmacro PreserveRuntimeDirectory "logs"
    !insertmacro PreserveRuntimeDirectory "backups"
    !insertmacro PreserveRuntimeDirectory "downloads"
  ${endif}
!macroend

!macro customInstall
  StrCpy $runtimeBackupDir "$INSTDIR.__new-api-manager-runtime"
  !insertmacro RestoreRuntimeDirectory "config"
  !insertmacro RestoreRuntimeDirectory "core"
  !insertmacro RestoreRuntimeDirectory "data"
  !insertmacro RestoreRuntimeDirectory "logs"
  !insertmacro RestoreRuntimeDirectory "backups"
  !insertmacro RestoreRuntimeDirectory "downloads"
  RMDir "$runtimeBackupDir"
!macroend
