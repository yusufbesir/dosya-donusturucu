; electron-builder (26.15.3) NSIS ek betiği (package.json build.nsis.include).
;
; Doğrulanan kullanım: node_modules/app-builder-lib/templates/nsis/uninstaller.nsh
; içinde "!ifmacrodef customRemoveFiles / !insertmacro customRemoveFiles" bulunur;
; makro tanımlıysa varsayılan dosya silme bloğunun (atomicRMDir + "RMDir /r $INSTDIR")
; yerine YALNIZ bu makro çalışır. Bu yüzden normal kaldırma davranışı burada yeniden yazılır.
;
; Güncelleme (${isUpdated}): yeni kurulum eski kaldırıcıyı çağırdığında HİÇBİR dosya silinmez;
; yeni dosyalar eskilerin üzerine yazılır. Eski sürümden artakalan dosyaları, yeni sürüm
; doğrulandıktan sonra uygulamanın kendisi (src/guncelleme.js) manifestle temizler.
;
; Normal kaldırma: "RMDir /r $INSTDIR" KULLANILMAZ (kullanıcı kurulum klasörünü yanlışlıkla
; belgelerinin olduğu bir klasör seçmişse hepsi silinirdi). Bunun yerine paketleme sırasında
; scripts/manifest-uret.js'in ürettiği resources\surum-dosyalar.txt okunur (satırlar "F|göreli\yol"
; ve "D|göreli\klasör"; önce dosyalar, sonra klasörler en derinden başlayarak). Dosyalar tek tek
; Delete ile, klasörler özyinelemesiz RMDir ile (yalnız boşsa) kaldırılır; kullanıcının aynı
; klasöre koyduğu dosyalar ve onları barındıran klasörler kalır. Çalıştırılabilir dosya yoksa ya da
; $INSTDIR bir sürücü köküyse (X:\) hiçbir şey silinmez.

!include LogicLib.nsh

!ifdef BUILD_UNINSTALLER
; Yığından göreli yolu alır, güvenliyse "1" değilse "0" bırakır.
; Reddedilenler: boş/çok uzun, "\" ile başlayan, ":" "/" "*" "?" "<" ">" "|" '"' içeren, ".." ya da "\\" içeren yollar.
Function un.DDYolGuvenli
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrLen $R1 $R0
  StrCpy $R5 "0"
  ${If} $R1 > 0
  ${AndIf} $R1 < 900
    StrCpy $R3 $R0 1
    ${If} $R3 != "\"
      StrCpy $R5 "1"
      StrCpy $R4 ""
      StrCpy $R2 0
      ${While} $R2 < $R1
        StrCpy $R3 $R0 1 $R2
        ${If} $R3 == ":"
        ${OrIf} $R3 == "/"
        ${OrIf} $R3 == "*"
        ${OrIf} $R3 == "?"
        ${OrIf} $R3 == "<"
        ${OrIf} $R3 == ">"
        ${OrIf} $R3 == "|"
        ${OrIf} $R3 == '"'
          StrCpy $R5 "0"
        ${EndIf}
        ${If} $R3 == "."
        ${AndIf} $R4 == "."
          StrCpy $R5 "0"
        ${EndIf}
        ${If} $R3 == "\"
        ${AndIf} $R4 == "\"
          StrCpy $R5 "0"
        ${EndIf}
        StrCpy $R4 $R3
        IntOp $R2 $R2 + 1
      ${EndWhile}
    ${EndIf}
  ${EndIf}
  StrCpy $R0 $R5
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
!endif

!macro customRemoveFiles
  ${if} ${isUpdated}
    DetailPrint "Güncelleme: eski dosyalar silinmiyor, üzerine yazılacak."
  ${else}
    ; $INSTDIR çalışma klasörü olmamalı
    SetOutPath $TEMP

    ; Koruma 1: sürücü kökü (X:\ ya da daha kısası) ya da boş yol
    StrLen $R0 $INSTDIR
    ${If} $R0 <= 3
      DetailPrint "Kurulum klasörü sürücü kökü ya da boş: hiçbir şey silinmiyor."
      Goto ddKaldirmaBitti
    ${EndIf}
    ; Koruma 2: ana çalıştırılabilir dosya yoksa bu bizim kurulumumuz değildir
    ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "${APP_EXECUTABLE_FILENAME} bulunamadı: hiçbir şey silinmiyor."
      Goto ddKaldirmaBitti
    ${EndIf}

    ; Liste UTF-16LE (BOM'lu), ilk satır "H|..." başlığı; kendini de içerir; açık dosya silinemeyeceğinden geçici kopyadan okunur
    InitPluginsDir
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\resources\surum-dosyalar.txt" "$PLUGINSDIR\surum-dosyalar.txt"
    ${IfNot} ${Errors}
      FileOpen $R1 "$PLUGINSDIR\surum-dosyalar.txt" r
      ${IfNot} ${Errors}
        ${Do}
          ClearErrors
          FileReadUTF16LE $R1 $R2
          ${If} ${Errors}
            ${Break}
          ${EndIf}
          ; satır sonu (CR/LF) kırp
          ${Do}
            StrCpy $R3 $R2 1 -1
            ${If} $R3 == "$\r"
            ${OrIf} $R3 == "$\n"
              StrCpy $R2 $R2 -1
            ${Else}
              ${Break}
            ${EndIf}
          ${Loop}
          StrCpy $R3 $R2 1       ; tür: F ya da D
          StrCpy $R4 $R2 1 1     ; ayraç
          StrCpy $R5 $R2 "" 2    ; göreli yol
          ${If} $R4 == "|"
            Push $R5
            Call un.DDYolGuvenli
            Pop $R6
            ${If} $R6 == "1"
              ${If} $R3 == "F"
                Delete "$INSTDIR\$R5"
              ${ElseIf} $R3 == "D"
                RMDir "$INSTDIR\$R5"
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${Loop}
        FileClose $R1
      ${EndIf}
    ${EndIf}

    ; Çalışma zamanında uygulamanın yazdığı bilinen dosyalar
    Delete "$INSTDIR\.surum\onceki-manifest.json"
    Delete "$INSTDIR\.surum\onceki-manifest.json.*.tmp"
    Delete "$INSTDIR\.surum\temizlik-gunlugu.txt"
    RMDir "$INSTDIR\.surum"
    ; Kaldırıcının kendisi, sonra (özyinelemesiz, yalnız boşsa) kurulum klasörü
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    RMDir "$INSTDIR"
    ddKaldirmaBitti:
  ${endif}
!macroend
