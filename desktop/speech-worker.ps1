# Cuesta Resident Continuous Speech & Command Worker
# Keeps System.Speech.Recognition warm in RAM with clean Dictation vs Device Control grammar switching.

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech

$csharpCode = @"
using System;
using System.Text;
using System.Speech.Recognition;

public class CuestaSpeechHost {
    private SpeechRecognitionEngine engine;
    private Grammar metaGrammar;
    private Grammar cmdGrammar;
    private Grammar dictationGrammar;
    private volatile bool shouldStayListening = false;
    private volatile bool isRecognizing = false;
    private volatile bool controlMode = false;
    private long lastLevelEmitTicks = 0;
    private readonly object ioLock = new object();

    private void Emit(string line) {
        lock (ioLock) {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    private string ToB64(string text) {
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(text ?? ""));
    }

    public bool Init() {
        try {
            engine = new SpeechRecognitionEngine();
            engine.SetInputToDefaultAudioDevice();
            engine.BabbleTimeout = TimeSpan.FromSeconds(2);
            engine.InitialSilenceTimeout = TimeSpan.FromSeconds(15);
            engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(420);
            engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(520);

            // 0. Always-on Meta Safety & Mode-Switch Grammar
            Choices metaChoices = new Choices(new string[] {
                "stop dictation", "dictation mode", "control mode", "command mode",
                "pause gestures", "pause all gestures", "resume gestures", "gestures on"
            });
            metaGrammar = new Grammar(new GrammarBuilder(metaChoices));
            metaGrammar.Name = "CuestaMeta";
            metaGrammar.Priority = 20;
            engine.LoadGrammar(metaGrammar);

            // 1. Device Control Grammar (enabled strictly when in Control Mode)
            Choices commands = new Choices(new string[] {
                "left click", "click", "double click", "right click",
                "cursor on", "cursor off", "pointer on", "pointer off",
                "center cursor", "recenter cursor", "reset cursor",
                "scroll down", "scroll up", "scroll left", "scroll right",
                "page down", "page up", "zoom in", "zoom out",
                "switch window", "next window", "close window",
                "minimize window", "maximize window", "snap left", "snap right", "show desktop",
                "volume up", "volume down", "mute", "unmute",
                "undo that", "copy that", "paste that", "escape",
                "select", "next", "previous", "go back",
                "open notepad", "open edge", "open microsoft edge",
                "open calculator", "open vs code", "open visual studio code",
                "open spotify", "open downloads", "open settings",
                "click save", "click cancel", "click submit", "click ok", "click file",
                "click edit", "click view", "click run", "click help", "click next",
                "click close", "click search", "click apply", "click done"
            });
            cmdGrammar = new Grammar(new GrammarBuilder(commands));
            cmdGrammar.Name = "CuestaCommands";
            cmdGrammar.Priority = 10;
            cmdGrammar.Enabled = false; // Start in clean Dictation Mode by default
            engine.LoadGrammar(cmdGrammar);

            // 2. General Free-Form Dictation Grammar
            dictationGrammar = new DictationGrammar();
            dictationGrammar.Name = "CuestaDictation";
            engine.LoadGrammar(dictationGrammar);

            engine.SpeechHypothesized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    Emit("INTERIM_B64:" + ToB64(e.Result.Text));
                }
            };

            engine.SpeechRecognized += (s, e) => {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text)) {
                    string gName = e.Result.Grammar != null ? e.Result.Grammar.Name : "";
                    bool isMeta = gName == "CuestaMeta";
                    bool isCommand = gName == "CuestaCommands";

                    if (isMeta && e.Result.Confidence >= 0.55f) {
                        Emit("CMD_B64:" + ToB64(e.Result.Text));
                    } else if (isCommand && controlMode && e.Result.Confidence >= 0.48f) {
                        Emit("CMD_B64:" + ToB64(e.Result.Text));
                    } else if (!isMeta && !isCommand && e.Result.Confidence >= 0.36f) {
                        Emit("FINAL_B64:" + ToB64(e.Result.Text));
                    }
                }
            };

            engine.AudioLevelUpdated += (s, e) => {
                if (!shouldStayListening) return;
                long now = DateTime.UtcNow.Ticks;
                if (now - lastLevelEmitTicks > 800000) {
                    lastLevelEmitTicks = now;
                    Emit("LEVEL:" + e.AudioLevel);
                }
            };

            engine.RecognizeCompleted += (s, e) => {
                isRecognizing = false;
                if (shouldStayListening && !e.Cancelled) {
                    try {
                        isRecognizing = true;
                        engine.RecognizeAsync(RecognizeMode.Multiple);
                        return;
                    } catch (Exception ex) {
                        shouldStayListening = false;
                        Emit("ERR_B64:" + ToB64(ex.Message));
                    }
                }
                Emit("STATUS:off");
            };

            Emit("READY");
            return true;
        } catch (Exception ex) {
            Emit("ERR_B64:" + ToB64(ex.Message));
            return false;
        }
    }

    public void SetMode(bool isControl) {
        controlMode = isControl;
        if (cmdGrammar != null) {
            try { cmdGrammar.Enabled = isControl; } catch {}
        }
        if (dictationGrammar != null) {
            try { dictationGrammar.Enabled = !isControl; } catch {}
        }
    }

    public void Start() {
        if (engine == null) { Emit("ERR_B64:" + ToB64("Speech engine unavailable on default audio device.")); return; }
        shouldStayListening = true;
        if (!isRecognizing) {
            try {
                isRecognizing = true;
                engine.RecognizeAsync(RecognizeMode.Multiple);
                Emit("STATUS:listening");
            } catch (Exception ex) {
                isRecognizing = false;
                shouldStayListening = false;
                Emit("ERR_B64:" + ToB64(ex.Message));
            }
        } else {
            Emit("STATUS:listening");
        }
    }

    public void Stop() {
        shouldStayListening = false;
        if (engine != null && isRecognizing) {
            try {
                engine.RecognizeAsyncStop();
            } catch {
                Emit("STATUS:off");
            }
        } else {
            Emit("STATUS:off");
        }
    }

    public void Dispose() {
        shouldStayListening = false;
        if (engine != null) {
            try { engine.RecognizeAsyncCancel(); } catch {}
            try { engine.Dispose(); } catch {}
        }
    }
}
"@

try {
    $speechAsm = [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location
    Add-Type -TypeDefinition $csharpCode -Language CSharp -ReferencedAssemblies $speechAsm
} catch {
    $msg = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($_.Exception.Message))
    [Console]::Out.WriteLine("ERR_B64:$msg")
    [Console]::Out.Flush()
    exit 1
}

$speechHost = New-Object CuestaSpeechHost
$ok = $speechHost.Init()
if (-not $ok) { exit 1 }

while ($true) {
    $cmd = [Console]::In.ReadLine()
    if ($null -eq $cmd) { break }
    $cmd = $cmd.Trim().ToUpperInvariant()
    if ($cmd -eq "") { continue }
    if ($cmd -eq "QUIT") { break }
    if ($cmd -eq "START") { $speechHost.Start() }
    elseif ($cmd -eq "STOP") { $speechHost.Stop() }
    elseif ($cmd -eq "MODE:CONTROL") { $speechHost.SetMode($true) }
    elseif ($cmd -eq "MODE:DICTATION") { $speechHost.SetMode($false) }
}

$speechHost.Dispose()
