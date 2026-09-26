# ICAO (3-letter) airline code -> display name + IATA (2-letter) code.
# Used to resolve a broadcast callsign (e.g. "DAL520" -> Delta Air Lines, IATA "DL")
# to a human-readable airline name and a Google Flights logo.
# Covers US majors/regionals plus large international carriers; unknown codes
# fall back to a generic plane icon in the app.

AIRLINES = {
    # --- US mainline ---
    "AAL": {"name": "American Airlines", "iata": "AA"},
    "DAL": {"name": "Delta Air Lines", "iata": "DL"},
    "UAL": {"name": "United Airlines", "iata": "UA"},
    "SWA": {"name": "Southwest Airlines", "iata": "WN"},
    "JBU": {"name": "JetBlue", "iata": "B6"},
    "ASA": {"name": "Alaska Airlines", "iata": "AS"},
    "NKS": {"name": "Spirit Airlines", "iata": "NK"},
    "FFT": {"name": "Frontier Airlines", "iata": "F9"},
    "HAL": {"name": "Hawaiian Airlines", "iata": "HA"},
    "SCX": {"name": "Sun Country", "iata": "SY"},
    "AAY": {"name": "Allegiant Air", "iata": "G4"},
    # --- US regional / cargo ---
    "SKW": {"name": "SkyWest", "iata": "OO"},
    "ENY": {"name": "Envoy Air", "iata": "MQ"},
    "RPA": {"name": "Republic Airways", "iata": "YX"},
    "EDV": {"name": "Endeavor Air", "iata": "9E"},
    "JIA": {"name": "PSA Airlines", "iata": "OH"},
    "ASH": {"name": "Mesa Airlines", "iata": "YV"},
    "FDX": {"name": "FedEx Express", "iata": "FX"},
    "UPS": {"name": "UPS Airlines", "iata": "5X"},
    "GTI": {"name": "Atlas Air", "iata": "5Y"},
    # --- Canada / Mexico ---
    "ACA": {"name": "Air Canada", "iata": "AC"},
    "WJA": {"name": "WestJet", "iata": "WS"},
    "JZA": {"name": "Air Canada Jazz", "iata": "QK"},
    "AMX": {"name": "Aeromexico", "iata": "AM"},
    "VOI": {"name": "Volaris", "iata": "Y4"},
    # --- Europe ---
    "BAW": {"name": "British Airways", "iata": "BA"},
    "VIR": {"name": "Virgin Atlantic", "iata": "VS"},
    "DLH": {"name": "Lufthansa", "iata": "LH"},
    "AFR": {"name": "Air France", "iata": "AF"},
    "KLM": {"name": "KLM", "iata": "KL"},
    "EIN": {"name": "Aer Lingus", "iata": "EI"},
    "RYR": {"name": "Ryanair", "iata": "FR"},
    "EZY": {"name": "easyJet", "iata": "U2"},
    "IBE": {"name": "Iberia", "iata": "IB"},
    "SWR": {"name": "SWISS", "iata": "LX"},
    "AUA": {"name": "Austrian Airlines", "iata": "OS"},
    "SAS": {"name": "SAS", "iata": "SK"},
    "TAP": {"name": "TAP Air Portugal", "iata": "TP"},
    "THY": {"name": "Turkish Airlines", "iata": "TK"},
    "AZA": {"name": "ITA Airways", "iata": "AZ"},
    "VLG": {"name": "Vueling", "iata": "VY"},
    "WZZ": {"name": "Wizz Air", "iata": "W6"},
    "FIN": {"name": "Finnair", "iata": "AY"},
    "NAX": {"name": "Norwegian", "iata": "DY"},
    "BEL": {"name": "Brussels Airlines", "iata": "SN"},
    # --- Middle East / Asia / Oceania ---
    "UAE": {"name": "Emirates", "iata": "EK"},
    "QTR": {"name": "Qatar Airways", "iata": "QR"},
    "ETD": {"name": "Etihad Airways", "iata": "EY"},
    "SVA": {"name": "Saudia", "iata": "SV"},
    "ELY": {"name": "El Al", "iata": "LY"},
    "SIA": {"name": "Singapore Airlines", "iata": "SQ"},
    "CPA": {"name": "Cathay Pacific", "iata": "CX"},
    "ANA": {"name": "All Nippon Airways", "iata": "NH"},
    "JAL": {"name": "Japan Airlines", "iata": "JL"},
    "KAL": {"name": "Korean Air", "iata": "KE"},
    "AAR": {"name": "Asiana Airlines", "iata": "OZ"},
    "CCA": {"name": "Air China", "iata": "CA"},
    "CES": {"name": "China Eastern", "iata": "MU"},
    "CSN": {"name": "China Southern", "iata": "CZ"},
    "AIC": {"name": "Air India", "iata": "AI"},
    "QFA": {"name": "Qantas", "iata": "QF"},
    "ANZ": {"name": "Air New Zealand", "iata": "NZ"},
    "THA": {"name": "Thai Airways", "iata": "TG"},
    # --- Latin America ---
    "LAN": {"name": "LATAM", "iata": "LA"},
    "TAM": {"name": "LATAM Brasil", "iata": "JJ"},
    "AZU": {"name": "Azul", "iata": "AD"},
    "GLO": {"name": "GOL", "iata": "G3"},
    "AVA": {"name": "Avianca", "iata": "AV"},
    "CMP": {"name": "Copa Airlines", "iata": "CM"},
}


def resolve_airline(callsign: str):
    """Return {name, iata} for a callsign's 3-letter ICAO prefix, or None."""
    if not callsign:
        return None
    prefix = callsign[:3].upper()
    if len(prefix) == 3 and prefix.isalpha():
        return AIRLINES.get(prefix)
    return None
