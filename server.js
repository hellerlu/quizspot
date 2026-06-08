const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
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
    wifi: {
        ssid: '',
        password: '',
        security: 'WPA'
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
        answerIndex: (gameSession.state === 'QUESTION_LEADERBOARD' || gameSession.state === 'GAME_OVER') ? p.answerIndex : null
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
    Object.keys(gameSession.players).forEach(socketId => {
        const player = gameSession.players[socketId];
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
    Object.keys(gameSession.players).forEach(socketId => {
        const player = gameSession.players[socketId];
        player.answerIndex = null;
        player.answerTime = null;
    });

    const q = gameSession.questions[gameSession.currentQuestionIndex];
    startTimer(q.timeLimit);
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Update session settings
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

        gameSession.players[socket.id] = {
            id: socket.id,
            name: name,
            avatar: avatar,
            score: 0,
            lastAnswerCorrect: false,
            scoreChange: 0,
            answerIndex: null,
            answerTime: null
        };

        socket.emit('join-success', { name, avatar });
        broadcastState();
    });

    // Player submits answer
    socket.on('submit-answer', (answerIndex) => {
        const player = gameSession.players[socket.id];
        if (!player) return;
        if (gameSession.state !== 'QUESTION_ACTIVE') return;
        if (player.answerIndex !== null) return; // Only allow one submission

        player.answerIndex = answerIndex;
        player.answerTime = Date.now();

        socket.emit('answer-accepted');

        // Check if all players have answered
        const allAnswered = Object.values(gameSession.players).every(p => p.answerIndex !== null);
        if (allAnswered) {
            endQuestion();
        } else {
            broadcastState(); // Broadcast updated 'hasAnswered' count
        }
    });

    // Host Admin actions
    socket.on('start-game', () => {
        if (gameSession.state !== 'LOBBY') return;
        if (gameSession.questions.length === 0) return;
        
        // Reset player scores
        Object.keys(gameSession.players).forEach(socketId => {
            const player = gameSession.players[socketId];
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
        gameSession.pin = generatePIN();
        // Keep players but reset scores
        Object.keys(gameSession.players).forEach(socketId => {
            const player = gameSession.players[socketId];
            player.score = 0;
            player.lastAnswerCorrect = false;
            player.scoreChange = 0;
            player.answerIndex = null;
            player.answerTime = null;
        });
        
        broadcastState();
    });

    socket.on('disconnect', () => {
        if (gameSession.players[socket.id]) {
            console.log(`Player disconnected: ${gameSession.players[socket.id].name}`);
            delete gameSession.players[socket.id];
            
            // If in active question, check if all remaining players have answered
            if (gameSession.state === 'QUESTION_ACTIVE') {
                const activePlayers = Object.values(gameSession.players);
                if (activePlayers.length > 0 && activePlayers.every(p => p.answerIndex !== null)) {
                    endQuestion();
                }
            }
            broadcastState();
        }
    });
});

server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(` QuizSpot Server Running Offline!`);
    console.log(` Host URL: http://localhost:${PORT}`);
    console.log(` Player/TV URL: http://${getLocalIP()}:${PORT}`);
    console.log(`=========================================`);
});
