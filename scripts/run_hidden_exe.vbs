' Abre o Qwen Image 2.1 Desktop (EXECUTAVEL empacotado) sem janela de console.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "Z:\qwen-image-2.1"
' --remote-debugging-port so 127.0.0.1 (diagnostico CDP)
sh.Run """Z:\qwen-image-2.1\app\dist\win-unpacked\Qwen Image 2.1.exe"" --remote-debugging-port=9223 --packaged", 0, False
