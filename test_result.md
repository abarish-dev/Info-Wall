#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## user_problem_statement: "Info Wall BLE LED matrix controller — add Planes Overhead live nearby-flights, live Matrix Preview, Auto-Countdown Clear, and ESP32 firmware draw code."

## backend:
##   - task: "GET /api/flights/nearby — live aircraft via adsb.lol proxy + airline logo resolution"
##     implemented: true
##     working: true
##     file: "backend/server.py, backend/airlines.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: true
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "New endpoint proxies adsb.lol /v2/lat/{lat}/lon/{lon}/dist/{nm}. Converts radius miles->nm, resolves 3-letter ICAO callsign prefix to airline name + gstatic IATA logo url, sorts by distance, returns top 15. Verified via curl near JFK (66 flights, logos 200 OK)."

## frontend:
##   - task: "Planes Overhead section — live nearby flights card with airline logos"
##     implemented: true
##     working: true
##     file: "frontend/src/components/PlanesOverhead.tsx, frontend/src/services/flights.ts, frontend/app/index.tsx"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: true
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Section uses resolved Weather zip coords + search radius. Auto-refresh 25s, refresh button, logo fallback to airplane icon, empty/error/no-location states. Smoke-verified: reached feed near Mooresville (empty at 3mi = correct empty state)."
##   - task: "Live Matrix Preview — settings-driven auto-cycling frames"
##     implemented: true
##     working: true
##     file: "frontend/app/matrix-preview.tsx, frontend/app/index.tsx (preview-button)"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: true
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Reads matrix_settings_v2, builds frames only for enabled modules, cycles with hold/fade timing, honors brightness dimming + pin. Play/pause + prev/next + dots. Opened via tv icon in hero. Smoke-verified: 6 frames incl Mooresville weather."
##   - task: "Auto-Countdown Clear — clears travel countdown after trip date passes"
##     implemented: true
##     working: true
##     file: "frontend/app/index.tsx"
##     stuck_count: 0
##     priority: "low"
##     needs_retesting: true
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Effect on hydrate + countdownDate change: if days-remaining < 0, clears countdownDate + countdownLabel and shows an info toast."

## metadata:
##   created_by: "main_agent"
##   version: "1.1"
##   test_sequence: 1

## test_plan:
##   current_focus:
##     - "GET /api/flights/nearby — live aircraft via adsb.lol proxy + airline logo resolution"
##     - "Planes Overhead section — live nearby flights card with airline logos"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"

## agent_communication:
##   - agent: "main"
##     message: "Added Planes Overhead (new backend endpoint + frontend card), Live Matrix Preview, Auto-Countdown Clear, and fleshed out ESP32 firmware (not testable here). Please test the backend endpoint thoroughly (valid coords, busy area like JFK 40.6413/-73.7781 radius 25, invalid coords, radius clamping) and the frontend Planes Overhead + Preview flows. BLE is mocked in preview (native-only) — do not test BLE connect."

## Updates (round 10 — ticker verification, TV episode highlights, profiles UI)
## backend:
##   - task: "GET /api/tickers/verify — validate stock/ETF symbols (Yahoo Finance)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Comma-separated symbols; per-symbol {valid,name,exchange,type}. valid=true/false/null(network). Cached 1 day (definitive only). curl: AAPL/VOO/TSLA valid, ZZZZZ invalid."
##   - task: "GET /api/tv/search & /api/tv/status — TVmaze show search + release highlights"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "search returns simplified shows (name/year/status/network/image/imdb). status (pipe-separated names) returns highlight new|soon|returning|between|ended|unknown + label + nextAirdate. curl: Ted Lasso 'New episode Sep 30', Breaking Bad 'Series ended', bogus 'unknown'. Cached 1h."
## frontend:
##   - task: "Financial Tickers — StockRows with live verification, blocks invalid symbols"
##     implemented: true
##     working: true
##     file: "frontend/src/components/StockRows.tsx, frontend/src/services/catalog.ts, frontend/app/index.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Per-slot verify (debounced), green check + company name for valid, red 'Unknown symbol — blocked' for invalid, amber for unverified. Only valid symbols pushed via validStocks state. Smoke-verified: AAPL/MSFT valid, ZZZZZ blocked."
##   - task: "TV Shows — ShowRows search picker + episode highlights"
##     implemented: true
##     working: true
##     file: "frontend/src/components/ShowRows.tsx, frontend/app/index.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Replaced free-text with TVmaze search modal (poster/year/network). Each show shows poster + highlight pill. Smoke-verified: Shrinking 'Between seasons', Emily in Paris 'Returns Dec 24', Ted Lasso 'New episode Sep 30'."
##   - task: "Wall Profiles UI — relabel + fix clipped button"
##     implemented: true
##     working: true
##     file: "frontend/src/components/SettingsSheet.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Moved New Wall / Copy Current buttons out of the horizontal scroll into a fixed row (no longer clipped), relabeled, added explanation line. Smoke-verified."

## agent_communication:
##   - agent: "main"
##     message: "Round 10: Added ticker verification (blocks invalid), TVmaze show picker + episode highlights, fixed Wall Profiles UI. Please test the 3 new backend endpoints (tickers/verify, tv/search, tv/status) and the frontend Stocks validation (valid green / invalid red-blocked), TV show search+add+highlights, and the Settings > Wall Profiles buttons. BLE mocked (native-only) — skip BLE."

## Updates (round 11 — live prices, episodes, new-episode badge, team highlights)
## backend:
##   - task: "GET /api/tickers/quotes — live price + daily change (Yahoo chart)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Per symbol {price,prevClose,change,changePct,currency}, 60s cache. curl: AAPL +1.53%, TSLA -1.54%."
##   - task: "GET /api/tv/episodes?id= — upcoming+recent episodes & season info (TVmaze)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Returns {name,status,network,seasons,totalEpisodes,upcoming[<=8],recent[<=4]}. tv/status now also returns show id. curl id=44458 → 4 seasons."
##   - task: "GET /api/teams/status — next/live game highlight (ESPN nextEvent)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Pipe-separated LEAGUE:ABBR → {highlight live|today|soon|upcoming|recent|offseason,label,opponent,date,logo}. curl NYY 'Sep 27 vs BAL', CAR 'Sep 27 @ CLE'."
## frontend:
##   - task: "Live stock prices in StockRows + BLE payload + preview"
##     implemented: true
##     working: true
##     file: "frontend/src/components/StockRows.tsx, frontend/app/index.tsx, frontend/app/matrix-preview.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Valid symbols show price + colored ▲/▼ change (60s refresh). onQuotes lifts to index → stocks push includes priceN/chgN. Preview stocks frame shows price. Smoke: AAPL 341.07 +1.53%, MSFT 516.17 +3.66%."
##   - task: "Tap a show for episodes modal"
##     implemented: true
##     working: true
##     file: "frontend/src/components/ShowRows.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Tapping a show row opens a modal with seasons/episodes/network/IMDb + upcoming/recent episode list. Smoke: Shrinking modal opened."
##   - task: "New-episode badge in header + shared useShowStatuses hook"
##     implemented: true
##     working: true
##     file: "frontend/app/index.tsx, frontend/src/hooks/useShowStatuses.ts"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Badge shows count when any tracked show airs today (highlight 'new'); tapping opens TV section. Statuses shared with ShowRows (single fetch). No 'new today' shows in default set so badge hidden — logic verified, no crash."
##   - task: "Team game highlights in TeamRows"
##     implemented: true
##     working: true
##     file: "frontend/src/components/TeamPicker.tsx"
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Each team row shows a pill (Live/Today/date vs|@ opponent). Smoke: Yankees 'Sep 27 vs BAL', Panthers 'Sep 27 @ CLE'."

## agent_communication:
##   - agent: "main"
##     message: "Round 11: live stock prices, tap-show-for-episodes, new-episode header badge, team game highlights. Test 3 new backend endpoints (tickers/quotes, tv/episodes, teams/status) and frontend: stock price display, episodes modal (tap show-1-row → episodes-close), team pills, badge logic. Fixed a TDZ crash (useShowStatuses moved after settings). BLE mocked (native) — skip."
