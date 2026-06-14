#!/data/data/com.termux/files/usr/bin/bash

# =========================================
#  QuizSpot - Termux Launcher
# =========================================

PORT=3000

# --- Colors ---
RESET='\033[0m'
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
RED='\033[0;31m'

# --- Parse arguments ---
LOCAL_ONLY=false
for arg in "$@"; do
    case $arg in
        --local-only|-l)
        LOCAL_ONLY=true
        shift
        ;;
    esac
done

if [ "$LOCAL_ONLY" = "false" ]; then
    # Check if cloudflared is installed
    if ! command -v cloudflared &>/dev/null; then
        echo -e "${RED}${BOLD}✘ Error: 'cloudflared' is required for Online Mode but not found.${RESET}"
        echo -e "${YELLOW}👉 Install it in Termux using:${RESET}  ${BOLD}pkg install cloudflared${RESET}"
        echo -e "${YELLOW}👉 Or run locally using:${RESET}        ${BOLD}./start.sh --local-only${RESET}"
        echo ""
        exit 1
    fi
fi

# --- Shutdown handler ---
shutdown() {
    echo ""
    echo -e "${RED}${BOLD}⛔ Shutting down QuizSpot...${RESET}"

    # Kill the node server if it's running
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID"
        wait "$SERVER_PID" 2>/dev/null
        echo -e "${GREEN}✔ Server stopped.${RESET}"
    fi

    # Release wake lock
    if command -v termux-wake-unlock &>/dev/null; then
        termux-wake-unlock
        echo -e "${GREEN}✔ Wake lock released.${RESET}"
    fi

    echo -e "${DIM}Goodbye! 👋${RESET}"
    echo ""
    exit 0
}

# Trap Ctrl+C (SIGINT) and kill signals (SIGTERM)
trap shutdown SIGINT SIGTERM

clear

echo -e "${CYAN}${BOLD}"
echo "  ██████╗ ██╗   ██╗██╗███████╗███████╗██████╗  ██████╗ ████████╗"
echo "  ██╔═══██╗██║   ██║██║╚══███╔╝██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝"
echo "  ██║   ██║██║   ██║██║  ███╔╝ ███████╗██████╔╝██║   ██║   ██║   "
echo "  ██║▄▄ ██║██║   ██║██║ ███╔╝  ╚════██║██╔═══╝ ██║   ██║   ██║   "
echo "  ╚██████╔╝╚██████╔╝██║███████╗███████║██║     ╚██████╔╝   ██║   "
echo "   ╚══▀▀═╝  ╚═════╝ ╚═╝╚══════╝╚══════╝╚═╝      ╚═════╝    ╚═╝   "
echo -e "${RESET}"

# --- Step 1: Acquire wake lock ---
echo -e "${YELLOW}⚡ Acquiring wake lock...${RESET}"
if command -v termux-wake-lock &> /dev/null; then
    termux-wake-lock
    echo -e "${GREEN}✔ Wake lock acquired. Screen-off won't kill the server.${RESET}"
else
    echo -e "${YELLOW}⚠  termux-wake-lock not found. Install termux-api if needed: pkg install termux-api${RESET}"
fi

echo ""

# --- Step 2: Get local IP via Node.js (bypasses Android netlink restrictions) ---
IP=$(node -e "
const os = require('os');
const nets = os.networkInterfaces();
let found = '';
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      // Prefer hotspot range
      if (!found || net.address.startsWith('192.168.43.')) {
        found = net.address;
      }
    }
  }
}
console.log(found);
" 2>/dev/null)

# Fallback: prompt the user
if [ -z "$IP" ]; then
    echo -e "${YELLOW}⚠  Could not detect IP automatically.${RESET}"
    echo -e "${DIM}   Android hotspot IP is usually: 192.168.43.1${RESET}"
    echo -ne "${BOLD}   Enter your IP manually: ${RESET}"
    read -r IP
fi

HOST_URL="http://$IP:$PORT/host.html"
TV_URL="http://$IP:$PORT/tv.html"
PLAYER_URL="http://$IP:$PORT/"

# --- Step 3: Install dependencies if missing ---
if [ ! -d "node_modules" ] || [ ! -d "node_modules/express" ]; then
    echo -e "${YELLOW}📦 Installing dependencies (first run or missing modules)...${RESET}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}${BOLD}  ✘ npm install failed. Check your connection and try again.${RESET}"
        exit 1
    fi
    echo -e "${GREEN}✔ Dependencies installed.${RESET}"
    echo ""
fi

echo ""
echo -e "${YELLOW}▶  Starting QuizSpot server...${RESET}"
echo ""

# --- Step 5: Start the server, passing --local-only if set ---
if [ "$LOCAL_ONLY" = "true" ]; then
    node server.js --local-only &
else
    node server.js &
fi
SERVER_PID=$!

# Poll until port is open (max 8 seconds)
READY=0
for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    # Use Node to check if our port is accepting connections
    node -e "
const net = require('net');
const c = net.connect($PORT, '127.0.0.1', () => { c.destroy(); process.exit(0); });
c.on('error', () => process.exit(1));
" 2>/dev/null && READY=1 && break
done

if [ "$READY" -eq 1 ]; then
    # Copy Host URL to clipboard now that we know server is live
    if command -v termux-clipboard-set &>/dev/null; then
        echo "$HOST_URL" | termux-clipboard-set
    fi

    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${GREEN}${BOLD}  ✔ Server is live! Open a link below to start:${RESET}"
    echo ""
    if [ "$LOCAL_ONLY" = "true" ]; then
        echo -e "  ${YELLOW}🌐 Mode   →${RESET}  ${BOLD}Offline / Local-only${RESET}"
    else
        echo -e "  ${YELLOW}🌐 Mode   →${RESET}  ${BOLD}Online (Cloudflare Tunnel active)${RESET}"
    fi
    echo -e "  ${MAGENTA}🎮 Host   →${RESET}  ${BOLD}$HOST_URL${RESET}"
    echo -e "  ${CYAN}📺 TV     →${RESET}  ${BOLD}$TV_URL${RESET}"
    echo -e "  ${GREEN}👥 Player →${RESET}  ${BOLD}$PLAYER_URL${RESET}"
    echo ""
    if command -v termux-clipboard-set &>/dev/null; then
        echo -e "  ${DIM}📋 Host URL copied to clipboard${RESET}"
        echo ""
    fi
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${DIM}  Press Ctrl+C to stop the server${RESET}"
    echo ""
else
    echo -e "${RED}${BOLD}  ✘ Server failed to start! Check errors above.${RESET}"
    echo ""
fi

# Wait for the server process — the trap will fire on Ctrl+C
wait $SERVER_PID
