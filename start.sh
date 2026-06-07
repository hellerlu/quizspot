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

# --- Step 2: Get local IP (multiple fallbacks for Termux/Android) ---

# Method 1: wlan0 interface (most common on Android)
IP=$(ip addr show wlan0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -1)

# Method 2: any non-loopback, non-dummy IPv4 interface
if [ -z "$IP" ]; then
    IP=$(ip addr show 2>/dev/null \
        | awk '/inet / && !/127\.0\.0\.1/ {print $2}' \
        | cut -d/ -f1 | head -1)
fi

# Method 3: ip route src field
if [ -z "$IP" ]; then
    IP=$(ip route 2>/dev/null | awk '/src/ {print $NF}' | grep -v '^169\.' | head -1)
fi

# Method 4: hostname -I
if [ -z "$IP" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

# Give up
if [ -z "$IP" ]; then
    IP="<could-not-detect-ip>"
fi

HOST_URL="http://$IP:$PORT/host.html"
TV_URL="http://$IP:$PORT/tv.html"
PLAYER_URL="http://$IP:$PORT/"

# --- Step 3: Display endpoints ---
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "  ${BOLD}📡 Server will be available at:${RESET}"
echo ""
echo -e "  ${MAGENTA}🎮 Host   →${RESET}  ${BOLD}$HOST_URL${RESET}"
echo -e "  ${CYAN}📺 TV     →${RESET}  ${BOLD}$TV_URL${RESET}"
echo -e "  ${GREEN}👥 Player →${RESET}  ${BOLD}$PLAYER_URL${RESET}"
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# --- Step 4: Copy Host URL to clipboard ---
if command -v termux-clipboard-set &> /dev/null; then
    echo "$HOST_URL" | termux-clipboard-set
    echo -e "${GREEN}📋 Host URL copied to clipboard!${RESET}"
    echo -e "${DIM}   $HOST_URL${RESET}"
else
    echo -e "${YELLOW}⚠  termux-clipboard-set not found. Install termux-api: pkg install termux-api${RESET}"
    echo -e "${DIM}   Host URL: $HOST_URL${RESET}"
fi

echo ""
echo -e "${YELLOW}▶  Starting QuizSpot server... ${DIM}(Ctrl+C to stop)${RESET}"
echo ""

# --- Step 5: Start the server (in background so trap can catch Ctrl+C) ---
node server.js &
SERVER_PID=$!

# Wait for the server process — the trap will fire on Ctrl+C
wait $SERVER_PID
