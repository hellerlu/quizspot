const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const isLocalOnly = process.argv.includes('--local-only') || process.env.LOCAL_ONLY === 'true';
let cloudflaredProcess = null;

const DATA_DIR = path.join(__dirname, 'data');
let currentQuizFile = 'quiz.json';

function getQuizName(filename) {
    const base = path.basename(filename, '.json');
    return base
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to disable caching for HTML files and API routes
// This prevents browsers (especially Chrome on Android) from storing offline snapshots
// which can result in broken fonts and stale views when the device has no global internet connection.
app.use((req, res, next) => {
    const isHtml = req.path.endsWith('.html') || req.path === '/' || req.path === '';
    const isApi = req.path.startsWith('/api/');
    if (isHtml || isApi) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Helper to get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Check for IPv4 and non-internal loopback addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading config.json:', e.message);
    }
    return {};
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
        console.error('Error writing config.json:', e.message);
    }
}

// REST APIs for Quiz Management
app.get('/api/quizzes', (req, res) => {
    fs.readdir(DATA_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read data directory' });
        }
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        const quizzes = jsonFiles.map(file => {
            let questionCount = 0;
            try {
                const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                    questionCount = parsed.length;
                }
            } catch (e) {
                console.error(`Error reading ${file} question count`, e.message);
            }
            return {
                filename: file,
                name: getQuizName(file),
                questionCount
            };
        });
        res.json({ quizzes, activeQuizFile: currentQuizFile });
    });
});

app.get('/api/quiz', (req, res) => {
    const activeQuizPath = path.join(DATA_DIR, currentQuizFile);
    fs.readFile(activeQuizPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read quiz data' });
        }
        try {
            res.json(JSON.parse(data));
        } catch (e) {
            res.status(500).json({ error: 'Invalid quiz JSON content' });
        }
    });
});

app.post('/api/quiz', (req, res) => {
    const newQuiz = req.body;
    if (!Array.isArray(newQuiz)) {
        return res.status(400).json({ error: 'Quiz must be an array of questions' });
    }
    const activeQuizPath = path.join(DATA_DIR, currentQuizFile);
    fs.writeFile(activeQuizPath, JSON.stringify(newQuiz, null, 2), 'utf8', (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to save quiz data' });
        }
        // If we are in lobby state, refresh questions
        if (gameSession.state === 'LOBBY') {
            gameSession.questions = newQuiz;
        }
        res.json({ success: true, message: 'Quiz saved successfully' });
    });
});

app.post('/api/quiz/select', (req, res) => {
    const { filename } = req.body;
    if (!filename || !filename.endsWith('.json')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const targetPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'Quiz file not found' });
    }
    fs.readFile(targetPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read selected quiz' });
        }
        try {
            const parsed = JSON.parse(data);
            if (!Array.isArray(parsed)) {
                return res.status(400).json({ error: 'Quiz content is not a valid array' });
            }
            currentQuizFile = filename;
            gameSession.questions = parsed;
            gameSession.quizName = getQuizName(filename);
            // Reset state back to lobby if game hasn't started or is over
            if (gameSession.state !== 'QUESTION_INTRO' && gameSession.state !== 'QUESTION_ACTIVE') {
                gameSession.state = 'LOBBY';
                gameSession.currentQuestionIndex = -1;
            }
            broadcastState();
            res.json({ success: true, message: 'Quiz selected successfully' });
        } catch (e) {
            res.status(500).json({ error: 'Invalid quiz JSON content' });
        }
    });
});

app.post('/api/quiz/new', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Quiz name is required' });
    }
    
    let safeName = name.toLowerCase().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    if (!safeName || safeName === '_') {
        safeName = 'new_quiz';
    }
    
    let filename = `${safeName}.json`;
    let targetPath = path.join(DATA_DIR, filename);
    
    let counter = 1;
    while (fs.existsSync(targetPath)) {
        filename = `${safeName}_${counter}.json`;
        targetPath = path.join(DATA_DIR, filename);
        counter++;
    }
    
    const defaultTemplate = [
        {
            id: Date.now(),
            question: 'New Trivia Question',
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctIndex: 0,
            timeLimit: 20,
            image: ''
        }
    ];
    
    fs.writeFile(targetPath, JSON.stringify(defaultTemplate, null, 2), 'utf8', (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to create quiz file' });
        }
        currentQuizFile = filename;
        gameSession.questions = defaultTemplate;
        gameSession.quizName = name.trim();
        gameSession.state = 'LOBBY';
        gameSession.currentQuestionIndex = -1;
        broadcastState();
        res.json({ success: true, filename, name: name.trim(), questions: defaultTemplate });
    });
});

app.post('/api/upload', (req, res) => {
    const { name, data } = req.body;
    if (!name || !data) {
        return res.status(400).json({ error: 'Missing file name or data' });
    }
    
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const ext = path.extname(name) || '.png';
    const baseName = path.basename(name, ext).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${Date.now()}_${baseName}${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    
    const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
    
    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) {
            console.error('File write error:', err);
            return res.status(500).json({ error: 'Failed to save uploaded image' });
        }
        res.json({ success: true, url: `/uploads/${fileName}` });
    });
});

app.get('/api/ip', (req, res) => {
    res.json({ ip: getLocalIP(), port: PORT });
});

const config = loadConfig();

// Single Active Game Session state
let gameSession = {
    pin: '',
    state: 'LOBBY', // LOBBY, QUESTION_INTRO, QUESTION_ACTIVE, QUESTION_LEADERBOARD, GAME_OVER
    questions: [],
    currentQuestionIndex: -1,
    players: {}, // socketId -> { id, name, avatar, score, lastAnswerCorrect, scoreChange, answerIndex, answerTime }
    questionStartTime: 0,
    timerId: null,
    timeRemaining: 0,
    getReadyDuration: 4, // default transition time in seconds
    publicUrl: null,
    wifi: {
        ssid: config.wifi ? (config.wifi.ssid || '') : '',
        password: config.wifi ? (config.wifi.password || '') : '',
        security: config.wifi ? (config.wifi.security || 'WPA') : 'WPA'
    }
};

// Load initial quiz
try {
    const activeQuizPath = path.join(DATA_DIR, currentQuizFile);
    const quizData = fs.readFileSync(activeQuizPath, 'utf8');
    gameSession.questions = JSON.parse(quizData);
    gameSession.quizName = getQuizName(currentQuizFile);
} catch (e) {
    console.error('Failed to load default quiz.json', e.message);
    gameSession.questions = [];
    gameSession.quizName = 'Default Trivia Pack';
}

// Generate random PIN
function generatePIN() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
gameSession.pin = generatePIN();

function broadcastState() {
    // Sanitize players info (remove socket details if any, return list)
    const playerList = Object.values(gameSession.players).map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        lastAnswerCorrect: p.lastAnswerCorrect,
        scoreChange: p.scoreChange,
        hasAnswered: p.answerIndex !== null,
        answerIndex: (gameSession.state === 'QUESTION_LEADERBOARD' || gameSession.state === 'GAME_OVER') ? p.answerIndex : null,
        connected: p.connected
    }));

    // Sort leaderboard for TV
    const leaderboard = [...playerList].sort((a, b) => b.score - a.score);

    const payload = {
        pin: gameSession.pin,
        state: gameSession.state,
        quizName: gameSession.quizName || 'Default Trivia Pack',
        currentQuestionIndex: gameSession.currentQuestionIndex,
        totalQuestions: gameSession.questions.length,
        players: playerList,
        leaderboard: leaderboard,
        timeRemaining: gameSession.timeRemaining,
        hostIP: getLocalIP(),
        hostPort: PORT,
        publicUrl: gameSession.publicUrl,
        getReadyDuration: gameSession.getReadyDuration,
        wifi: gameSession.wifi
    };

    if (gameSession.currentQuestionIndex >= 0 && gameSession.currentQuestionIndex < gameSession.questions.length) {
        const q = gameSession.questions[gameSession.currentQuestionIndex];
        // Strip correct answer for players during active question!
        payload.currentQuestion = {
            question: q.question,
            options: q.options,
            timeLimit: q.timeLimit,
            image: q.image || '',
            // Only send correct index in intro/leaderboard states
            correctIndex: (gameSession.state === 'QUESTION_LEADERBOARD' || gameSession.state === 'GAME_OVER') ? q.correctIndex : null
        };
    }

    io.emit('game-state', payload);
}

// End the active question and transition to leaderboard
function endQuestion() {
    if (gameSession.timerId) {
        clearInterval(gameSession.timerId);
        gameSession.timerId = null;
    }
    
    gameSession.state = 'QUESTION_LEADERBOARD';
    
    const q = gameSession.questions[gameSession.currentQuestionIndex];
    const correctIdx = q.correctIndex;
    const timeLimitLimit = q.timeLimit * 1000;

    // Process scores for this question
    Object.values(gameSession.players).forEach(player => {
        if (player.answerIndex !== null && player.answerIndex === correctIdx) {
            // Calculate speed score decay: 1000 down to 500
            const elapsed = player.answerTime - gameSession.questionStartTime;
            const ratio = Math.min(Math.max(elapsed / timeLimitLimit, 0), 1);
            const points = Math.round(1000 * (1 - ratio * 0.5));
            
            player.scoreChange = points;
            player.score += points;
            player.lastAnswerCorrect = true;
        } else {
            player.scoreChange = 0;
            player.lastAnswerCorrect = false;
        }
    });

    broadcastState();
}

function startTimer(seconds) {
    if (gameSession.timerId) {
        clearInterval(gameSession.timerId);
    }
    gameSession.timeRemaining = seconds;
    broadcastState();

    gameSession.timerId = setInterval(() => {
        gameSession.timeRemaining--;
        if (gameSession.timeRemaining <= 0) {
            endQuestion();
        } else {
            io.emit('timer-tick', gameSession.timeRemaining);
        }
    }, 1000);
}

function startIntroTimer(seconds) {
    if (gameSession.timerId) {
        clearInterval(gameSession.timerId);
    }
    gameSession.timeRemaining = seconds;
    broadcastState();

    gameSession.timerId = setInterval(() => {
        gameSession.timeRemaining--;
        if (gameSession.timeRemaining <= 0) {
            clearInterval(gameSession.timerId);
            gameSession.timerId = null;
            startActiveQuestion();
        } else {
            io.emit('timer-tick', gameSession.timeRemaining);
        }
    }, 1000);
}

function startActiveQuestion() {
    gameSession.state = 'QUESTION_ACTIVE';
    gameSession.questionStartTime = Date.now();
    
    // Reset answer markers
    Object.values(gameSession.players).forEach(player => {
        player.answerIndex = null;
        player.answerTime = null;
    });

    const q = gameSession.questions[gameSession.currentQuestionIndex];
    startTimer(q.timeLimit);
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('update-settings', (settings) => {
        if (settings) {
            if (typeof settings.getReadyDuration === 'number') {
                gameSession.getReadyDuration = Math.max(1, Math.min(10, settings.getReadyDuration));
            }
            if (settings.wifi) {
                gameSession.wifi = {
                    ssid: typeof settings.wifi.ssid === 'string' ? settings.wifi.ssid.trim() : '',
                    password: typeof settings.wifi.password === 'string' ? settings.wifi.password.trim() : '',
                    security: typeof settings.wifi.security === 'string' ? settings.wifi.security : 'WPA'
                };
                // Save Wi-Fi config to local config.json file
                saveConfig({ wifi: gameSession.wifi });
            }
            broadcastState();
        }
    });

    // Send current game state upon connection
    socket.emit('init-state', {
        ip: getLocalIP(),
        port: PORT
    });
    broadcastState();

    // Player Joins
    socket.on('join-game', ({ pin, name, avatar }) => {
        if (pin !== gameSession.pin) {
            return socket.emit('join-error', 'Invalid PIN Code.');
        }
        if (gameSession.state !== 'LOBBY') {
            return socket.emit('join-error', 'Game has already started.');
        }
        
        // Prevent duplicate names
        const nameExists = Object.values(gameSession.players).some(p => p.name.toLowerCase() === name.toLowerCase());
        if (nameExists) {
            return socket.emit('join-error', 'Nickname already taken.');
        }

        const playerId = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        gameSession.players[playerId] = {
            id: playerId,
            socketId: socket.id,
            name: name,
            avatar: avatar,
            score: 0,
            lastAnswerCorrect: false,
            scoreChange: 0,
            answerIndex: null,
            answerTime: null,
            connected: true
        };

        socket.emit('join-success', { playerId, name, avatar });
        broadcastState();
    });

    // Player Re-joins (Reconnection)
    socket.on('rejoin-game', ({ playerId, pin }) => {
        if (pin !== gameSession.pin) {
            return socket.emit('join-error', 'Invalid PIN Code.');
        }
        const player = gameSession.players[playerId];
        if (!player) {
            return socket.emit('join-error', 'Session not found. Please join again.');
        }

        // Update active socket and connection status
        player.socketId = socket.id;
        player.connected = true;
        socket.join(gameSession.pin);

        socket.emit('join-success', { 
            playerId, 
            name: player.name, 
            avatar: player.avatar,
            answerIndex: player.answerIndex 
        });
        broadcastState();
    });

    // Player submits answer
    socket.on('submit-answer', (answerIndex) => {
        const player = Object.values(gameSession.players).find(p => p.socketId === socket.id);
        if (!player) return;
        if (gameSession.state !== 'QUESTION_ACTIVE') return;
        if (player.answerIndex !== null) return; // Only allow one submission

        player.answerIndex = answerIndex;
        player.answerTime = Date.now();

        socket.emit('answer-accepted');

        // Check if all connected players have answered
        const connectedPlayers = Object.values(gameSession.players).filter(p => p.connected);
        const allAnswered = connectedPlayers.length > 0 && connectedPlayers.every(p => p.answerIndex !== null);
        if (allAnswered) {
            endQuestion();
        } else {
            broadcastState(); // Broadcast updated 'hasAnswered' count
        }
    });

    // Host kicks a player
    socket.on('kick-player', (playerId) => {
        const player = gameSession.players[playerId];
        if (player) {
            console.log(`Kicking player: ${player.name}`);
            
            // Notify the player socket if they are connected
            if (player.socketId) {
                const playerSocket = io.sockets.sockets.get(player.socketId);
                if (playerSocket) {
                    playerSocket.emit('kicked');
                    playerSocket.leave(gameSession.pin);
                }
            }
            
            // Remove the player completely
            delete gameSession.players[playerId];

            // If in active question, check if all remaining connected players have answered
            if (gameSession.state === 'QUESTION_ACTIVE') {
                const connectedPlayers = Object.values(gameSession.players).filter(p => p.connected);
                if (connectedPlayers.length > 0 && connectedPlayers.every(p => p.answerIndex !== null)) {
                    endQuestion();
                }
            }

            broadcastState();
        }
    });

    // Host aborts the game
    socket.on('abort-game', () => {
        console.log('Aborting active game session...');
        if (gameSession.timerId) {
            clearInterval(gameSession.timerId);
            gameSession.timerId = null;
        }

        gameSession.state = 'LOBBY';
        gameSession.currentQuestionIndex = -1;
        gameSession.timeRemaining = 0;

        // Reset player scores and answers
        Object.values(gameSession.players).forEach(player => {
            player.score = 0;
            player.lastAnswerCorrect = false;
            player.scoreChange = 0;
            player.answerIndex = null;
            player.answerTime = null;
        });

        broadcastState();
    });

    // Host Admin actions
    socket.on('start-game', () => {
        if (gameSession.state !== 'LOBBY') return;
        if (gameSession.questions.length === 0) return;
        
        // Reset player scores
        Object.values(gameSession.players).forEach(player => {
            player.score = 0;
            player.lastAnswerCorrect = false;
            player.scoreChange = 0;
            player.answerIndex = null;
            player.answerTime = null;
        });

        gameSession.currentQuestionIndex = 0;
        gameSession.state = 'QUESTION_INTRO';
        startIntroTimer(gameSession.getReadyDuration);
    });

    socket.on('next-question', () => {
        if (gameSession.state !== 'QUESTION_LEADERBOARD') return;
        
        if (gameSession.currentQuestionIndex + 1 < gameSession.questions.length) {
            gameSession.currentQuestionIndex++;
            gameSession.state = 'QUESTION_INTRO';
            startIntroTimer(gameSession.getReadyDuration);
        } else {
            gameSession.state = 'GAME_OVER';
            broadcastState();
        }
    });

    socket.on('play-again', () => {
        if (gameSession.state !== 'GAME_OVER') return;
        
        gameSession.state = 'LOBBY';
        gameSession.currentQuestionIndex = -1;
        // Keep the same PIN code: gameSession.pin stays the same
        
        // Keep players but reset scores and answers
        Object.values(gameSession.players).forEach(player => {
            player.score = 0;
            player.lastAnswerCorrect = false;
            player.scoreChange = 0;
            player.answerIndex = null;
            player.answerTime = null;
        });
        
        broadcastState();
    });

    socket.on('disconnect', () => {
        const player = Object.values(gameSession.players).find(p => p.socketId === socket.id);
        if (player) {
            console.log(`Player disconnected: ${player.name}`);
            
            if (gameSession.state === 'LOBBY') {
                // Remove player completely if disconnected during lobby
                delete gameSession.players[player.id];
            } else {
                // Keep player in session but mark offline
                player.connected = false;
                player.socketId = null;
            }
            
            // If in active question, check if all remaining connected players have answered
            if (gameSession.state === 'QUESTION_ACTIVE') {
                const connectedPlayers = Object.values(gameSession.players).filter(p => p.connected);
                if (connectedPlayers.length > 0 && connectedPlayers.every(p => p.answerIndex !== null)) {
                    endQuestion();
                }
            }
            broadcastState();
        }
    });
});

function startTunnel() {
    if (isLocalOnly) {
        console.log(` Running in Offline/Local-only mode.`);
        return;
    }

    console.log(` Starting Cloudflare Tunnel...`);
    cloudflaredProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`]);

    cloudflaredProcess.stderr.on('data', (data) => {
        const line = data.toString();
        // Cloudflare quick tunnel pattern: https://xxxx.trycloudflare.com
        const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
            gameSession.publicUrl = match[0];
            console.log(`=========================================`);
            console.log(` Cloudflare Tunnel Active!`);
            console.log(` Web Join URL: ${gameSession.publicUrl}`);
            console.log(`=========================================`);
            broadcastState();
        }
    });

    cloudflaredProcess.on('close', (code) => {
        if (code !== 0 && cloudflaredProcess) {
            console.log(` Cloudflare tunnel process exited with code ${code}`);
        }
        gameSession.publicUrl = null;
        broadcastState();
    });

    cloudflaredProcess.on('error', (err) => {
        console.error(` Failed to start cloudflared tunnel:`, err.message);
        console.log(` Note: Ensure 'cloudflared' is installed on the system ("pkg install cloudflared" in Termux).`);
        gameSession.publicUrl = null;
        broadcastState();
    });
}

function cleanupTunnel() {
    if (cloudflaredProcess) {
        console.log('Stopping Cloudflare tunnel...');
        cloudflaredProcess.kill('SIGINT');
        cloudflaredProcess = null;
    }
}

// Exit handlers to clean up tunnel
process.on('SIGINT', () => {
    cleanupTunnel();
    process.exit(0);
});

process.on('SIGTERM', () => {
    cleanupTunnel();
    process.exit(0);
});

process.on('exit', () => {
    cleanupTunnel();
});

server.listen(PORT, () => {
    console.log(`=========================================`);
    if (isLocalOnly) {
        console.log(` QuizSpot Server Running Offline!`);
    } else {
        console.log(` QuizSpot Server Running Online & Offline!`);
    }
    console.log(` Host URL:   http://localhost:${PORT}/host.html`);
    console.log(` TV URL:     http://${getLocalIP()}:${PORT}/tv.html`);
    console.log(` Player URL: http://${getLocalIP()}:${PORT}/`);
    if (!isLocalOnly) {
        console.log(` Web URL:    Waiting for Cloudflare Tunnel...`);
    }
    console.log(`=========================================`);
    
    startTunnel();
});

