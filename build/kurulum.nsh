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
; Bağ/junction: GetFileAttributesW ile FILE_ATTRIBUTE_REPARSE_POINT (0x400) denetlenir; $INSTDIR, listedeki
; her öğenin üst klasör zinciri ve öğenin kendisi reparse point ise (ya da öznitelik -1 ise) o öğe silinmez.

!include LogicLib.nsh

; Paketleme sırasında scripts/manifest-uret.js (afterPack; NSIS derlemesinden ÖNCE çalışır) bu dosyayı
; üretir: !define DD_LISTE_SHA256 "<surum-dosyalar.txt SHA-256, küçük harf hex>". Dosya yoksa derleme
; başarısız olur (listesi doğrulanamayan kaldırıcı üretilmez). Include dizini: build/ (buildResources).
!include "uretilen/liste-sha.nsh"

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
  ${If} $R5 == "1"
    Push $R0
    Call un.DDAdlarGuvenli
    Pop $R5
  ${EndIf}
  StrCpy $R0 $R5
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; Yığından tek bir yol bileşenini alır; Windows ayrılmış adıysa (CON PRN AUX NUL COM1-9 LPT1-9, uzantılı da
; olabilir: "con.txt") "1", değilse "0" bırakır. NSIS "==" büyük/küçük harf duyarsızdır.
Function un.DDAdAyrilmisMi
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrLen $R1 $R0
  StrCpy $R2 0
  ${While} $R2 < $R1
    StrCpy $R3 $R0 1 $R2
    ${If} $R3 == "."
      ${Break}
    ${EndIf}
    IntOp $R2 $R2 + 1
  ${EndWhile}
  StrCpy $R0 $R0 $R2        ; ilk noktaya kadar
  ${Do}                      ; sondaki boşlukları at
    StrCpy $R3 $R0 1 -1
    ${If} $R3 == " "
      StrCpy $R0 $R0 -1
    ${Else}
      ${Break}
    ${EndIf}
  ${Loop}
  StrCpy $R1 "0"
  ${If} $R0 == "CON"
  ${OrIf} $R0 == "PRN"
  ${OrIf} $R0 == "AUX"
  ${OrIf} $R0 == "NUL"
    StrCpy $R1 "1"
  ${EndIf}
  StrLen $R2 $R0
  ${If} $R2 == 4
    StrCpy $R3 $R0 3
    ${If} $R3 == "COM"
    ${OrIf} $R3 == "LPT"
      StrCpy $R3 $R0 1 3
      ${If} $R3 >= 1
      ${AndIf} $R3 <= 9
        StrCpy $R1 "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $R0 $R1
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; Yığından göreli yolu alır; hiçbir bileşeni ayrılmış ad değilse "1", aksi halde "0" bırakır.
Function un.DDAdlarGuvenli
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrCpy $R5 "1"
  StrCpy $R4 ""              ; biriken bileşen
  StrLen $R1 $R0
  StrCpy $R2 0
  ${While} $R2 <= $R1
    StrCpy $R3 $R0 1 $R2     ; $R2 == uzunluk iken boş döner: son bileşeni kapatır
    ${If} $R3 == "\"
    ${OrIf} $R3 == ""
      Push $R4
      Call un.DDAdAyrilmisMi
      Pop $R3
      ${If} $R3 == "1"
        StrCpy $R5 "0"
      ${EndIf}
      StrCpy $R4 ""
    ${Else}
      StrCpy $R4 "$R4$R3"
    ${EndIf}
    IntOp $R2 $R2 + 1
  ${EndWhile}
  StrCpy $R0 $R5
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; Yığından dosya yolunu alır; certutil ile SHA-256'sını hesaplar, DD_LISTE_SHA256 ile eşleşirse "1", eşleşmez
; ya da certutil başarısız olursa "0" bırakır. Çıktıdan, boşlukları atılmış 64 hex satırı aranır.
Function un.DDListeDogruMu
  Exch $R0
  Push $0
  Push $1
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R4 "0"
  nsExec::ExecToStack '"$SYSDIR\certutil.exe" -hashfile "$R0" SHA256'
  Pop $0
  Pop $1
  ${If} $0 == 0
    StrLen $R1 $1
    StrCpy $R2 0
    StrCpy $R3 ""
    ${While} $R2 <= $R1
      StrCpy $0 $1 1 $R2
      ${If} $0 == "$\n"
      ${OrIf} $0 == ""
        ${If} $R3 == "${DD_LISTE_SHA256}"   ; "==" harf duyarsız; beklenen değer zaten küçük harf
          StrCpy $R4 "1"
        ${EndIf}
        StrCpy $R3 ""
      ${ElseIf} $0 != "$\r"
      ${AndIf} $0 != " "
      ${AndIf} $0 != "$\t"
        StrCpy $R3 "$R3$0"
      ${EndIf}
      IntOp $R2 $R2 + 1
    ${EndWhile}
  ${EndIf}
  StrCpy $R0 $R4
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $1
  Pop $0
  Exch $R0
FunctionEnd

; Yığından tam yolu alır; "1" = DOKUNMA (reparse point/junction/sembolik bağ ya da öznitelik okunamadı/yok), "0" = normal.
; FILE_ATTRIBUTE_REPARSE_POINT = 0x400; INVALID_FILE_ATTRIBUTES = -1.
Function un.DDDokunulmazMi
  Exch $R0
  Push $0
  Push $1
  System::Call 'kernel32::GetFileAttributesW(w "$R0") i .r0'
  ${If} $0 == -1
    StrCpy $R0 "1"
  ${Else}
    IntOp $1 $0 & 0x400
    ${If} $1 != 0
      StrCpy $R0 "1"
    ${Else}
      StrCpy $R0 "0"
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
  Exch $R0
FunctionEnd

; Yığından $INSTDIR'e göreli yolu alır; yolun tüm üst klasör zincirini ve öğenin kendisini denetler.
; Hiçbiri bağ/junction değilse ve hepsi varsa "1" (güvenli), aksi halde "0" bırakır.
Function un.DDZincirGuvenli
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R4 "1"
  StrLen $R1 $R0
  StrCpy $R2 0
  ${While} $R2 < $R1
    StrCpy $R3 $R0 1 $R2
    ${If} $R3 == "\"
      StrCpy $R3 $R0 $R2
      Push "$INSTDIR\$R3"
      Call un.DDDokunulmazMi
      Pop $R3
      ${If} $R3 != "0"
        StrCpy $R4 "0"
      ${EndIf}
    ${EndIf}
    IntOp $R2 $R2 + 1
  ${EndWhile}
  Push "$INSTDIR\$R0"
  Call un.DDDokunulmazMi
  Pop $R3
  ${If} $R3 != "0"
    StrCpy $R4 "0"
  ${EndIf}
  StrCpy $R0 $R4
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
!endif

; Kurulum yalnız kullanıcı başınadır: "tüm kullanıcılar için" seçim sayfası atlanır
; (multiUserUi.nsh içindeki "customInstallMode" kancası; hem kurucu hem kaldırıcıda çalışır).
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

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

    ; Koruma 3: $INSTDIR'in kendisi bağ/junction (reparse point) ise hiçbir şey silinmez
    Push "$INSTDIR"
    Call un.DDDokunulmazMi
    Pop $R0
    ${If} $R0 != "0"
      DetailPrint "Kurulum klasörü bağ/junction ya da okunamıyor: hiçbir şey silinmiyor."
      Goto ddKaldirmaBitti
    ${EndIf}

    ; Liste UTF-16LE (BOM'lu), ilk satır "H|..." başlığı; kendini de içerir; açık dosya silinemeyeceğinden geçici kopyadan okunur
    InitPluginsDir
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\resources\surum-dosyalar.txt" "$PLUGINSDIR\surum-dosyalar.txt"
    ${If} ${Errors}
      DetailPrint "Dosya listesi okunamadı: hiçbir şey silinmiyor."
      Goto ddKaldirmaBitti
    ${EndIf}
    ; Liste bütünlüğü: kopyanın SHA-256'sı paketleme sırasında gömülen değerle eşleşmiyorsa (ya da hesaplanamazsa) hiçbir şey silinmez
    Push "$PLUGINSDIR\surum-dosyalar.txt"
    Call un.DDListeDogruMu
    Pop $R0
    ${If} $R0 != "1"
      DetailPrint "Dosya listesi doğrulanamadı (SHA-256): hiçbir şey silinmiyor."
      Goto ddKaldirmaBitti
    ${EndIf}
    ClearErrors
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
              ; üst klasör zinciri ve öğenin kendisi bağ/junction (reparse point) ise dokunma
              Push $R5
              Call un.DDZincirGuvenli
              Pop $R6
              ${If} $R6 == "1"
                ${If} $R3 == "F"
                  Delete "$INSTDIR\$R5"
                ${ElseIf} $R3 == "D"
                  RMDir "$INSTDIR\$R5"
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${Loop}
        FileClose $R1
      ${EndIf}
    ${EndIf}

    ; Çalışma zamanında uygulamanın yazdığı bilinen dosyalar
    ; (.surum bağ/junction ise dokunulmaz)
    Push ".surum"
    Call un.DDZincirGuvenli
    Pop $R6
    ${If} $R6 == "1"
      Delete "$INSTDIR\.surum\onceki-manifest.json"
      Delete "$INSTDIR\.surum\onceki-manifest.json.*.tmp"
      Delete "$INSTDIR\.surum\temizlik-gunlugu.txt"
      RMDir "$INSTDIR\.surum"
    ${EndIf}
    ; Kaldırıcının kendisi, sonra (özyinelemesiz, yalnız boşsa) kurulum klasörü
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    RMDir "$INSTDIR"
    ddKaldirmaBitti:
  ${endif}
!macroend
