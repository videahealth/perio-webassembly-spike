#!/usr/bin/env python3
"""
Command Normalizer for Perio Charting Voice Commands
Parses raw transcripts and normalizes them into structured perio charting commands.
"""

import re
from typing import Optional
from dataclasses import dataclass
from enum import Enum


class CommandType(Enum):
    START = "start"
    TRIPLET = "triplet"
    REPEAT = "repeat"
    JUMP = "jump"
    UNDO = "undo"
    PAUSE = "pause"
    RESUME = "resume"
    BLEEDING = "bleeding"
    SUPPURATION = "suppuration"
    FURCATION = "furcation"
    PLAQUE = "plaque"
    MOBILITY = "mobility"
    SAVE = "save"
    CALCULUS = "calculus"
    SKIP = "skip"
    MISSING = "missing"
    MODE_SWITCH = "mode_switch"
    UNKNOWN = "unknown"


# Number word mappings
NUMBER_WORDS = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "won": "1", "want": "1",
    "two": "2", "to": "2", "too": "2", "tu": "2",
    "three": "3", "tree": "3", "free": "3", "grade": "3",
    "four": "4", "for": "4", "fore": "4", "floor": "4",
    "five": "5", "fife": "5",
    "six": "6", "sex": "6", "sicks": "6",
    "seven": "7",
    "eight": "8", "ate": "8", "ait": "8",
    "nine": "9", "niner": "9", "mine": "9",
    "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13",
    "fourteen": "14", "fifteen": "15", "sixteen": "16", "seventeen": "17",
    "eighteen": "18", "nineteen": "19", "twenty": "20", "twenty-one": "21",
    "twenty one": "21", "twenty-two": "22", "twenty two": "22",
    "twenty-three": "23", "twenty three": "23", "twenty-four": "24",
    "twenty four": "24", "twenty-five": "25", "twenty five": "25",
    "twenty-six": "26", "twenty six": "26", "twenty-seven": "27",
    "twenty seven": "27", "twenty-eight": "28", "twenty eight": "28",
    "twenty-nine": "29", "twenty nine": "29", "thirty": "30",
    "thirty-one": "31", "thirty one": "31", "thirty-two": "32",
    "thirty two": "32",
}

# Surface mappings - includes common STT mishearings
SURFACE_KEYWORDS = {
    # Facial
    "facial": "facial",
    "facile": "facial",
    "facia": "facial",
    # Lingual
    "lingual": "lingual",
    "lingua": "lingual",
    "linguall": "lingual",
    "single": "lingual",  # common mishearing
    "tingle": "lingual",  # common mishearing
    "mingle": "lingual",  # common mishearing
    "linguine": "lingual",
    # Buccal  
    "buccal": "buccal",
    "buckle": "buccal",
    "buckall": "buccal",
    "buckel": "buccal",
    "buckol": "buccal",
    "vocal": "buccal",  # common mishearing
    "local": "buccal",  # common mishearing
    "bugle": "buccal",
    "bubble": "buccal",
    # Distal
    "distal": "distal",
    "distill": "distal",
    "distant": "distal",
    "pistol": "distal",
    "thistle": "distal",
    # Mesial
    "mesial": "mesial",
    "me see all": "mesial",
    "mesoile": "mesial",
    "medial": "mesial",
    "me seal": "mesial",
    "measle": "mesial",
    # Center (mid)
    "center": "center",
    "mid": "center",
    "middle": "center",
    # Interproximal
    "interproximal": "interproximal",
    "inter proximal": "interproximal",
    "inner proximal": "interproximal",
    # All
    "all": "all",
}

# Severity mappings
SEVERITY_KEYWORDS = {
    "light": "light",
    "mild": "light",
    "medium": "medium",
    "moderate": "medium",
    "severe": "severe",
    "heavy": "severe",
}

# Grade mappings
GRADE_KEYWORDS = {
    "grade 1": 1, "grade one": 1, "grade1": 1, "1": 1, "one": 1,
    "grade 2": 2, "grade two": 2, "grade2": 2, "2": 2, "two": 2,
    "grade 3": 3, "grade three": 3, "grade3": 3, "3": 3, "three": 3,
    "grade 4": 4, "grade four": 4, "grade4": 4, "4": 4, "four": 4,
}

# Mode mappings for mode switch commands
MODE_KEYWORDS = {
    "recession": "recession",
    "receding": "recession",
    "reception": "recession",  # common Vosk mishearing of "recession"
    "gingival margin": "gm",
    "gm": "gm",
    "gingival": "gm",
    "probing depth": "pd",
    "pd": "pd",
    "pocket depth": "pd",
    "probing": "pd",
    "mucogingival junction": "mgj",
    "mucogingival": "mgj",
    "mgj": "mgj",
}


def normalize_text(text: str) -> str:
    """Normalize text for easier parsing."""
    text = text.lower().strip()
    # Remove punctuation except hyphens
    text = re.sub(r'[^\w\s-]', '', text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text)
    return text


def extract_numbers_from_text(text: str) -> list[str]:
    """Extract numbers from text, converting words to digits.

    Uses word-boundary matching so that prepositions like "to" are only
    converted when they appear as standalone number-words, not as part of
    "jump to" navigation phrases.  Ambiguous short words ("to", "for")
    that commonly appear as prepositions are excluded — use
    extract_numbers_from_text_greedy() for triplet parsing instead.
    """
    text = normalize_text(text)

    # Strip navigation/command prefixes so "jump to 15" -> "15"
    text = re.sub(r'\b(jump|jumped|go|move|skip|on)\b', '', text)

    # Use word-boundary replacement, skipping ambiguous prepositions
    ambiguous = {"to", "too", "for", "fore", "won", "want", "o"}
    for word, digit in sorted(NUMBER_WORDS.items(), key=lambda x: -len(x[0])):
        if word in ambiguous:
            continue
        text = re.sub(r'\b' + re.escape(word) + r'\b', digit, text)

    # Extract all digit sequences
    digit_matches = re.findall(r'\d+', text)
    return digit_matches


def _digits_from_text(text: str) -> list[str]:
    """Extract individual digit characters from *text* (already normalised)."""
    return [ch for run in re.findall(r'\d+', text) for ch in run]


def _flush_triplets(digits: list[str]) -> list[str]:
    """Form as many complete triplets as possible, return them. Mutates *digits* in-place."""
    out: list[str] = []
    while len(digits) >= 3:
        out.append(digits[0] + digits[1] + digits[2])
        del digits[:3]
    return out


def parse_triplets(text: str) -> list[str]:
    """
    Parse one or more triplet measurements from text.
    Supports multiple back-to-back triplets (e.g., "3 3 3 4 2 3" -> ["333", "423"]).
    Incomplete trailing digits are discarded (e.g., "3 3 3 4 2" -> ["333"]).

    Comma/period boundaries are respected: a segment with 3+ digits is treated as
    complete triplets and resets any carry buffer from prior incomplete segments.
    This prevents mis-grouping when the STT model splits a triplet across a comma
    (e.g. "2 2, 2 2, 2 1 2" -> ["222", "212"] not ["222", "12..."]).

    Returns a list of triplet strings (each 3 digits). Empty list if no triplets found.
    """
    # Split on delimiters BEFORE normalize_text strips punctuation.
    segments = re.split(r'[,.\-;]+', text)

    ambiguous = {"won", "want", "o"}

    def _normalize_segment(seg: str) -> str:
        seg = normalize_text(seg)
        for word, digit in sorted(NUMBER_WORDS.items(), key=lambda x: -len(x[0])):
            if word in ambiguous:
                continue
            seg = re.sub(r'\b' + re.escape(word) + r'\b', digit, seg)
        return seg

    triplets: list[str] = []
    carry: list[str] = []

    for raw_seg in segments:
        seg = _normalize_segment(raw_seg)
        digits = _digits_from_text(seg)
        if not digits:
            continue
        if len(digits) >= 3:
            triplets.extend(_flush_triplets(carry))
            carry.clear()
            triplets.extend(_flush_triplets(digits))
            carry = digits  # any 1-2 leftover digits
        else:
            carry.extend(digits)
            triplets.extend(_flush_triplets(carry))

    # Final flush
    triplets.extend(_flush_triplets(carry))
    return triplets


def parse_triplet(text: str) -> Optional[dict]:
    """
    Parse a single triplet measurement command.
    For backwards compatibility; returns the first triplet found.
    """
    triplets = parse_triplets(text)
    if triplets:
        return {"command": "triplet", "measurements": triplets[0]}
    return None


def parse_tooth_number(text: str) -> Optional[int]:
    """Extract a tooth number (1-32) from text."""
    numbers = extract_numbers_from_text(text)
    for num_str in numbers:
        try:
            num = int(num_str)
            if 1 <= num <= 32:
                return num
        except ValueError:
            continue
    return None


def parse_surface(text: str) -> Optional[str]:
    """Extract surface (facial/lingual/buccal) from text."""
    text = normalize_text(text)
    surface_values = {"facial", "lingual", "buccal"}
    for keyword, surface in SURFACE_KEYWORDS.items():
        if keyword in text and surface in surface_values:
            return surface
    return None


def parse_site(text: str) -> Optional[str]:
    """Extract site (mesial/center/distal/interproximal/all) from text."""
    text = normalize_text(text)
    site_values = {"mesial", "center", "distal", "interproximal", "all"}
    for keyword, surface in SURFACE_KEYWORDS.items():
        if keyword in text and surface in site_values:
            return surface
    return None


def parse_severity(text: str) -> Optional[str]:
    """Extract severity level from text."""
    text = normalize_text(text)
    for keyword, severity in SEVERITY_KEYWORDS.items():
        if keyword in text:
            return severity
    return None


def parse_grade(text: str) -> Optional[int]:
    """Extract grade level from text."""
    text = normalize_text(text)
    for keyword, grade in sorted(GRADE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if keyword in text:
            return grade
    return None


def parse_target(text: str) -> Optional[dict]:
    """
    Parse the target specification (tooth, all, quadrant).
    Returns a dict with type and optional number.
    """
    text = normalize_text(text)

    # Check for "all"
    if " all" in text or text.startswith("all"):
        return {"type": "all"}

    # Check for quadrant
    quadrant_match = re.search(r'quadrant\s*(\d|one|two|three|four)', text)
    if quadrant_match:
        quad_str = quadrant_match.group(1)
        if quad_str in NUMBER_WORDS:
            quad_str = NUMBER_WORDS[quad_str]
        quad_num = int(quad_str)
        if 1 <= quad_num <= 4:
            return {"type": "quadrant", "number": quad_num}

    # Check for tooth number
    tooth_num = parse_tooth_number(text)
    if tooth_num:
        return {"type": "tooth", "number": tooth_num}
    
    return None


def parse_condition_command(text: str, condition_type: str) -> Optional[dict]:
    """Parse a condition command (bleeding, suppuration, furcation, plaque, mobility)."""
    text = normalize_text(text)

    # In condition commands, "to"/"too" always means tooth 2, never a
    # preposition (unlike "jump to" where it's navigation).
    text = re.sub(r'\bto\b', 'two', text)
    text = re.sub(r'\btoo\b', 'two', text)

    result = {"command": condition_type}
    
    # Parse target
    target = parse_target(text)
    if target:
        if target["type"] == "tooth":
            result["tooth_number"] = target["number"]
        else:
            result["target"] = target
    
    # Parse surface and site (for bleeding, suppuration, furcation)
    if condition_type in ["bleeding", "suppuration", "furcation"]:
        surface = parse_surface(text)
        if surface:
            result["surface"] = surface
        site = parse_site(text)
        if site:
            result["site"] = site
        elif "tooth_number" in result and "target" not in result:
            # Default to "all" sites for single tooth
            result["site"] = "all"
    
    # Parse grade (for furcation)
    if condition_type == "furcation":
        grade = parse_grade(text)
        if grade:
            result["grade"] = grade
        else:
            # Furcation requires a grade, so this is invalid
            return None
    
    # Parse severity (for plaque)
    if condition_type == "plaque":
        severity = parse_severity(text)
        if severity:
            result["severity"] = severity
        else:
            # Plaque requires severity, so this is invalid
            return None
    
    # Parse mobility grade
    if condition_type == "mobility":
        grade = parse_grade(text)
        if grade and grade <= 3:
            result["grade"] = grade
        else:
            # Mobility requires a grade (1-3), so this is invalid
            return None
    
    return result


def parse_missing_command(text: str) -> Optional[dict]:
    """Parse a missing tooth command. Supports single tooth, range, or current."""
    text = normalize_text(text)
    result = {"command": "missing"}

    # Convert number words to digits, keeping "to" as literal for range detection
    converted = text
    ambiguous = {"to", "too", "for", "fore", "won", "want", "o"}
    for word, digit in sorted(NUMBER_WORDS.items(), key=lambda x: -len(x[0])):
        if word in ambiguous:
            continue
        converted = re.sub(r'\b' + re.escape(word) + r'\b', digit, converted)

    # Check for range: "missing 1 to 5" / "missing one to five"
    # Also handle "listening" (Vosk mishearing of "missing")
    range_match = re.search(r'(?:missing|listening)\s+.*?(\d+)\s+to\s+(\d+)', converted)
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        if 1 <= start <= 32 and 1 <= end <= 32:
            result["range_start"] = start
            result["range_end"] = end
            return result

    # Check for single tooth number
    tooth_num = parse_tooth_number(text)
    if tooth_num:
        result["tooth_number"] = tooth_num

    return result


def parse_mode_switch(text: str) -> Optional[dict]:
    """Parse a mode switch command: begin/jump + mode name."""
    text = normalize_text(text)
    result = {"command": "mode_switch"}

    # Determine origin: "begin" = start from tooth 1, "jump" = stay at current
    if re.search(r'\b(begin|start|new|chart)\b', text):
        result["origin"] = "begin"
    else:
        result["origin"] = "jump"

    # Determine mode (check longest phrases first)
    for keyword, mode in sorted(MODE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if keyword in text:
            result["mode"] = mode
            return result

    return None  # No mode found — invalid


def normalize_command(transcript: str) -> Optional[dict]:
    """
    Main function to normalize a transcript into a structured command.
    Returns None if the transcript doesn't match any known command.
    """
    text = normalize_text(transcript)
    
    if not text:
        return None
    
    # === Mode Switch ===
    # Must be checked before generic start/save to avoid "begin" collision.
    # Two-step: unambiguous mode keywords first, then begin/jump + short alias.
    if re.search(r'\b(recession|receding|reception|gingival margin|gingival|probing depth|pocket depth|mucogingival junction|mucogingival|mgj)\b', text):
        mode_cmd = parse_mode_switch(text)
        if mode_cmd:
            return mode_cmd
    if re.search(r'\b(begin|start|chart|jump)\b', text) and re.search(r'\b(gm|pd|mgj)\b', text):
        mode_cmd = parse_mode_switch(text)
        if mode_cmd:
            return mode_cmd

    # === Control Commands ===

    # Start command
    if re.search(r'\b(start|begin|new chart)\b', text):
        return {"command": "start"}
    
    # Save command
    if re.search(r'\b(save|save chart|finish|done|complete)\b', text):
        return {"command": "save"}
    
    # Undo command
    if re.search(r'\b(undo|cancel last|take back|go back)\b', text):
        return {"command": "undo"}
    
    # Pause command
    if re.search(r'\b(pause|stop listening|hold|wait)\b', text):
        return {"command": "pause"}
    
    # Resume command
    if re.search(r'\b(resume|continue|go on|keep going|start again)\b', text):
        return {"command": "resume"}
    
    # Repeat command (optionally followed by a single number for count)
    repeat_match = re.search(r'\b(repeat|same|again|ditto)\b', text)
    if repeat_match:
        result = {"command": "repeat"}
        after = text[repeat_match.end():].strip()
        if after:
            count_match = re.match(r'\b(\d+)\b', after)
            if count_match:
                result["count"] = int(count_match.group(1))
            else:
                first_word = after.split()[0].lower()
                if first_word in NUMBER_WORDS:
                    result["count"] = int(NUMBER_WORDS[first_word])
        # Check if there are measurements to repeat with
        triplet = parse_triplet(text)
        if triplet:
            result["measurements"] = triplet["measurements"]
        return result
    
    # === Skip / Next ===
    # Guard against "skip to" (jump) and "cancel last" (undo)
    if re.search(r'\b(skip|next)\b', text) and not re.search(r'\b(skip to|cancel last)\b', text):
        return {"command": "skip"}

    # === Jump Commands ===

    if re.search(r'\b(jump|jumped|go to|move to|skip to)\b', text):
        result = {"command": "jump"}
        tooth_num = parse_tooth_number(text)
        if tooth_num:
            result["tooth_number"] = tooth_num
        
        # Check for side specification (including buccal as facial synonym)
        surface = parse_surface(text)
        if surface:
            # Map surface to side for jump command
            if surface in ("facial", "buccal"):
                result["side"] = "buccal" if surface == "buccal" else "facial"
            elif surface in ("lingual",):
                result["side"] = "lingual"
        
        if "tooth_number" in result:
            return result
        return None
    
    # === Missing ===
    # "listening" is a common Vosk mishearing of "missing"
    if re.search(r'\b(missing|listening)\b', text):
        return parse_missing_command(text)

    # === Condition Commands ===
    # (patterns include common STT mishearings)

    # Bleeding
    if re.search(r'\b(bleeding|bleed|bleating|leading)\b', text):
        return parse_condition_command(text, "bleeding")
    
    # Suppuration - includes common mishearings
    if re.search(r'\b(suppuration|supperation|pus|purulent|separation|super\s*ration)\b', text):
        return parse_condition_command(text, "suppuration")
    
    # Furcation - includes common mishearings ("furcation" not in Vosk vocab)
    if re.search(r'\b(furcation|furcate|fur\s*cation|for\s*cation|for\s*cake|occasion|fortification|fornication|frustration)\b', text):
        return parse_condition_command(text, "furcation")
    
    # Plaque - includes common mishearings  
    if re.search(r'\b(plaque|plack|pluck|black|plank|buildup)\b', text):
        return parse_condition_command(text, "plaque")
    
    # Mobility - includes common mishearings
    if re.search(r'\b(mobility|mobile|loose|movability|movable)\b', text):
        return parse_condition_command(text, "mobility")

    # Calculus - includes common Vosk mishearings
    if re.search(r'\b(calculus|calc|calculate|calculated|calcified)\b', text):
        return parse_condition_command(text, "calculus")

    # === Triplet Measurements ===
    # This is the default - try to parse as measurements if nothing else matches.
    # But if the text contains surface/dental keywords, it's a malformed command,
    # not a measurement (e.g. "to ten buccal" is a broken jump, not triplet "210").
    has_dental_keyword = any(kw in text for kw in SURFACE_KEYWORDS)
    if not has_dental_keyword:
        triplet = parse_triplet(text)
        if triplet:
            return triplet

    # No matching command found
    return None


def validate_command(command: dict) -> tuple[bool, Optional[str]]:
    """
    Validate a parsed command.
    Returns (is_valid, error_message).
    """
    if not command:
        return False, "Empty command"
    
    cmd_type = command.get("command")
    
    if cmd_type == "triplet":
        measurements = command.get("measurements", "")
        if len(measurements) != 3:
            return False, "Triplet must have exactly 3 measurements"
        if not all(c in '0123456789' for c in measurements):
            return False, "Measurements must be digits 0-9"
        return True, None
    
    if cmd_type == "jump":
        if "tooth_number" not in command:
            return False, "Jump command requires a tooth number"
        tooth_num = command["tooth_number"]
        if not (1 <= tooth_num <= 32):
            return False, f"Invalid tooth number: {tooth_num}"
        return True, None
    
    if cmd_type == "furcation":
        if "grade" not in command:
            return False, "Furcation command requires a grade (1-4)"
        return True, None
    
    if cmd_type == "plaque":
        if "severity" not in command:
            return False, "Plaque command requires severity (light/medium/severe)"
        return True, None
    
    if cmd_type == "mobility":
        if "grade" not in command:
            return False, "Mobility command requires a grade (1-3)"
        if command.get("grade", 0) > 3:
            return False, "Mobility grade must be 1-3"
        return True, None
    
    if cmd_type == "calculus":
        return True, None

    if cmd_type == "skip":
        return True, None

    if cmd_type == "missing":
        # Range validation
        if "range_start" in command and "range_end" in command:
            if command["range_start"] > command["range_end"]:
                return False, "Missing range start must be <= end"
        return True, None

    if cmd_type == "mode_switch":
        if "mode" not in command:
            return False, "Mode switch requires a mode (recession, gm, pd)"
        return True, None

    # For other commands, basic validation
    if cmd_type in ["start", "save", "undo", "pause", "resume", "repeat", "bleeding", "suppuration"]:
        return True, None

    return False, f"Unknown command type: {cmd_type}"


def process_transcript(transcript: str) -> dict:
    """
    Process a raw transcript and return a structured result.
    This is the main entry point for the STT server.
    """
    command = normalize_command(transcript)

    if command is None:
        return {
            "success": False,
            "raw_transcript": transcript,
            "command": None,
            "is_valid": False,
            "error": "Could not parse command from transcript"
        }

    is_valid, error_message = validate_command(command)

    return {
        "success": True,
        "raw_transcript": transcript,
        "command": command,
        "is_valid": is_valid,
        "error": error_message
    }


def process_transcript_all(transcript: str) -> list[dict]:
    """
    Process a raw transcript by splitting on delimiters and handling each
    segment independently.  This correctly handles mixed transcripts like
    ``"3 2 2, 3 2 3, pause, resume."`` where digits and commands are
    interleaved — the old approach would return only ``pause`` because
    ``normalize_command`` matched the whole string.

    Digit / number-word segments are accumulated and parsed together via
    ``parse_triplets`` (preserving cross-segment carry logic).  When a
    non-triplet command is encountered the digit buffer is flushed first so
    triplets that precede the command are not lost.

    e.g. "three three three four two three" -> [triplet("333"), triplet("423")]
         "three three three four two"       -> [triplet("333")]
         "bleeding on 11"                   -> [bleeding result]
         "3 2 2, 3 2 3, pause, resume."     -> [triplet("322"), triplet("323"), pause, resume]
    """
    # Split on commas, periods, semicolons.  Do NOT split on hyphens —
    # they appear in number-words like "twenty-one" and in Moonshine's
    # compact triplet format "323-324-323" (parse_triplets handles them
    # internally).
    raw_segments = re.split(r'[,.;]+', transcript)
    segments = [s.strip() for s in raw_segments if s.strip()]

    # Further split segments that contain multiple command keywords
    # (e.g. "bleeding 3 bleeding 6" → ["bleeding 3", "bleeding 6"]).
    # Uses a lookahead so the keyword stays with its segment.
    _CMD_BOUNDARY = re.compile(
        r'\s+(?=(?:bleeding|bleed|bleating|leading|suppuration|furcation|fornication|fortification|frustration|occasion'
        r'|plaque|mobility|calculus|calculate|calculated|calcified'
        r'|missing|listening|repeat|same|again|ditto|jump|move|go'
        r'|skip|next|undo|pause|resume|stop\s+listening|start|save'
        r'|begin\s+recession|begin\s+reception|begin\s+gm|chart\s+pd)\b)',
        re.IGNORECASE,
    )
    split_segments: list[str] = []
    for seg in segments:
        parts = _CMD_BOUNDARY.split(seg)
        split_segments.extend(p.strip() for p in parts if p.strip())
    segments = split_segments

    if not segments:
        return [{
            "success": False,
            "raw_transcript": transcript,
            "command": None,
            "is_valid": False,
            "error": "Could not parse command from transcript",
        }]

    results: list[dict] = []
    digit_segments: list[str] = []  # raw text buffered for triplet parsing

    def _flush_digits():
        """Parse accumulated digit segments as triplets and append to results."""
        if not digit_segments:
            return
        combined = ", ".join(digit_segments)
        normalized = normalize_text(combined)
        has_dental_keyword = any(kw in normalized for kw in SURFACE_KEYWORDS)
        triplets = [] if has_dental_keyword else parse_triplets(combined)
        for t in triplets:
            cmd = {"command": "triplet", "measurements": t}
            is_valid, error_message = validate_command(cmd)
            results.append({
                "success": True,
                "raw_transcript": transcript,
                "command": cmd,
                "is_valid": is_valid,
                "error": error_message,
            })
        digit_segments.clear()

    for seg in segments:
        cmd = normalize_command(seg)
        if cmd is not None and cmd.get("command") != "triplet":
            # Non-triplet command — flush any buffered digits first
            _flush_digits()
            is_valid, error_message = validate_command(cmd)
            results.append({
                "success": True,
                "raw_transcript": transcript,
                "command": cmd,
                "is_valid": is_valid,
                "error": error_message,
            })
        else:
            # Digits, number words, or unparseable filler — buffer for
            # multi-triplet parsing (filler like "um" produces no digits
            # and is silently dropped by parse_triplets).
            digit_segments.append(seg)

    _flush_digits()

    if not results:
        return [{
            "success": False,
            "raw_transcript": transcript,
            "command": None,
            "is_valid": False,
            "error": "Could not parse command from transcript",
        }]

    return results
