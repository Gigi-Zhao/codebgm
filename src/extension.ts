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
    private _isManuallyPaused: boolean = false;
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
                    
                    gainNode.gain.setValueAtTime(0.1, ac.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.3);
                    
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