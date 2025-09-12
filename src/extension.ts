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
    private _minDuration: number = 5000; // 最短持续时间（毫秒）
    private _currentAudio: string | undefined;
    private _playlists: { [key: string]: string[] } = {
        'deep_focus': [
            'Since TMRW 始于明天 - 从忧伤到忧伤.mp3',
            'Since TMRW 始于明天 - Love You.mp3'
        ],
        'energy': [
            'Since TMRW 始于明天 - 自己骗自己.mp3'
        ],
        'creative': [
            'Since TMRW 始于明天 - 幻象.mp3'
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
    private _minDuration: number = 5000;
    private _currentMode: string = 'deep_focus';
    private _playlists: { [key: string]: string[] } = {
        'deep_focus': [
            'Since TMRW 始于明天 - 从忧伤到忧伤.mp3',
            'Since TMRW 始于明天 - Love You.mp3'
        ],
        'energy': [
            'Since TMRW 始于明天 - 自己骗自己.mp3'
        ],
        'creative': [
            'Since TMRW 始于明天 - 幻象.mp3'
        ]
    };

    constructor(private readonly context: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
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
                this._playRandomTrack(this._currentMode);
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
            }
        });
        this.context.subscriptions.push(disposable);
    }

    private _analyzeTypingPattern() {
        if (this._keystrokes.length < 2) { return; }
        let intervals: number[] = [];
        for (let i = 1; i < this._keystrokes.length; i++) {
            intervals.push(this._keystrokes[i] - this._keystrokes[i - 1]);
        }
        let avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        let variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
        let now = Date.now();
        if (now - this._lastSwitchTime < this._minDuration) { return; }

        let newMode = 'deep_focus';
        if (avg < 200) { newMode = 'energy'; }
        else if (variance > 50000) { newMode = 'creative'; }

        if (newMode !== this._currentMode) {
            this._currentMode = newMode;
            this._lastSwitchTime = now;
            this._playRandomTrack(newMode);
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
                <canvas id="viz"></canvas>
                <audio id="audio" crossorigin="anonymous"></audio>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const audio = document.getElementById('audio');
                const toggle = document.getElementById('toggle');
                const modeEl = document.getElementById('mode');
                const canvas = document.getElementById('viz');
                const ctx = canvas.getContext('2d');
                
                // Set canvas size
                function resizeCanvas() {
                    const rect = canvas.getBoundingClientRect();
                    canvas.width = rect.width * window.devicePixelRatio;
                    canvas.height = rect.height * window.devicePixelRatio;
                }
                resizeCanvas();
                window.addEventListener('resize', resizeCanvas);

                let started = false;
                let ac, analyser, src;

                function ensureAudioContext() {
                    if(ac) return;
                    ac = new (window.AudioContext || window.webkitAudioContext)();
                    analyser = ac.createAnalyser();
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
                        } else {
                            audio.pause();
                            toggle.textContent = '播放';
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
                    }
                });

                audio.addEventListener('ended', () => {
                    vscode.postMessage({ command: 'audioEnded' });
                    toggle.textContent = '播放';
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