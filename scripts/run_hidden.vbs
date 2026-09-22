' Abre o Qwen Image 2.1 Desktop SEM janela de console.
' (cmd.exe direto na tarefa cria o prompt visivel; wscript Run ...,0 esconde tudo.)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "Z:\qwen-image-2.1"
' --remote-debugging-port: so 127.0.0.1, usado p/ diagnostico (checkwins/cdpcheck)
sh.Run "cmd /c npm start -- --remote-debugging-port=9223 > Z:\qwen-image-2.1\app.log 2>&1", 0, False
