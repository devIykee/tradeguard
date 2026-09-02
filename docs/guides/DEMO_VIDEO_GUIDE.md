# TradeGuard Demo Video Guide (Claude Code)

**Target: 2-3 minute video showing TradeGuard blocking risky trades**

---

## ✅ Setup Complete

- Binance MCP server: Connected to `/home/iyke` project
- TradeGuard hook: Installed at `/home/iyke/.claude/hooks/tradeguard.json`
- Hook verification: Tested and working (blocks 10x leverage, blocks DOGEUSDT)

---

## Recording Setup (WSL → Windows)

Since you're on WSL, record on the **Windows side** using:

### Option 1: Windows Game Bar (Built-in, Easiest)
1. Press `Win + G` on Windows
2. Click the record button (red circle icon)
3. Records your whole screen
4. Saves to `C:\Users\[username]\Videos\Captures\`

### Option 2: OBS Studio (Better Quality)
1. Download: https://obsproject.com/download (Windows version)
2. Install and open OBS
3. Sources → Add → Display Capture → select your monitor
4. Settings → Output → Recording Quality → High
5. Click "Start Recording"
6. Saves to `C:\Users\[username]\Videos\` by default

### Option 3: Windows Terminal Built-in Recording
If using Windows Terminal to access WSL:
1. Right-click Windows Terminal tab → Settings
2. Profile → Advanced → Screen recording (if available in your version)

---

## Demo Script (2-3 minutes)

### Scene 1: Introduction (20 seconds)

**What to show:** Open browser → https://github.com/devIykee/tradeguard

**What to say/type as caption:**
```
TradeGuard: Pre-flight validator for Binance Agent OS

Blocks risky trades BEFORE execution.

Key feature: catches agent's hallucinated prices.

Let me show you 3 blocked scenarios.
```

---

### Scene 2: Start Claude Code (15 seconds)

**In Windows Terminal (or your terminal app):**

```bash
cd /home/iyke
claude
```

**Wait for Claude Code to start.** You'll see the prompt.

**Type:**
```
I want to test some Binance trades. TradeGuard should validate them.
```

---

### Scene 3: Scenario 1 - Excessive Leverage (30 seconds)

**Type in Claude Code:**
```
Open a 10x leveraged long position on BTCUSDT, quantity 0.01 BTC
```

**What happens:**
1. Claude processes the request
2. Tries to call Binance MCP `place_order` tool
3. **TradeGuard hook fires and blocks it**
4. Claude shows you: "Permission denied: Leverage 10x exceeds max allowed 5x"

**Pause for 2-3 seconds** so viewers can read the denial message.

**Caption overlay (add in video editing):**
```
❌ BLOCKED: Leverage 10x > 5x limit
TradeGuard stopped this before reaching Binance
```

---

### Scene 4: Scenario 2 - Symbol Not Whitelisted (30 seconds)

**Type in Claude Code:**
```
Buy 100 DOGE at market price on Binance spot
```

**What happens:**
1. Claude tries to place order for DOGEUSDT
2. **TradeGuard blocks it**
3. Denial: "Symbol 'DOGEUSDT' not in whitelist. Allowed: btcusdt, ethusdt, bnbusdt"

**Pause again** for viewers to read.

**Caption overlay:**
```
❌ BLOCKED: DOGE not in whitelist
Only BTC, ETH, BNB allowed
```

---

### Scene 5: Scenario 3 - Price Deviation (THE KEY FEATURE) (45 seconds)

**Type in Claude Code:**
```
What's the current BTCUSDT price?
```

Claude fetches it (e.g., "$65,432").

**Then type:**
```
Place a limit buy for 0.01 BTC at $72,000
```

**What happens:**
1. Claude calculates: $72,000 is ~10% above market ($65,432)
2. Tries to place order
3. **PriceDeviationRule blocks it**
4. Denial: "Proposed price $72,000 deviates 10.0% from live market $65,432 (max allowed 2.0%)"

**This is the star of the demo** — pause for 4-5 seconds here.

**Caption overlay:**
```
❌ BLOCKED: Price 10% off market (THE DIFFERENTIATOR)

TradeGuard fetches live price from Binance API
Catches stale/hallucinated prices
No competitor implements this check ⭐
```

---

### Scene 6: Valid Trade (Passes Validation) (30 seconds)

**Type in Claude Code:**
```
Buy 0.0001 BTC at current market price on Binance spot
```

**What happens:**
1. Checks: leverage=1 ✅, symbol=BTCUSDT ✅, size<$1000 ✅, price=market ✅
2. **TradeGuard allows it**
3. Claude proceeds to call Binance MCP tool
4. **Binance's own confirmation prompt appears**
5. You see: "Confirm trade: Buy 0.0001 BTC at $65,432? [yes/no]"

**DON'T confirm it** — just show that it reached Binance's step.

**Type:** `no` (decline the trade)

**Caption overlay:**
```
✅ PASSED TradeGuard validation
✅ Reached Binance's confirmation (2nd check)

Two independent safety layers:
1. TradeGuard (deterministic rules)
2. Binance's human confirm
```

---

### Scene 7: Show the Hook Config (15 seconds)

**Type in Claude Code or terminal:**
```bash
cat /home/iyke/.claude/hooks/tradeguard.json
```

**Show the hook config file** so viewers see it's a real integration.

**Caption overlay:**
```
TradeGuard runs as a PreToolUse hook
Intercepts tool calls before execution
Agent cannot bypass via reasoning
```

---

### Scene 8: Show Risk Rules Config (15 seconds)

**Type:**
```bash
cat /home/iyke/coding/tradeguard/config/risk-rules.json
```

**Show the config:**
```json
{
  "maxLeverage": 5,
  "maxOrderSizeUSDT": 1000,
  "maxPriceDeviationPct": 2.0,
  "allowedSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
}
```

**Caption overlay:**
```
All thresholds config-driven
No hardcoded values in code
User can customize per risk tolerance
```

---

### Scene 9: Conclusion (15 seconds)

**Show GitHub repo again:** https://github.com/devIykee/tradeguard

**Scroll through the README** quickly.

**Caption overlay:**
```
TradeGuard
✅ 4 risk rules, 61 tests passing
✅ 4,730+ lines of documentation
✅ SOLID principles enforced
✅ MIT licensed, production-ready

Built for Binance Agent OS Mini Hackathon 2026
Track A: Trading Workflows

github.com/devIykee/tradeguard
```

---

## Exact Commands to Run (Copy-Paste Ready)

Open Windows Terminal → WSL → run these in order:

```bash
# 1. Start recording on Windows (Win + G or open OBS first)

# 2. Open browser to GitHub
# https://github.com/devIykee/tradeguard

# 3. Start Claude Code
cd /home/iyke
claude

# In Claude Code, paste these one at a time, wait for response:

# --- Scenario 1: Leverage ---
Open a 10x leveraged long position on BTCUSDT, quantity 0.01 BTC

# --- Scenario 2: Whitelist ---
Buy 100 DOGE at market price on Binance spot

# --- Scenario 3: Price Deviation (THE KEY FEATURE) ---
What's the current BTCUSDT price?
# [wait for response, then:]
Place a limit buy for 0.01 BTC at $72,000

# --- Scenario 4: Valid trade ---
Buy 0.0001 BTC at current market price on Binance spot
# [when Binance asks to confirm, type:] no

# --- Show configs ---
exit
cat /home/iyke/.claude/hooks/tradeguard.json
cat /home/iyke/coding/tradeguard/config/risk-rules.json

# 4. Back to browser → scroll through README

# 5. Stop recording (Win + G or OBS Stop button)
```

---

## After Recording

### 1. Find your video file

**Game Bar:** `C:\Users\[username]\Videos\Captures\*.mp4`  
**OBS:** `C:\Users\[username]\Videos\*.mkv` or `*.mp4`

### 2. Edit (Optional but Recommended)

Use any free tool:
- **Windows Photos app** (built-in, simple trimming)
- **DaVinci Resolve** (free, professional): https://www.blackmagicdesign.com/products/davinciresolve
- **Shotcut** (free, simple): https://shotcut.org

**Add these overlays:**
- Text captions for each scenario (as written above)
- Highlight the denial messages (red box or arrow)
- Zoom in on the config files when showing them

### 3. Compress if needed

If file is >512 MB (Twitter limit):

**In WSL:**
```bash
# Install ffmpeg
sudo apt update && sudo apt install ffmpeg -y

# Copy video from Windows to WSL
cp /mnt/c/Users/YOUR_USERNAME/Videos/Captures/tradeguard-demo.mp4 /tmp/

# Compress to <512 MB
ffmpeg -i /tmp/tradeguard-demo.mp4 -vcodec h264 -b:v 1.5M -acodec aac /tmp/tradeguard-demo-compressed.mp4

# Copy back to Windows
cp /tmp/tradeguard-demo-compressed.mp4 /mnt/c/Users/YOUR_USERNAME/Videos/
```

### 4. Upload to Twitter/X

**Tweet text:**
```
TradeGuard: Pre-flight validator for @Binance Agent OS 🛡️

Blocks risky trades BEFORE execution with deterministic rules.

⭐ Key: catches agent's hallucinated prices by comparing against live market data

✅ 4 risk rules, 61 tests
✅ Harness-layer enforcement
✅ 4,730+ lines of docs
✅ Works with any MCP agent

💻 github.com/devIykee/tradeguard

#BinanceAgentOS #TrackA
```

**Video:** Upload your edited MP4

### 5. Submit to Hackathon

1. Follow @Binance on X
2. Find hackathon announcement tweet
3. Repost it (quote repost with your video)
4. Copy your tweet URL: `https://twitter.com/YOUR_USERNAME/status/1234567890`
5. Fill the Google Form with that URL

---

## Troubleshooting

**If Claude says "I don't have access to Binance MCP":**
```bash
# Check connection
claude mcp list
# Should show: binance-mcp-server
```

**If TradeGuard doesn't block:**
```bash
# Verify hook is registered
cat /home/iyke/.claude/hooks/tradeguard.json
# Should show the PreToolUse hook

# Test manually
echo '{"tool_name":"mcp__binance-mcp-server__place_order","tool_input":{"symbol":"BTCUSDT","leverage":10},"session_id":"test","tool_use_id":"test","hook_event_name":"PreToolUse"}' | node /home/iyke/coding/tradeguard/bin/validate-trade.js
# Should return: "permissionDecision": "deny"
```

**If price deviation doesn't block:**
The live price might actually be close to your proposed price. Use a more extreme example:
```
Place a limit buy for 0.01 BTC at $100,000
```
(Assuming current price is ~$65k, this will definitely trigger the 2% rule)

---

## Ready?

1. **Start recording on Windows** (Win + G or OBS)
2. **Run the demo script above**
3. **Stop recording**
4. **Edit & upload**

Good luck with the demo! 🎥
