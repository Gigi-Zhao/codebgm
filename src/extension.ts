import * as vscode from 'vscode';
import * as path from 'path';

class MusicPlayerPanel {
    private static readonly viewType = 'codebgmPlayer';
    public static currentPanel: MusicPlayerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _keystrokes: number[] = [];
    private _currentMode: string = 'deep_focus';
    private _lastSwitchTime: number = Date.now();
    private _minDuration: number = 15000; // 最短切换间隔（15秒）
    private _currentAudio: string | undefined;
    private _playlists: { [key: string]: string[] } = {
        'deep_focus': [
            'Team Astro - Better, Together, Forever.mp3',
            '坂本龍一 - aqua.mp3',
        ],
        'energy': [
            'Pianoboy高至豪 - The truth that you leave.mp3'
        ],
        'creative': [
            '조한빛 - Endless Path.mp3'
        ]
    };

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._setUpWebview();
        this._setupKeyboardListener();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(this._handleMessage, this, this._disposables);
        
        // 设置初始音乐，但不自动播放
        this._panel.webview.postMessage({ 
            command: 'init',
            track: this._getMediaUri(this._playlists[this._currentMode][0]),
            mode: this._getModeDisplayName(this._currentMode)
        });
    }

    private _getMediaUri(filename: string): string {
        const uri = vscode.Uri.joinPath(this._extensionUri, 'media', filename);
        return this._panel.webview.asWebviewUri(uri).toString();
    }

    private _playRandomTrack(mode: string) {
        const tracks = this._playlists[mode];
        if (!tracks || tracks.length === 0) {
            return;
        }

        const track = tracks[Math.floor(Math.random() * tracks.length)];
        this._currentAudio = track;

        this._panel.webview.postMessage({
            command: 'playAudio',
            track: this._getMediaUri(track).toString(),
            mode: this._getModeDisplayName(mode)
        });
    }

    private _handleMessage(message: any) {
        switch (message.command) {
            case 'audioEnded':
                this._playRandomTrack(this._currentMode);
                break;
        }
    }

    private _setUpWebview() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getWebviewContent(webview);
    }

    public static createOrShow(extensionContext: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MusicPlayerPanel.currentPanel) {
            MusicPlayerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            MusicPlayerPanel.viewType,
            'CodeBGM Player',
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(extensionContext.extensionPath, 'media'))
                ]
            }
        );

        MusicPlayerPanel.currentPanel = new MusicPlayerPanel(panel, extensionContext.extensionUri);
    }

    private _setupKeyboardListener() {
        let disposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.contentChanges.length > 0) {
                this._keystrokes.push(Date.now());
                if (this._keystrokes.length > 20) {
                    this._keystrokes.shift();
                }
                this._analyzeTypingPattern();
            }
        });
        this._disposables.push(disposable);
    }

    private _analyzeTypingPattern() {
        if (this._keystrokes.length < 2) {
            return;
        }

        let intervals: number[] = [];
        for (let i = 1; i < this._keystrokes.length; i++) {
            intervals.push(this._keystrokes[i] - this._keystrokes[i - 1]);
        }

        let avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        let variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;

        let now = Date.now();
        if (now - this._lastSwitchTime < this._minDuration) {
            return;
        }

        let newMode = 'deep_focus';
        if (avg < 200) {
            newMode = 'energy';
        } else if (variance > 50000) {
            newMode = 'creative';
        }

        if (newMode !== this._currentMode) {
            this._currentMode = newMode;
            this._lastSwitchTime = now;
            this._playRandomTrack(newMode);
        }
    }

    private _getModeDisplayName(mode: string): string {
        const modeNames: {[key: string]: string} = {
            'deep_focus': '深度专注',
            'energy': '能量激发',
            'creative': '创意发散'
        };
        return modeNames[mode] || mode;
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="zh">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource} https: http:; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline';">
            <title>CodeBGM Player</title>
            <style>
                body { 
                    font-family: var(--vscode-font-family);
                    text-align: center; 
                    padding: 40px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .status {
                    margin: 20px 0;
                    padding: 10px;
                    border-radius: 4px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .player-controls {
                    margin-top: 20px;
                }
                audio {
                    width: 80%;
                    max-width: 500px;
                }
            </style>
        </head>
        <body>
            <h2>CodeBGM Player</h2>
            <div class="status">
                当前模式：<span id="mode">深度专注</span>
            </div>
            <div class="player-controls">
                <audio id="audio" controls></audio>
                <div id="nowPlaying"></div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const audio = document.getElementById('audio');
                let isFirstPlay = true;
                let currentState = vscode.getState() || {};
                
                // 添加播放按钮
                const playButton = document.createElement('button');
                playButton.textContent = '点击开始播放';
                playButton.style.margin = '10px';
                playButton.style.padding = '8px 16px';
                playButton.style.backgroundColor = 'var(--vscode-button-background)';
                playButton.style.color = 'var(--vscode-button-foreground)';
                playButton.style.border = 'none';
                playButton.style.borderRadius = '4px';
                playButton.style.cursor = 'pointer';
                document.querySelector('.player-controls').insertBefore(playButton, audio);

                // 处理播放按钮点击
                playButton.addEventListener('click', () => {
                    if (isFirstPlay) {
                        isFirstPlay = false;
                        playButton.style.display = 'none';
                        audio.style.display = 'block';
                    }
                    audio.play().catch(console.error);
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'init':
                        case 'playAudio':
                            document.getElementById('mode').textContent = message.mode;
                            currentState = {
                                track: message.track,
                                mode: message.mode,
                                wasPlaying: currentState.wasPlaying
                            };
                            vscode.setState(currentState);
                            
                            const wasPlaying = !audio.paused;
                            audio.src = message.track;
                            if (!isFirstPlay && (wasPlaying || message.command === 'playAudio')) {
                                audio.play().catch(console.error);
                            }
                            break;
                    }
                });

                // 初始隐藏音频控件
                audio.style.display = 'none';

                // 恢复之前的播放状态
                if (currentState.track) {
                    audio.src = currentState.track;
                    document.getElementById('mode').textContent = currentState.mode;
                }

                audio.addEventListener('ended', () => {
                    vscode.postMessage({ command: 'audioEnded' });
                });

                // 处理页面可见性变化
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        if (!audio.paused) {
                            currentState.wasPlaying = true;
                            currentState.currentTime = audio.currentTime;
                            vscode.setState(currentState);
                        }
                    } else {
                        if (currentState.wasPlaying && !isFirstPlay) {
                            audio.currentTime = currentState.currentTime || 0;
                            audio.play().catch(console.error);
                        }
                    }
                });

                // 保持播放状态
                setInterval(() => {
                    if (!audio.paused && audio.currentTime > 0) {
                        currentState.wasPlaying = true;
                        currentState.currentTime = audio.currentTime;
                        vscode.setState(currentState);
                    }
                }, 1000);
            </script>
        </body>
        </html>`;
    }

    public dispose() {
        MusicPlayerPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

class CodebgmSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'codebgm.view';
    private _view: vscode.WebviewView | undefined;
    private _keystrokes: number[] = [];
    private _lastSwitchTime: number = Date.now();
    private _minDuration: number = 15000; // 最短模式切换间隔（15秒）
    private _currentMode: string = 'deep_focus';
    private _isManuallyPaused: boolean = false;
    private _playlists: { [key: string]: string[] } = {
        'deep_focus': [
            'Team Astro - Better, Together, Forever.mp3',
            '坂本龍一 - aqua.mp3',
        ],
        'energy': [
            'Pianoboy高至豪 - The truth that you leave.mp3'
        ],
        'creative': [
            '조한빛 - Endless Path.mp3'
        ]
    };

    constructor(private readonly context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void | Promise<void> {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
        };
        webviewView.webview.onDidReceiveMessage(this._handleMessage, this);
        this._setupKeyboardListener();
        webviewView.webview.html = this._getHtml(webviewView.webview);
        // 初始设置但不自动播放
        this._postInit(this._playlists[this._currentMode][0]);
    }

    private _postInit(filename: string) {
        if (!this._view) { return; }
        this._view.webview.postMessage({
            command: 'init',
            track: this._getMediaUri(filename),
            mode: this._getModeDisplayName(this._currentMode)
        });
    }

    private _getMediaUri(filename: string): string {
        if (!this._view) { return ''; }
        const uri = vscode.Uri.joinPath(this.context.extensionUri, 'media', filename);
        return this._view.webview.asWebviewUri(uri).toString();
    }

    private _handleMessage(message: any) {
        switch (message.command) {
            case 'audioEnded':
                // Only auto-play next track if not manually paused
                if (!this._isManuallyPaused) {
                    this._playRandomTrack(this._currentMode);
                }
                break;
            case 'audioPaused':
                this._isManuallyPaused = true;
                break;
            case 'audioResumed':
                this._isManuallyPaused = false;
                break;
        }
    }

    private _setupKeyboardListener() {
        let disposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.contentChanges.length > 0) {
                this._keystrokes.push(Date.now());
                if (this._keystrokes.length > 20) {
                    this._keystrokes.shift();
                }
                this._analyzeTypingPattern();
                
                // Send keystroke info to webview for effects
                if (this._view) {
                    const lastChange = e.contentChanges[e.contentChanges.length - 1];
                    if (lastChange && lastChange.text) {
                        // Extract the last character typed
                        const lastChar = lastChange.text[lastChange.text.length - 1];
                        if (lastChar && lastChar.match(/[a-z]/i)) {
                            this._view.webview.postMessage({
                                command: 'keyPressed',
                                key: lastChar.toLowerCase()
                            });
                        }
                    }
                }
            }
        });
        this.context.subscriptions.push(disposable);
    }

    private _analyzeTypingPattern() {
        if (this._keystrokes.length < 2) { return; }
        
        const now = Date.now();
        // 检查是否达到最短模式切换间隔（15秒）
        const timeSinceLastSwitch = now - this._lastSwitchTime;
        if (timeSinceLastSwitch < this._minDuration) {
            // 如果还在冷却时间内，不进行模式切换
            console.log(`模式切换冷却中... 剩余 ${Math.round((this._minDuration - timeSinceLastSwitch) / 1000)} 秒`);
            return;
        }

        let intervals: number[] = [];
        for (let i = 1; i < this._keystrokes.length; i++) {
            intervals.push(this._keystrokes[i] - this._keystrokes[i - 1]);
        }
        let avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        let variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;

        let newMode = 'deep_focus';
        if (avg < 200) { newMode = 'energy'; }
        else if (variance > 50000) { newMode = 'creative'; }

        if (newMode !== this._currentMode) {
            console.log(`模式切换: ${this._currentMode} -> ${newMode} (冷却时间已过)`);
            this._currentMode = newMode;
            this._lastSwitchTime = now;
            // Only auto-play if not manually paused
            if (!this._isManuallyPaused) {
                this._playRandomTrack(newMode);
            }
        }
    }

    private _playRandomTrack(mode: string) {
        if (!this._view) { return; }
        const tracks = this._playlists[mode] || [];
        if (tracks.length === 0) { return; }
        const track = tracks[Math.floor(Math.random() * tracks.length)];
        this._view.webview.postMessage({
            command: 'playAudio',
            track: this._getMediaUri(track),
            mode: this._getModeDisplayName(mode)
        });
    }

    private _getModeDisplayName(mode: string): string {
        const modeNames: { [key: string]: string } = {
            'deep_focus': '深度专注',
            'energy': '能量激发',
            'creative': '创意发散'
        };
        return modeNames[mode] || mode;
    }

    private _getHtml(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="zh">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource}; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline';">
            <title>CODEBGM</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    margin: 0;
                    padding: 8px;
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .row { 
                    display: flex; 
                    align-items: center; 
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .status { 
                    font-size: 12px;
                    opacity: 0.8;
                }
                button { 
                    padding: 4px 10px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                canvas { 
                    width: 100%;
                    height: 100px;
                    background: transparent;
                    border-radius: 2px;
                }
                #effectsCanvas {
                    width: 100%;
                    height: 120px;
                    background: transparent;
                    border-radius: 2px;
                    margin-top: 8px;
                }
                /* Drum pad styles */
                .pad-section {
                    margin-top: 6px;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
                    border-radius: 6px;
                    background: rgba(127,127,127,0.05);
                }
                .pad-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .pad-title {
                    font-size: 12px;
                    opacity: 0.85;
                }
                .pad-controls { display: flex; align-items: center; gap: 8px; }
                .pad-controls .tempo {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 11px;
                    opacity: 0.8;
                }
                .grid-wrapper { overflow-x: auto; }
                .pads-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 8px;
                }
                .pad {
                    background: color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 70%, transparent);
                    border-radius: 8px;
                    aspect-ratio: 1 / 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    cursor: pointer;
                    user-select: none;
                    box-shadow: inset 0 -6px 16px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.25);
                    transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
                    color: var(--vscode-foreground);
                    font-size: 11px;
                }
                .pad:active { transform: scale(.98); }
                .pad .label { z-index: 2; opacity: .9; }
                .pad .light {
                    position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
                    background:
                        radial-gradient(circle at 50% 50%, rgba(255,248,230,0.85) 0%, rgba(255,216,140,0.60) 12%, rgba(255,188,95,0.32) 26%, rgba(0,0,0,0) 50%);
                    opacity: 0; transition: opacity .18s ease, transform .20s ease, filter .20s ease; transform: scale(.9);
                    filter: blur(10px);
                }
                .pad.active .light { opacity: 0; }
                .pad.hit .light { opacity: .95; transform: scale(1.08); filter: blur(16px); }
                .pad.hit { box-shadow: 0 6px 18px rgba(0,0,0,0.35); transform: scale(1.03); }
                .step {
                    height: 28px;
                    border-radius: 4px;
                    background: rgba(255,255,255,0.06);
                    border: 1px solid rgba(255,255,255,0.08);
                    cursor: pointer;
                    position: relative;
                    transition: transform 60ms ease, box-shadow 120ms ease, background 120ms ease;
                }
                .step.active {
                    background: rgba(100, 180, 255, 0.25);
                    box-shadow: 0 0 0 1px rgba(100,180,255,0.4) inset, 0 0 10px rgba(100,180,255,0.3);
                }
                .step.playing::after {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: 4px;
                    box-shadow: 0 0 0 2px rgba(255,255,255,0.25) inset, 0 0 12px rgba(255,255,255,0.2);
                    animation: pulse 220ms ease-out;
                }
                .step:active { transform: scale(0.98); }
                @keyframes pulse {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                .thin-note { height: 22px; opacity: 0.8; }
                .transport { display: flex; align-items: center; gap: 8px; }
                .transport .toggle { min-width: 64px; }
                .sequencer { margin-top: 8px; }
                .steps { display: grid; grid-template-columns: repeat(16, 1fr); gap: 4px; }
                audio { 
                    display: none;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="row">
                    <button id="toggle">播放</button>
                    <span class="status">模式：<span id="mode">深度专注</span></span>
                </div>
                <div class="row">
                    <span class="status" style="font-size: 10px; opacity: 0.6;">按 A-Z 键触发动效</span>
                </div>
                <canvas id="viz"></canvas>
                <canvas id="effectsCanvas"></canvas>
                <div class="pad-section" id="padSection">
                    <div class="pad-header">
                        <span class="pad-title">打击垫（4×4，16步循环）</span>
                        <div class="pad-controls">
                            <div class="transport">
                                <button class="toggle" id="seqToggle">开始</button>
                                <button id="seqClear">清空</button>
                            </div>
                            <div class="tempo">
                                <label for="tempo">速度</label>
                                <input id="tempo" type="range" min="60" max="180" value="120" />
                                <span id="tempoVal">120 BPM</span>
                            </div>
                            <div class="tempo">
                                <label for="padVol">音量</label>
                                <input id="padVol" type="range" min="0" max="150" value="90" />
                                <span id="padVolVal">90%</span>
                            </div>
                            <div class="tempo">
                                <span>Step: <span id="stepIndex">-</span></span>
                            </div>
                        </div>
                    </div>
                    <div class="grid-wrapper">
                        <div class="pads-grid" id="padsGrid"></div>
                        <div class="sequencer">
                            <div class="steps" id="steps"></div>
                        </div>
                    </div>
                </div>
                <audio id="audio" crossorigin="anonymous"></audio>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const audio = document.getElementById('audio');
                const toggle = document.getElementById('toggle');
                const modeEl = document.getElementById('mode');
                const canvas = document.getElementById('viz');
                const ctx = canvas.getContext('2d');
                const effectsCanvas = document.getElementById('effectsCanvas');
                const effectsCtx = effectsCanvas.getContext('2d');
                // Drum pad elements
                const padsGrid = document.getElementById('padsGrid');
                const stepsDiv = document.getElementById('steps');
                const stepIndexEl = document.getElementById('stepIndex');
                const seqToggle = document.getElementById('seqToggle');
                const seqClear = document.getElementById('seqClear');
                const tempoInput = document.getElementById('tempo');
                const tempoVal = document.getElementById('tempoVal');
                const padVol = document.getElementById('padVol');
                const padVolVal = document.getElementById('padVolVal');
                
                // Set canvas size
                function resizeCanvas() {
                    const rect = canvas.getBoundingClientRect();
                    canvas.width = rect.width * window.devicePixelRatio;
                    canvas.height = rect.height * window.devicePixelRatio;
                    
                    const effectsRect = effectsCanvas.getBoundingClientRect();
                    effectsCanvas.width = effectsRect.width * window.devicePixelRatio;
                    effectsCanvas.height = effectsRect.height * window.devicePixelRatio;
                    effectsCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
                    
                    console.log('Canvas resized:', {
                        effectsCanvas: {
                            width: effectsCanvas.width,
                            height: effectsCanvas.height,
                            rect: effectsRect
                        }
                    });
                }
                resizeCanvas();
                window.addEventListener('resize', resizeCanvas);

                let started = false;
                let ac, analyser, src;
                let padMaster, padComp;
                let padGain = 0.9;
                
                // Keyboard Effects System
                let effects = [];
                let effectId = 0;
                const MAX_EFFECTS = 20; // Limit number of effects for performance
                
                // Effect types configuration
                const effectTypes = {
                    'a': { type: 'circle', color: '#ff6b6b', sound: 'low' },
                    'b': { type: 'particle', color: '#4ecdc4', sound: 'mid' },
                    'c': { type: 'wave', color: '#45b7d1', sound: 'high' },
                    'd': { type: 'triangle', color: '#96ceb4', sound: 'low' },
                    'e': { type: 'square', color: '#feca57', sound: 'mid' },
                    'f': { type: 'hexagon', color: '#ff9ff3', sound: 'high' },
                    'g': { type: 'spiral', color: '#54a0ff', sound: 'low' },
                    'h': { type: 'burst', color: '#5f27cd', sound: 'mid' },
                    'i': { type: 'ripple', color: '#00d2d3', sound: 'high' },
                    'j': { type: 'star', color: '#ff9f43', sound: 'low' },
                    'k': { type: 'diamond', color: '#ee5a24', sound: 'mid' },
                    'l': { type: 'cross', color: '#0984e3', sound: 'high' },
                    'm': { type: 'heart', color: '#e84393', sound: 'low' },
                    'n': { type: 'lightning', color: '#fdcb6e', sound: 'mid' },
                    'o': { type: 'flower', color: '#6c5ce7', sound: 'high' },
                    'p': { type: 'gear', color: '#a29bfe', sound: 'low' },
                    'q': { type: 'crown', color: '#fd79a8', sound: 'mid' },
                    'r': { type: 'arrow', color: '#fdcb6e', sound: 'high' },
                    's': { type: 'shield', color: '#00b894', sound: 'low' },
                    't': { type: 'moon', color: '#74b9ff', sound: 'mid' },
                    'u': { type: 'sun', color: '#fdcb6e', sound: 'high' },
                    'v': { type: 'leaf', color: '#00b894', sound: 'low' },
                    'w': { type: 'butterfly', color: '#e17055', sound: 'mid' },
                    'x': { type: 'x', color: '#636e72', sound: 'high' },
                    'y': { type: 'yin-yang', color: '#2d3436', sound: 'low' },
                    'z': { type: 'zigzag', color: '#6c5ce7', sound: 'mid' }
                };
                
                // Create effect function
                function createEffect(key) {
                    console.log('createEffect called with key:', key);
                    const config = effectTypes[key.toLowerCase()];
                    if (!config) {
                        console.log('No config found for key:', key);
                        return;
                    }
                    console.log('Creating effect:', config);
                    
                    const rect = effectsCanvas.getBoundingClientRect();
                    const x = Math.random() * rect.width;
                    const y = Math.random() * rect.height;
                    
                    const effect = {
                        id: effectId++,
                        type: config.type,
                        color: config.color,
                        x: x,
                        y: y,
                        size: 20 + Math.random() * 40,
                        life: 1.0,
                        maxLife: 1.0,
                        rotation: 0,
                        velocity: {
                            x: (Math.random() - 0.5) * 4,
                            y: (Math.random() - 0.5) * 4
                        },
                        particles: config.type === 'particle' ? [] : null
                    };
                    
                    // Initialize particles for particle effect
                    if (config.type === 'particle') {
                        for (let i = 0; i < 8; i++) {
                            effect.particles.push({
                                x: x,
                                y: y,
                                vx: (Math.random() - 0.5) * 8,
                                vy: (Math.random() - 0.5) * 8,
                                life: 1.0
                            });
                        }
                    }
                    
                    effects.push(effect);
                    
                    // Remove oldest effects if we exceed the limit
                    if (effects.length > MAX_EFFECTS) {
                        effects.splice(0, effects.length - MAX_EFFECTS);
                    }
                    
                    // Play sound effect
                    playSoundEffect(config.sound);
                }
                
                // Play sound effect
                function playSoundEffect(type) {
                    if (!ac) return;
                    
                    const oscillator = ac.createOscillator();
                    const gainNode = ac.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(ac.destination);
                    
                    const frequencies = {
                        'low': 100 + Math.random() * 100,
                        'mid': 300 + Math.random() * 200,
                        'high': 600 + Math.random() * 400
                    };
                    
                    oscillator.frequency.setValueAtTime(frequencies[type], ac.currentTime);
                    oscillator.type = 'sine';
                    
                    gainNode.gain.setValueAtTime(0.3, ac.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.03, ac.currentTime + 0.3);
                    
                    oscillator.start(ac.currentTime);
                    oscillator.stop(ac.currentTime + 0.3);
                }
                
                // Render effects
                function renderEffects() {
                    const rect = effectsCanvas.getBoundingClientRect();
                    effectsCtx.clearRect(0, 0, rect.width, rect.height);
                    
                    // Only continue rendering if there are effects
                    if (effects.length === 0) {
                        requestAnimationFrame(renderEffects);
                        return;
                    }
                    
                    for (let i = effects.length - 1; i >= 0; i--) {
                        const effect = effects[i];
                        effect.life -= 0.02;
                        
                        if (effect.life <= 0) {
                            effects.splice(i, 1);
                            continue;
                        }
                        
                        effect.x += effect.velocity.x;
                        effect.y += effect.velocity.y;
                        effect.rotation += 0.1;
                        
                        const alpha = effect.life;
                        const size = effect.size * effect.life;
                        
                        effectsCtx.save();
                        effectsCtx.globalAlpha = alpha;
                        effectsCtx.fillStyle = effect.color;
                        effectsCtx.strokeStyle = effect.color;
                        effectsCtx.lineWidth = 2;
                        
                        effectsCtx.translate(effect.x, effect.y);
                        effectsCtx.rotate(effect.rotation);
                        
                        switch (effect.type) {
                            case 'circle':
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, 0, size, 0, Math.PI * 2);
                                effectsCtx.fill();
                                break;
                                
                            case 'particle':
                                effect.particles.forEach(particle => {
                                    particle.x += particle.vx;
                                    particle.y += particle.vy;
                                    particle.life -= 0.05;
                                    particle.vx *= 0.98;
                                    particle.vy *= 0.98;
                                    
                                    if (particle.life > 0) {
                                        effectsCtx.globalAlpha = particle.life * alpha;
                                        effectsCtx.beginPath();
                                        effectsCtx.arc(particle.x - effect.x, particle.y - effect.y, 3, 0, Math.PI * 2);
                                        effectsCtx.fill();
                                    }
                                });
                                break;
                                
                            case 'wave':
                                effectsCtx.beginPath();
                                for (let j = 0; j < 5; j++) {
                                    const waveSize = size * (1 - j * 0.2);
                                    effectsCtx.beginPath();
                                    effectsCtx.arc(0, 0, waveSize, 0, Math.PI * 2);
                                    effectsCtx.stroke();
                                }
                                break;
                                
                            case 'triangle':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(0, -size);
                                effectsCtx.lineTo(-size * 0.866, size * 0.5);
                                effectsCtx.lineTo(size * 0.866, size * 0.5);
                                effectsCtx.closePath();
                                effectsCtx.fill();
                                break;
                                
                            case 'square':
                                effectsCtx.fillRect(-size/2, -size/2, size, size);
                                break;
                                
                            case 'hexagon':
                                effectsCtx.beginPath();
                                for (let j = 0; j < 6; j++) {
                                    const angle = (j * Math.PI) / 3;
                                    const x = Math.cos(angle) * size;
                                    const y = Math.sin(angle) * size;
                                    if (j === 0) effectsCtx.moveTo(x, y);
                                    else effectsCtx.lineTo(x, y);
                                }
                                effectsCtx.closePath();
                                effectsCtx.fill();
                                break;
                                
                            case 'spiral':
                                effectsCtx.beginPath();
                                for (let j = 0; j < 100; j++) {
                                    const angle = j * 0.1;
                                    const radius = (j / 100) * size;
                                    const x = Math.cos(angle) * radius;
                                    const y = Math.sin(angle) * radius;
                                    if (j === 0) effectsCtx.moveTo(x, y);
                                    else effectsCtx.lineTo(x, y);
                                }
                                effectsCtx.stroke();
                                break;
                                
                            case 'burst':
                                for (let j = 0; j < 8; j++) {
                                    const angle = (j * Math.PI) / 4;
                                    const endX = Math.cos(angle) * size;
                                    const endY = Math.sin(angle) * size;
                                    effectsCtx.beginPath();
                                    effectsCtx.moveTo(0, 0);
                                    effectsCtx.lineTo(endX, endY);
                                    effectsCtx.stroke();
                                }
                                break;
                                
                            case 'ripple':
                                for (let j = 0; j < 3; j++) {
                                    const rippleSize = size * (1 - j * 0.3);
                                    effectsCtx.beginPath();
                                    effectsCtx.arc(0, 0, rippleSize, 0, Math.PI * 2);
                                    effectsCtx.stroke();
                                }
                                break;
                                
                            case 'star':
                                effectsCtx.beginPath();
                                for (let j = 0; j < 10; j++) {
                                    const angle = (j * Math.PI) / 5;
                                    const radius = j % 2 === 0 ? size : size * 0.5;
                                    const x = Math.cos(angle) * radius;
                                    const y = Math.sin(angle) * radius;
                                    if (j === 0) effectsCtx.moveTo(x, y);
                                    else effectsCtx.lineTo(x, y);
                                }
                                effectsCtx.closePath();
                                effectsCtx.fill();
                                break;
                                
                            case 'diamond':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(0, -size);
                                effectsCtx.lineTo(size, 0);
                                effectsCtx.lineTo(0, size);
                                effectsCtx.lineTo(-size, 0);
                                effectsCtx.closePath();
                                effectsCtx.fill();
                                break;
                                
                            case 'cross':
                                effectsCtx.fillRect(-size/2, -size/6, size, size/3);
                                effectsCtx.fillRect(-size/6, -size/2, size/3, size);
                                break;
                                
                            case 'heart':
                                effectsCtx.beginPath();
                                const topCurveHeight = size * 0.3;
                                effectsCtx.moveTo(0, topCurveHeight);
                                effectsCtx.bezierCurveTo(0, 0, -size/2, 0, -size/2, topCurveHeight);
                                effectsCtx.bezierCurveTo(-size/2, size/2, 0, size/2, 0, size);
                                effectsCtx.bezierCurveTo(0, size/2, size/2, size/2, size/2, topCurveHeight);
                                effectsCtx.bezierCurveTo(size/2, 0, 0, 0, 0, topCurveHeight);
                                effectsCtx.fill();
                                break;
                                
                            case 'lightning':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(0, -size);
                                effectsCtx.lineTo(-size/3, -size/3);
                                effectsCtx.lineTo(size/3, -size/6);
                                effectsCtx.lineTo(-size/6, size/6);
                                effectsCtx.lineTo(size/6, size/3);
                                effectsCtx.lineTo(0, size);
                                effectsCtx.stroke();
                                break;
                                
                            case 'flower':
                                for (let j = 0; j < 6; j++) {
                                    effectsCtx.save();
                                    effectsCtx.rotate((j * Math.PI) / 3);
                                    effectsCtx.beginPath();
                                    effectsCtx.ellipse(0, -size/2, size/4, size/2, 0, 0, Math.PI * 2);
                                    effectsCtx.fill();
                                    effectsCtx.restore();
                                }
                                break;
                                
                            case 'gear':
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, 0, size, 0, Math.PI * 2);
                                effectsCtx.fill();
                                for (let j = 0; j < 8; j++) {
                                    const angle = (j * Math.PI) / 4;
                                    const x = Math.cos(angle) * size;
                                    const y = Math.sin(angle) * size;
                                    effectsCtx.beginPath();
                                    effectsCtx.arc(x, y, size/4, 0, Math.PI * 2);
                                    effectsCtx.fill();
                                }
                                break;
                                
                            case 'crown':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(-size/2, size/2);
                                effectsCtx.lineTo(-size/3, -size/2);
                                effectsCtx.lineTo(-size/6, size/4);
                                effectsCtx.lineTo(0, -size/2);
                                effectsCtx.lineTo(size/6, size/4);
                                effectsCtx.lineTo(size/3, -size/2);
                                effectsCtx.lineTo(size/2, size/2);
                                effectsCtx.fill();
                                break;
                                
                            case 'arrow':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(0, -size);
                                effectsCtx.lineTo(-size/3, -size/3);
                                effectsCtx.lineTo(-size/6, -size/3);
                                effectsCtx.lineTo(-size/6, size);
                                effectsCtx.lineTo(size/6, size);
                                effectsCtx.lineTo(size/6, -size/3);
                                effectsCtx.lineTo(size/3, -size/3);
                                effectsCtx.closePath();
                                effectsCtx.fill();
                                break;
                                
                            case 'shield':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(0, -size);
                                effectsCtx.quadraticCurveTo(-size/2, -size/2, -size/2, 0);
                                effectsCtx.quadraticCurveTo(-size/2, size/2, 0, size);
                                effectsCtx.quadraticCurveTo(size/2, size/2, size/2, 0);
                                effectsCtx.quadraticCurveTo(size/2, -size/2, 0, -size);
                                effectsCtx.fill();
                                break;
                                
                            case 'moon':
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, 0, size, 0, Math.PI * 2);
                                effectsCtx.fill();
                                effectsCtx.fillStyle = 'var(--vscode-editor-background)';
                                effectsCtx.beginPath();
                                effectsCtx.arc(size/3, 0, size * 0.8, 0, Math.PI * 2);
                                effectsCtx.fill();
                                break;
                                
                            case 'sun':
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, 0, size, 0, Math.PI * 2);
                                effectsCtx.fill();
                                for (let j = 0; j < 12; j++) {
                                    const angle = (j * Math.PI) / 6;
                                    const startX = Math.cos(angle) * size;
                                    const startY = Math.sin(angle) * size;
                                    const endX = Math.cos(angle) * (size + size/2);
                                    const endY = Math.sin(angle) * (size + size/2);
                                    effectsCtx.beginPath();
                                    effectsCtx.moveTo(startX, startY);
                                    effectsCtx.lineTo(endX, endY);
                                    effectsCtx.stroke();
                                }
                                break;
                                
                            case 'leaf':
                                effectsCtx.beginPath();
                                effectsCtx.ellipse(0, 0, size/2, size, -Math.PI/4, 0, Math.PI * 2);
                                effectsCtx.fill();
                                break;
                                
                            case 'butterfly':
                                effectsCtx.beginPath();
                                effectsCtx.ellipse(-size/3, 0, size/3, size/2, -Math.PI/6, 0, Math.PI * 2);
                                effectsCtx.fill();
                                effectsCtx.beginPath();
                                effectsCtx.ellipse(size/3, 0, size/3, size/2, Math.PI/6, 0, Math.PI * 2);
                                effectsCtx.fill();
                                break;
                                
                            case 'x':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(-size/2, -size/2);
                                effectsCtx.lineTo(size/2, size/2);
                                effectsCtx.moveTo(size/2, -size/2);
                                effectsCtx.lineTo(-size/2, size/2);
                                effectsCtx.stroke();
                                break;
                                
                            case 'yin-yang':
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, 0, size, 0, Math.PI * 2);
                                effectsCtx.fill();
                                effectsCtx.fillStyle = 'var(--vscode-editor-background)';
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, -size/2, size/2, 0, Math.PI * 2);
                                effectsCtx.fill();
                                effectsCtx.fillStyle = effect.color;
                                effectsCtx.beginPath();
                                effectsCtx.arc(0, size/2, size/2, 0, Math.PI * 2);
                                effectsCtx.fill();
                                break;
                                
                            case 'zigzag':
                                effectsCtx.beginPath();
                                effectsCtx.moveTo(-size/2, -size/2);
                                effectsCtx.lineTo(-size/6, size/2);
                                effectsCtx.lineTo(size/6, -size/2);
                                effectsCtx.lineTo(size/2, size/2);
                                effectsCtx.stroke();
                                break;
                        }
                        
                        effectsCtx.restore();
                    }
                    
                    requestAnimationFrame(renderEffects);
                }
                
                // Start effects rendering
                renderEffects();
                
                // Clear all effects function
                function clearAllEffects() {
                    effects = [];
                }
                
                // Add clear button
                const clearButton = document.createElement('button');
                clearButton.textContent = '清除动效';
                clearButton.style.fontSize = '10px';
                clearButton.style.padding = '2px 6px';
                clearButton.style.marginLeft = '8px';
                clearButton.addEventListener('click', clearAllEffects);
                document.querySelector('.row').appendChild(clearButton);
                
                // Add test button
                const testButton = document.createElement('button');
                testButton.textContent = '测试动效';
                testButton.style.fontSize = '10px';
                testButton.style.padding = '2px 6px';
                testButton.style.marginLeft = '8px';
                testButton.addEventListener('click', () => {
                    console.log('Test button clicked');
                    createEffect('a');
                });
                document.querySelector('.row').appendChild(testButton);

                function ensureAudioContext() {
                    if(ac) return;
                    ac = new (window.AudioContext || window.webkitAudioContext)();
                    analyser = ac.createAnalyser();
                    padMaster = ac.createGain();
                    padMaster.gain.value = padGain;
                    // Gentle bus compression for punch and perceived loudness
                    padComp = ac.createDynamicsCompressor();
                    padComp.threshold.setValueAtTime(-18, ac.currentTime);
                    padComp.knee.setValueAtTime(24, ac.currentTime);
                    padComp.ratio.setValueAtTime(3, ac.currentTime);
                    padComp.attack.setValueAtTime(0.003, ac.currentTime);
                    padComp.release.setValueAtTime(0.25, ac.currentTime);
                    padMaster.connect(padComp);
                    padComp.connect(ac.destination);
                    analyser.fftSize = 256;
                    const bufferLength = analyser.frequencyBinCount;
                    const dataArray = new Uint8Array(bufferLength);

                    function draw() {
                        requestAnimationFrame(draw);
                        if(!analyser) return;
                        
                        analyser.getByteFrequencyData(dataArray);
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        
                        const barWidth = canvas.width / bufferLength * 0.8;
                        const barGap = barWidth * 0.2;
                        
                        for(let i = 0; i < bufferLength; i++) {
                            const v = dataArray[i] / 255;
                            const h = v * canvas.height * 0.8;
                            const x = (barWidth + barGap) * i + canvas.width * 0.1;
                            
                            const gradient = ctx.createLinearGradient(0, canvas.height - h, 0, canvas.height);
                            gradient.addColorStop(0, \`hsla(\${200 + i}, 70%, 50%, 0.8)\`);
                            gradient.addColorStop(1, \`hsla(\${200 + i}, 70%, 30%, 0.5)\`);
                            
                            ctx.fillStyle = gradient;
                            ctx.fillRect(x, canvas.height - h, barWidth, h);
                        }
                    }
                    draw();
                }

                toggle.addEventListener('click', async () => {
                    try {
                        if(!started) {
                            started = true;
                            ensureAudioContext();
                            src = ac.createMediaElementSource(audio);
                            src.connect(analyser);
                            analyser.connect(ac.destination);
                        }
                        
                        if(audio.paused) {
                            await audio.play();
                            toggle.textContent = '暂停';
                            vscode.postMessage({ command: 'audioResumed' });
                        } else {
                            audio.pause();
                            toggle.textContent = '播放';
                            vscode.postMessage({ command: 'audioPaused' });
                        }
                    } catch(err) {
                        console.error('播放出错:', err);
                        vscode.postMessage({ command: 'error', error: err.message });
                    }
                });

                window.addEventListener('message', e => {
                    const m = e.data;
                    switch(m.command) {
                        case 'init':
                        case 'playAudio':
                            modeEl.textContent = m.mode;
                            audio.src = m.track;
                            if(started && m.command === 'playAudio') {
                                audio.play().catch(console.error);
                            }
                            break;
                        case 'keyPressed':
                            console.log('Received keyPressed message:', m.key);
                            createEffect(m.key);
                            break;
                    }
                });

                audio.addEventListener('ended', () => {
                    vscode.postMessage({ command: 'audioEnded' });
                    toggle.textContent = '播放';
                });

                // ==== Drum pad (4x4) & 16-step sequencer ====
                const PAD_ROWS = 4, PAD_COLS = 4;
                const PADS = PAD_ROWS * PAD_COLS;
                const STEPS = 16;
                const patterns = Array.from({ length: PADS }, () => Array(STEPS).fill(false));
                const padEls = [];

                // Build pad UI
                function initPads() {
                    padsGrid.innerHTML = '';
                    for (let i = 0; i < PADS; i++) {
                        const el = document.createElement('div');
                        el.className = 'pad';
                        el.dataset.idx = String(i);
                        el.innerHTML = '<div class="label">PAD ' + (i + 1) + '</div><div class="light"></div>';
                        padsGrid.appendChild(el);
                        padEls.push(el);
                    }
                }
                initPads();

                // Build steps UI
                function initSteps() {
                    stepsDiv.innerHTML = '';
                    for (let s = 0; s < STEPS; s++) {
                        const st = document.createElement('div');
                        st.className = 'step';
                        st.dataset.step = String(s);
                        st.textContent = String(s + 1);
                        stepsDiv.appendChild(st);
                    }
                }
                initSteps();

                // Immediate play mapping
                // Ethereal chords for last column (add9/maj7 flavors)
                const ETHEREAL_CHORDS = [
                    [261.63, 329.63, 392.00, 587.33],  // Cadd9: C4 E4 G4 D5
                    [220.00, 261.63, 329.63, 493.88],  // Am9:  A3 C4 E4 B4
                    [174.61, 220.00, 261.63, 329.63],  // Fmaj7: F3 A3 C4 E4
                    [196.00, 246.94, 293.66, 392.00]   // Gsus2(add6): G3 B3 D4 G4
                ];

                // Row-wise pitch sets for columns 0..2 (distinct timbres + pitch)
                const ROW_FREQS = [
                    [55.00, 73.42, 98.00],   // Row 0: bass boom
                    [110.00, 147.00, 196.00],// Row 1: toms
                    [220.00, 293.66, 392.00],// Row 2: plucks
                    [440.00, 587.33, 784.00] // Row 3: bells
                ];

                function playEtherealChord(time, freqs) {
                    // soft airy pad: detuned saws through LP, with light stereo echoes and noise air
                    const lp = ac.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.setValueAtTime(1800, time);
                    const g = envAD(lp, time, 0.02, 0.9, 0.35, 0.0001);
                    lp.connect(padMaster);

                    for (let i = 0; i < freqs.length; i++) {
                        const oscA = ac.createOscillator();
                        const oscB = ac.createOscillator();
                        oscA.type = 'sawtooth';
                        oscB.type = 'sawtooth';
                        oscA.frequency.setValueAtTime(freqs[i], time);
                        oscB.frequency.setValueAtTime(freqs[i], time);
                        oscA.detune.setValueAtTime(-6, time);
                        oscB.detune.setValueAtTime(6, time);
                        oscA.connect(g); oscB.connect(g);
                        oscA.start(time); oscB.start(time);
                        oscA.stop(time + 0.8); oscB.stop(time + 0.8);
                    }

                    // Add airy noise layer
                    const noise = ac.createBufferSource();
                    const nb = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
                    const nd = nb.getChannelData(0);
                    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
                    noise.buffer = nb;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
                    const gAir = envAD(padMaster, time + 0.01, 0.02, 0.6, 0.12, 0.0001);
                    noise.connect(hp).connect(gAir);
                    noise.start(time); noise.stop(time + 0.4);

                    // Subtle stereo echoes (no feedback)
                    const dL = ac.createDelay(1.0); dL.delayTime.setValueAtTime(0.22, time);
                    const dR = ac.createDelay(1.0); dR.delayTime.setValueAtTime(0.31, time);
                    const gL = ac.createGain(); gL.gain.value = 0.12;
                    const gR = ac.createGain(); gR.gain.value = 0.12;
                    const panL = ac.createStereoPanner(); panL.pan.value = -0.6;
                    const panR = ac.createStereoPanner(); panR.pan.value = 0.6;
                    g.connect(dL).connect(gL).connect(panL).connect(padMaster);
                    g.connect(dR).connect(gR).connect(panR).connect(padMaster);
                }

                function triggerPad(padIdx, time) {
                    const row = Math.floor(padIdx / PAD_COLS);
                    const col = padIdx % PAD_COLS;
                    if (col === PAD_COLS - 1) {
                        const chord = ETHEREAL_CHORDS[row] || ETHEREAL_CHORDS[0];
                        playEtherealChord(time, chord);
                        return;
                    }
                    // First row: three distinct kick flavors
                    if (row === 0) {
                        if (col === 0) { playKick(time, 1.25, 'tight'); return; }
                        if (col === 1) { playKick(time, 1.3, 'round'); return; }
                        if (col === 2) { playKick(time, 1.35, 'deep'); return; }
                        // col 3 is handled by chord block above
                    }
                    // Row-specific mapping: row 1 (second row) columns 0..2 are cymbal/drum voices
                    if (row === 1) {
                        if (col === 0) { playCrash(time); return; }
                        if (col === 1) { playOpenHat(time); return; }
                        if (col === 2) { playRide(time); return; }
                    }
                    const freq = (ROW_FREQS[row] && ROW_FREQS[row][col]) ? ROW_FREQS[row][col] : 220;
                    if (row === 0) { const boost = col < 3 ? 1.15 : 1.0; playBassBoom(time, freq, boost); }
                    else if (row === 1) playTom(time, freq); // fallback for other columns if any
                    else if (row === 2) playPluck(time, freq);
                    else { const boost = col < 3 ? 1.15 : 1.0; playBellTone(time, freq, boost); }
                }

                // Pad interactions
                padEls.forEach((el, idx) => {
                    el.addEventListener('click', () => {
                        ensureAudioContext();
                        triggerPad(idx, ac.currentTime + 0.001);
                        // Flash
                        el.classList.add('hit');
                        el.classList.add('active');
                        setTimeout(() => { el.classList.remove('hit'); }, 180);
                        setTimeout(() => { el.classList.remove('active'); }, 420);
                        // Toggle current step if playing else toggle step 0
                        const s = isRunning ? currentStep : 0;
                        patterns[idx][s] = !patterns[idx][s];
                        renderPatternUI();
                    });
                });

                // Steps click toggles all pads at that step
                stepsDiv.addEventListener('click', (ev) => {
                    const st = ev.target.closest('.step');
                    if (!st) return;
                    const s = Number(st.dataset.step);
                    for (let i = 0; i < PADS; i++) patterns[i][s] = !patterns[i][s];
                    renderPatternUI();
                });

                // Sequencer core
                let currentStep = 0;
                let isRunning = false;
                let nextNoteTime = 0; // in ac time
                let scheduleTimer = null;

                function getStepIntervalSec() {
                    const bpm = Number(tempoInput.value) || 120;
                    return (60 / bpm) / 4; // 1/16 note
                }
                function scheduler() {
                    const lookahead = 0.1; // seconds
                    while (nextNoteTime < ac.currentTime + lookahead) {
                        scheduleStep(currentStep, nextNoteTime);
                        const stepDur = getStepIntervalSec();
                        nextNoteTime += stepDur;
                        currentStep = (currentStep + 1) % STEPS;
                    }
                }
                function scheduleStep(stepIndex, time) {
                    // Trigger pads with active pattern at this step
                    for (let i = 0; i < PADS; i++) if (patterns[i][stepIndex]) triggerPad(i, time);
                    // Visuals
                    requestAnimationFrame(() => {
                        stepIndexEl.textContent = String(stepIndex + 1);
                        const stepNodes = stepsDiv.querySelectorAll('.step');
                        stepNodes.forEach((n, idx) => n.classList.toggle('playing', idx === stepIndex));
                        // Pulse active pads
                        padEls.forEach((padEl, i) => {
                            if (patterns[i][stepIndex]) {
                                padEl.classList.add('hit');
                                padEl.classList.add('active');
                                setTimeout(() => { padEl.classList.remove('hit'); padEl.classList.remove('active'); }, 200);
                            }
                        });
                    });
                }
                function startSequencer() {
                    ensureAudioContext();
                    if (isRunning) return;
                    isRunning = true;
                    seqToggle.textContent = '停止';
                    currentStep = 0;
                    nextNoteTime = ac.currentTime + 0.05;
                    scheduleTimer = setInterval(scheduler, 25);
                }
                function stopSequencer() {
                    if (!isRunning) return;
                    isRunning = false;
                    seqToggle.textContent = '开始';
                    if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
                    stepsDiv.querySelectorAll('.step.playing').forEach(n => n.classList.remove('playing'));
                    stepIndexEl.textContent = '-';
                }
                seqToggle.addEventListener('click', () => { if (!isRunning) startSequencer(); else stopSequencer(); });
                seqClear.addEventListener('click', () => {
                    for (let i = 0; i < PADS; i++) patterns[i].fill(false);
                    renderPatternUI();
                });
                tempoInput.addEventListener('input', () => { tempoVal.textContent = tempoInput.value + ' BPM'; });
                if (padVol) {
                    const updatePadVolLabel = () => { if (padVolVal) padVolVal.textContent = padVol.value + '%'; };
                    updatePadVolLabel();
                    padVol.addEventListener('input', () => {
                        const v = Math.max(0, Math.min(150, parseInt(padVol.value || '90')));
                        padGain = v / 100;
                        if (padMaster) padMaster.gain.value = padGain;
                        updatePadVolLabel();
                    });
                }

                function renderPatternUI() {
                    // Pad active state if any step true
                    padEls.forEach((el, idx) => {
                        const any = patterns[idx].some(v => v);
                        el.classList.toggle('active', any);
                    });
                    // Steps opacity proportional to number of active pads
                    const stepNodes = stepsDiv.querySelectorAll('.step');
                    for (let s = 0; s < STEPS; s++) {
                        let count = 0; for (let i = 0; i < PADS; i++) if (patterns[i][s]) count++;
                        const node = stepNodes[s];
                        if (node) node.style.opacity = String(0.25 + Math.min(1, count / 8));
                    }
                }
                renderPatternUI();

                // ---- Simple percussive synths ----
                function envAD(dest, t0, attack, decay, peak=0.9, sustain=0.0001) {
                    const g = ac.createGain();
                    g.gain.setValueAtTime(0.0001, t0);
                    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
                    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + attack + decay);
                    g.connect(dest);
                    return g;
                }
                // Row-specific pitched instruments
                function playBassBoom(time, freq, levelMul = 1.0) {
                    const osc = ac.createOscillator();
                    const g = envAD(padMaster, time, 0.002, 0.22, 0.8 * levelMul, 0.0001);
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq * 2, time);
                    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.18);
                    osc.connect(g);
                    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
                    g.disconnect(); g.connect(lp).connect(padMaster);
                    osc.start(time); osc.stop(time + 0.25);
                }
                function playTom(time, freq) {
                    const osc = ac.createOscillator();
                    const g = envAD(padMaster, time, 0.003, 0.18, 0.8, 0.0001);
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq * 1.6, time);
                    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.16);
                    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2; bp.Q.value = 6;
                    osc.connect(bp).connect(g);
                    osc.start(time); osc.stop(time + 0.22);
                }
                function playPluck(time, freq) {
                    const osc = ac.createOscillator();
                    const g = envAD(padMaster, time, 0.002, 0.12, 0.7, 0.0001);
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(freq, time);
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
                    osc.connect(hp).connect(g);
                    osc.start(time); osc.stop(time + 0.15);
                }
                function playBellTone(time, freq, levelMul = 1.0) {
                    const osc1 = ac.createOscillator();
                    const osc2 = ac.createOscillator();
                    const g = envAD(padMaster, time, 0.002, 0.6, 0.65 * levelMul, 0.0001);
                    osc1.type = 'sine'; osc2.type = 'sine';
                    osc1.frequency.setValueAtTime(freq, time);
                    osc2.frequency.setValueAtTime(freq * 2.99, time); // inharmonic partial
                    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2; bp.Q.value = 10;
                    osc1.connect(bp).connect(g); osc2.connect(bp);
                    const d = ac.createDelay(1.0); d.delayTime.value = 0.18; const gd = ac.createGain(); gd.gain.value = 0.12;
                    g.connect(d).connect(gd).connect(padMaster);
                    osc1.start(time); osc2.start(time);
                    osc1.stop(time + 0.7); osc2.stop(time + 0.7);
                }
                function playKick(time, levelMul = 1.0, variant = 'round') {
                    // variant knobs
                    const v = {
                        'tight': { fStart: 190, fEnd: 44, sweep: 0.18, lp: 1400, atk: 0.001, dec: 0.18, clickHz: 2800, clickPeak: 0.7 },
                        'round': { fStart: 170, fEnd: 36, sweep: 0.22, lp: 1200, atk: 0.0015, dec: 0.26, clickHz: 2000, clickPeak: 0.9 },
                        'deep':  { fStart: 150, fEnd: 30, sweep: 0.28, lp: 1000, atk: 0.002, dec: 0.3,  clickHz: 1800, clickPeak: 0.8 }
                    }[variant] || { fStart: 170, fEnd: 36, sweep: 0.22, lp: 1200, atk: 0.0015, dec: 0.26, clickHz: 2000, clickPeak: 0.9 };
                    // Body with pitch sweep and gentle saturation
                    const osc = ac.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(v.fStart, time);
                    osc.frequency.exponentialRampToValueAtTime(v.fEnd, time + v.sweep);
                    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = v.lp;
                    const shaper = ac.createWaveShaper();
                    (function(){ const n=1024, c=new Float32Array(n), k=2.0; for(let i=0;i<n;i++){ const x=i/n*2-1; c[i]=(1+k)*x/(1+k*Math.abs(x)); } shaper.curve=c; })();
                    const g = envAD(padMaster, time, v.atk, v.dec, 1.2 * levelMul, 0.0001);
                    osc.connect(lp).connect(shaper).connect(g);
                    osc.start(time); osc.stop(time + Math.max(0.2, v.sweep + 0.06));
                    // Click transient
                    const click = ac.createBufferSource();
                    const buf = ac.createBuffer(1, ac.sampleRate * 0.015, ac.sampleRate);
                    const d = buf.getChannelData(0);
                    for (let i = 0; i < d.length; i++) { d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); }
                    click.buffer = buf;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.clickHz;
                    const gClick = envAD(padMaster, time, 0.0005, 0.04, v.clickPeak * levelMul, 0.0001);
                    click.connect(hp).connect(gClick);
                    click.start(time); click.stop(time + 0.02);
                }
                function playSnare(time) {
                    // Noise layer for sizzle
                    const noise = ac.createBufferSource();
                    const buffer = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < data.length; i++) { data[i] = (Math.random() * 2 - 1) * (1 - i / data.length); }
                    noise.buffer = buffer;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
                    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
                    const gN = envAD(padMaster, time, 0.001, 0.16, 1.0, 0.0001);
                    noise.connect(hp).connect(bp).connect(gN);
                    noise.start(time); noise.stop(time + 0.22);
                    // Tonal body for punch
                    const body = ac.createOscillator(); body.type = 'triangle';
                    body.frequency.setValueAtTime(190, time);
                    body.frequency.exponentialRampToValueAtTime(160, time + 0.08);
                    const bp2 = ac.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 180; bp2.Q.value = 1.2;
                    const gT = envAD(padMaster, time, 0.001, 0.12, 0.6, 0.0001);
                    body.connect(bp2).connect(gT);
                    body.start(time); body.stop(time + 0.15);
                }
                function playHat(time) {
                    // Noise for broad shimmer
                    const noise = ac.createBufferSource();
                    const buffer = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
                    noise.buffer = buffer;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
                    const g = envAD(padMaster, time, 0.0005, 0.05, 0.85, 0.0001);
                    noise.connect(hp).connect(g);
                    noise.start(time); noise.stop(time + 0.06);
                    // Metallic partials for definition
                    [10000, 12000, 14000].forEach((f, i) => {
                        const osc = ac.createOscillator(); osc.type = 'square'; osc.frequency.value = f;
                        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 8;
                        const gP = envAD(padMaster, time, 0.0005, 0.04 + i * 0.01, 0.25, 0.0001);
                        osc.connect(bp).connect(gP);
                        osc.start(time); osc.stop(time + 0.06 + i * 0.01);
                    });
                }
                function playOpenHat(time) {
                    const noise = ac.createBufferSource();
                    const buffer = ac.createBuffer(1, ac.sampleRate * 0.35, ac.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
                    noise.buffer = buffer;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
                    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9000; bp.Q.value = 0.7;
                    const g = envAD(padMaster, time, 0.001, 0.28, 0.6, 0.0001);
                    noise.connect(hp).connect(bp).connect(g);
                    noise.start(time);
                    noise.stop(time + 0.35);
                }
                function playCrash(time) {
                    const noise = ac.createBufferSource();
                    const buffer = ac.createBuffer(1, ac.sampleRate * 0.9, ac.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < data.length; i++) { data[i] = (Math.random() * 2 - 1) * (1 - i / data.length); }
                    noise.buffer = buffer;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
                    const g = envAD(padMaster, time, 0.002, 0.7, 0.6, 0.0001);
                    noise.connect(hp).connect(g);
                    // light stereo spread
                    const d = ac.createDelay(1.0); d.delayTime.value = 0.02; const gd = ac.createGain(); gd.gain.value = 0.12; const p = ac.createStereoPanner(); p.pan.value = 0.4;
                    g.connect(d).connect(gd).connect(p).connect(padMaster);
                    noise.start(time);
                    noise.stop(time + 0.9);
                }
                function playRide(time) {
                    // combine metallic partials + short noise burst
                    const g = envAD(padMaster, time, 0.002, 0.5, 0.55, 0.0001);
                    const freqs = [6000, 8000, 10000, 12000];
                    freqs.forEach((f, idx) => {
                        const osc = ac.createOscillator(); osc.type = 'square'; osc.frequency.value = f;
                        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 12;
                        osc.connect(bp).connect(g);
                        osc.start(time); osc.stop(time + 0.4 + idx * 0.02);
                    });
                    const noise = ac.createBufferSource();
                    const buffer = ac.createBuffer(1, ac.sampleRate * 0.08, ac.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < data.length; i++) { data[i] = Math.random() * 2 - 1; }
                    noise.buffer = buffer;
                    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 9000;
                    const g2 = envAD(padMaster, time, 0.002, 0.08, 0.3, 0.0001);
                    noise.connect(hp).connect(g2);
                    noise.start(time);
                    noise.stop(time + 0.08);
                }
                function playClap(time) {
                    const makeBurst = (offset) => {
                        const noise = ac.createBufferSource();
                        const buffer = ac.createBuffer(1, ac.sampleRate * 0.06, ac.sampleRate);
                        const data = buffer.getChannelData(0);
                        for (let i = 0; i < data.length; i++) { data[i] = (Math.random() * 2 - 1) * (1 - i / data.length); }
                        noise.buffer = buffer;
                        const hp = ac.createBiquadFilter();
                        hp.type = 'highpass';
                        hp.frequency.value = 1500;
                        const g = envAD(padMaster, time + offset, 0.004, 0.11, 1.05, 0.0001);
                        noise.connect(hp).connect(g);
                        noise.start(time + offset);
                        noise.stop(time + offset + 0.06);
                    };
                    makeBurst(0);
                    makeBurst(0.015);
                    makeBurst(0.03);
                }
                
                // Add click event to test effect creation
                effectsCanvas.addEventListener('click', (e) => {
                    console.log('Canvas clicked, creating test effect');
                    createEffect('a');
                });
            </script>
        </body>
        </html>`;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeBGM extension is now active!');

    // 注册左侧边栏视图
    const provider = new CodebgmSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CodebgmSidebarProvider.viewId, provider)
    );
}

export function deactivate() {
    if (MusicPlayerPanel.currentPanel) {
        MusicPlayerPanel.currentPanel.dispose();
    }
}