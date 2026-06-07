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

# --- Step 2: Get local IP ---
IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')

# Fallback: try hostname -I
if [ -z "$IP" ]; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

# Final fallback
if [ -z "$IP" ]; then
    IP="<your-phone-ip>"
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

# --- Step 5: Start the server ---
node server.js
